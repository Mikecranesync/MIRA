"""Portable Factory Context Bundle (``bundle@1``) — the USB-carryable export.

One self-describing zip a technician carries off a dead-internet floor and imports into MIRA Hub when
back online. Built entirely from the local store (accepted extractions + extracted documents) with
deterministic projections — no network, no LLM.

Contents:
  manifest.json            tool/version/time, source list + sha256, counts
  uns.json                 accepted signals as UNS paths
  i3x.json                 CESMII i3X objectInstances projected from the UNS hierarchy
  kg_entities.json         accepted extractions as proposed kg_entities (offline twin of Promote)
  kg_relationships.json    HAS_SIGNAL (asset→signal) + MENTIONS (document→tag) edges, status=proposed
  signals.csv              flat tag / uns / roles / confidence / source
  documents/<file>.json    extracted Document IR per uploaded document (knowledge_entries seed)
  review.json              full accept/reject audit trail with provenance
  report.md                human-readable summary
  IMPORT.md                how to load the bundle into MIRA Hub

Note (branch): the richer asset_graph/registers/edges emitters live on the parser's
feat/vfd-analyzer-auto-map branch; bundle@1 derives signals.csv from accepted extractions and defers
the full asset graph until those emitters merge.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import zipfile
from datetime import datetime, timezone

from . import __version__, standards
from . import scorecard as _scorecard

SCHEMA = "mira-contextualizer/bundle@1"
_TYPE_URI = "urn:mira:type:%s"


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", name)


def _uns_segments(path: str) -> list[str]:
    return [s for s in re.split(r"[/.]", path) if s]


def _i3x(accepted: list[dict], quantities: dict | None = None) -> dict:
    """Project accepted UNS paths into CESMII i3X objectInstances (containers + signal leaves).

    ``quantities`` maps a signal's tag name → its UCUM-coded quantity (from ``standards``); when a
    leaf's tag has one it rides along in the leaf metadata so the i3X consumer sees units + ranges."""
    quantities = quantities or {}
    instances: dict[str, dict] = {}
    for e in accepted:
        path = e.get("unsPathProposed")
        if not path:
            continue
        segs = _uns_segments(path)
        for i in range(len(segs)):
            elem_id = "/".join(segs[: i + 1])
            if elem_id in instances:
                continue
            is_leaf = i == len(segs) - 1
            meta: dict = {}
            if is_leaf:
                meta = {"roles": e.get("roles", []), "confidence": e.get("confidence")}
                q = quantities.get(e["tagName"])
                if q:
                    meta["quantity"] = q
            instances[elem_id] = {
                "elementId": elem_id,
                "name": segs[i],
                "typeElementId": _TYPE_URI % ("signal" if is_leaf else "container"),
                "parentId": "/".join(segs[:i]) or None,
                "isComposition": True,
                "namespaceUri": "urn:mira:uns",
                "metadata": meta,
            }
    return {"schema": "mira-contextualizer/i3x@1", "objectInstances": list(instances.values())}


def _kg(accepted: list[dict], project_id: str, quantities: dict | None = None) -> tuple[dict, dict]:
    """Accepted extractions → proposed kg_entities + kg_relationships (offline twin of Promote).

    Beyond the signal/asset/document graph, this layers two industry-standard projections:
      * ISO 14224 — a fault with mined cause/next-check gets an ``iso14224`` failure-mode record and,
        when the project names exactly one component, a ``HAS_FAILURE_MODE`` edge from it.
      * UCUM       — a unit-bearing value's coded ``quantity`` rides on its document entity and on the
        matching UNS signal entity, so the unit/range/setpoint is attached where the signal lives.
    Everything stays ``approval_state="proposed"`` — a human approves it in the Hub.
    """
    quantities = quantities or {}
    entities, relationships = [], []
    seen: set[str] = set()
    index: dict[str, dict] = {}

    def prov(e: dict) -> dict:
        return {"ctx_project_id": project_id, "ctx_extraction_id": e["id"],
                "evidence": e.get("evidenceJson", {})}

    def ent(entity_type: str, entity_id: str, name: str, props: dict) -> dict:
        key = "%s:%s" % (entity_type, entity_id)
        if key not in seen:
            seen.add(key)
            index[key] = {"entity_type": entity_type, "entity_id": entity_id, "name": name,
                          "approval_state": "proposed", "properties": props}
            entities.append(index[key])
        return index[key]

    # Pass 1 — PLC/CCW signals placed in the UNS (asset → signal). Index by tag name so a
    # document-derived UCUM quantity can later attach to the matching signal.
    signal_by_tag: dict[str, dict] = {}
    for e in accepted:
        path = e.get("unsPathProposed")
        if not path:
            continue
        node = ent("signal", path, e["tagName"],
                   {"roles": e.get("roles") or [], "confidence": e.get("confidence"),
                    "provenance": prov(e)})
        signal_by_tag.setdefault(e["tagName"], node)
        segs = _uns_segments(path)
        if len(segs) >= 2:
            asset = "/".join(segs[:-1])
            ent("asset", asset, segs[-2], {"provenance": prov(e)})
            relationships.append({"type": "HAS_SIGNAL", "source": asset, "target": path,
                                  "approval_state": "proposed", "evidence": prov(e)})

    # Component identity (ISO 14224 "equipment unit") from model / catalog mentions — the thing
    # failure modes hang off. Faults link only when there is exactly one, to avoid wrong attributions.
    component_ids: list[str] = []
    for e in accepted:
        if e.get("unsPathProposed"):
            continue
        primary = (e.get("roles") or ["signal"])[0]
        if primary in ("model_family", "catalog_number"):
            ent("component", e["tagName"], e["tagName"],
                {"identifier_type": primary, "confidence": e.get("confidence"), "provenance": prov(e)})
            if e["tagName"] not in component_ids:
                component_ids.append(e["tagName"])
    sole_component = component_ids[0] if len(component_ids) == 1 else None

    # Pass 2 — document-derived entities (manufacturers, faults, params/specs/tag refs) + enrichment.
    for e in accepted:
        if e.get("unsPathProposed"):
            continue
        roles = e.get("roles") or []
        primary = roles[0] if roles else "signal"
        ev = e.get("evidenceJson", {})

        if primary in ("model_family", "catalog_number"):
            node = index["component:%s" % e["tagName"]]
        elif primary == "fault_code":
            props = {"confidence": e.get("confidence"), "provenance": prov(e)}
            iso = standards.iso14224_fault(e["tagName"], ev)
            if iso:
                props["iso14224"] = iso
            node = ent("fault_code", e["tagName"], e["tagName"], props)
            if iso and sole_component:
                relationships.append({"type": "HAS_FAILURE_MODE", "source": sole_component,
                                      "target": e["tagName"], "approval_state": "proposed",
                                      "evidence": prov(e)})
        else:
            node = ent(primary, e["tagName"], e["tagName"],
                       {"confidence": e.get("confidence"), "provenance": prov(e)})
            if primary == "tag_reference":
                for m in ev.get("mentions", []):
                    relationships.append({
                        "type": "MENTIONS", "source": "document:%s" % m.get("file"),
                        "target": e["tagName"], "approval_state": "proposed",
                        "evidence": {"page": m.get("page"), "snippet": m.get("snippet")}})

        # UCUM quantity: carry it on the document entity, and attach it to the matching UNS signal.
        q = quantities.get(e["tagName"])
        if q:
            node["properties"]["quantity"] = q
            sig = signal_by_tag.get(e["tagName"])
            if sig:
                sig["properties"]["quantity"] = q

    return ({"schema": "mira-contextualizer/kg_entities@1", "entities": entities},
            {"schema": "mira-contextualizer/kg_relationships@1", "relationships": relationships})


def _fault_catalog(accepted: list[dict]) -> dict:
    """The document-derived fault catalog in ISO 14224 shape: fault_code → failure_mode →
    failure_mechanism/cause → maintenance_action. A fault with no mined depth still lists its code +
    display name so the catalog mirrors the manual."""
    faults = []
    for e in accepted:
        if "fault_code" not in (e.get("roles") or []):
            continue
        ev = e.get("evidenceJson") or {}
        iso = standards.iso14224_fault(e["tagName"], ev) or {
            "standard": "ISO 14224", "fault_code": e["tagName"],
            "failure_mode": ev.get("description") or e["tagName"],
            "failure_mechanism": None, "maintenance_action": None}
        iso["provenance"] = {"mentions": ev.get("mentions", []), "confidence": e.get("confidence")}
        faults.append(iso)
    return {"schema": "mira-contextualizer/fault_catalog@1", "standard": "ISO 14224", "faults": faults}


def _parameters(accepted: list[dict], quantities: dict) -> dict:
    """Parameters + engineering quantities (units/ranges/setpoints), UCUM-coded where the unit is
    recognized. Covers drive parameters, named specs, and unit-bearing tag references."""
    params = []
    for e in accepted:
        roles = e.get("roles") or []
        ev = e.get("evidenceJson") or {}
        q = quantities.get(e["tagName"])
        is_param = bool({"parameter", "spec"} & set(roles))
        if not (q or is_param):
            continue
        entry = {"name": e["tagName"], "roles": roles, "confidence": e.get("confidence"),
                 "provenance": {"mentions": ev.get("mentions", [])}}
        if q:
            entry["quantity"] = q
        else:  # a parameter without a UCUM-recognized unit — keep the raw captured spec
            raw = {k: ev[k] for k in ("units", "range", "setpoint") if ev.get(k)}
            if raw:
                entry["quantity"] = raw
        params.append(entry)
    return {"schema": "mira-contextualizer/parameters@1", "parameters": params}


def _profile_json(proj: dict) -> dict:
    """The machine identity + site/line metadata a Hub import keys on."""
    return {
        "schema": "mira-contextualizer/profile-summary@1",
        "name": proj["name"], "description": proj.get("description"),
        "identity": dict(proj.get("profile") or {}),
    }


def _asset_match(proj: dict, src_meta: list[dict], accepted: list[dict]) -> tuple[dict, dict]:
    """The asset-matching block + import intent the Hub uses to merge-or-create. Everything enters as
    proposed; verified Hub data is never overwritten."""
    ident = proj.get("profile") or {}
    proposed = ident.get("proposed_uns_path")
    if not proposed:  # derive the asset container from the accepted signals when not set by the user
        placed = [e["unsPathProposed"] for e in accepted if e.get("unsPathProposed")]
        if placed:
            segs = _uns_segments(sorted(placed)[0])
            proposed = "/".join(segs[:-1]) if len(segs) >= 2 else placed[0]
    match = {k: ident.get(k) for k in (
        "machine_name", "asset_type", "manufacturer", "model", "serial_number",
        "controller_type", "controller_ip", "plc_program_name")}
    match["proposed_uns_path"] = proposed
    match["source_file_hashes"] = [s["sha256"] for s in src_meta]
    intent = "existing_asset" if ident.get("hub_asset_id") else "new_asset"
    imp = {"intent": intent, "policy": "propose_only", "hub_asset_id": ident.get("hub_asset_id")}
    return match, imp


def _signals_csv(accepted: list[dict]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["tag", "uns_path", "roles", "confidence", "source"])
    for e in accepted:
        w.writerow([e["tagName"], e.get("unsPathProposed") or "", "|".join(e.get("roles") or []),
                    e.get("confidence") if e.get("confidence") is not None else "",
                    e.get("fileName") or ""])
    return buf.getvalue()


def _report_md(proj: dict, sources: list[dict], exts: list[dict], accepted: list[dict]) -> str:
    lines = ["# Factory Context Bundle — %s" % proj["name"], ""]
    if proj.get("description"):
        lines += [proj["description"], ""]
    lines += ["**Sources:** %d  ·  **Candidates:** %d  ·  **Accepted:** %d"
              % (len(sources), len(exts), len(accepted)), "", "## Sources"]
    lines += ["- %s (%s) — %s" % (s["fileName"], s["sourceType"], s["status"]) for s in sources]
    lines += ["", "## Accepted signals & entities"]
    for e in accepted:
        roles = ", ".join(e.get("roles") or []) or "—"
        lines.append("- **%s** [%s] %s" % (e["tagName"], roles, e.get("unsPathProposed") or ""))
    return "\n".join(lines) + "\n"


_IMPORT_MD = (
    "# Importing this bundle into MIRA Hub\n\n"
    "When back online, POST this bundle (zip) to the Hub:\n\n"
    "    POST /api/contextualization/import   (multipart: file=machine_context_bundle.zip)\n\n"
    "## Merge or create (see manifest.json → `asset_match` + `import`)\n\n"
    "- `import.intent = existing_asset` (a `hub_asset_id` is set): land the proposals on that asset.\n"
    "- `import.intent = new_asset`: match `asset_match` (machine/manufacturer/model/serial/controller/\n"
    "  PLC program / proposed UNS path / source file hashes) against existing assets. On a probable\n"
    "  match, ask the user to confirm; otherwise create a *draft* asset.\n"
    "- `import.policy = propose_only`: never overwrite verified Hub data. Everything from this bundle\n"
    "  enters as proposed / pending review until a human approves it.\n\n"
    "The Hub recreates the sources + accepted extractions, seeds knowledge_entries from documents/\n"
    "(is_private=true), and the existing Promote flow lands the proposed kg_entities /\n"
    "kg_relationships (signals, assets, ISO 14224 faults, UCUM quantities) for admin review.\n"
)


def build_bundle(store, project_id: str) -> dict[str, str]:
    """Return a mapping of bundle-relative path → file content (str). Caller writes or zips it."""
    proj = store.get_project(project_id)
    if not proj:
        raise ValueError("project not found")
    sources = store.list_sources(project_id)
    exts = store.list_extractions(project_id)
    accepted = [e for e in exts if e["status"] == "accepted"]

    files: dict[str, str] = {}
    src_meta = []
    for s in sources:
        full = store.get_source(s["id"])
        ir = full.get("extracted") if full else None
        if ir:
            files["documents/%s.json" % _safe(s["fileName"])] = json.dumps(ir, indent=2)
        blob = json.dumps(ir or {}, sort_keys=True).encode()
        src_meta.append({"file": s["fileName"], "type": s["sourceType"], "status": s["status"],
                         "sha256": hashlib.sha256(blob).hexdigest()})

    sc = _scorecard.compute_scorecard(exts, sources)
    files["scorecard.json"] = json.dumps(sc, indent=2)

    # UCUM-coded quantities, keyed by tag name, so the i3X + kg projections can attach units/ranges to
    # the signal they describe. ISO 14224 faults are projected inline in _kg from the same evidence.
    quantities = {}
    for e in accepted:
        q = standards.ucum_quantity(e.get("evidenceJson") or {})
        if q:
            quantities.setdefault(e["tagName"], q)
    n_uns = sum(1 for e in accepted if e.get("unsPathProposed"))
    n_iso = sum(1 for e in accepted
                if standards.iso14224_fault(e["tagName"], e.get("evidenceJson") or {}))

    asset_match, import_intent = _asset_match(proj, src_meta, accepted)
    files["manifest.json"] = json.dumps({
        "schema": SCHEMA, "tool": "mira-contextualizer", "tool_version": __version__,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "project": {"id": proj["id"], "name": proj["name"], "description": proj.get("description")},
        "counts": {"sources": len(sources), "candidates": len(exts), "accepted": len(accepted),
                   "uns_signals": n_uns, "iso14224_faults": n_iso,
                   "ucum_quantities": len(quantities)},
        # answerability snapshot so a consumer can gate on it without re-deriving
        "scorecard": {"score": sc["score"], "grade": sc["grade"]},
        # how the Hub should land this: match an existing asset or create a draft (proposed only)
        "asset_match": asset_match,
        "import": import_intent,
        "sources": src_meta,
    }, indent=2)
    files["profile.json"] = json.dumps(_profile_json(proj), indent=2)
    files["sources.json"] = json.dumps({
        "schema": "mira-contextualizer/sources@1", "sources": src_meta}, indent=2)
    files["uns.json"] = json.dumps({
        "schema": "mira-contextualizer/uns@1",
        "signals": [{"tag": e["tagName"], "unsPath": e["unsPathProposed"], "roles": e.get("roles", []),
                     "confidence": e.get("confidence")}
                    for e in accepted if e.get("unsPathProposed")],
    }, indent=2)
    files["i3x.json"] = json.dumps(_i3x(accepted, quantities), indent=2)
    ents, rels = _kg(accepted, project_id, quantities)
    files["kg_entities.json"] = json.dumps(ents, indent=2)
    files["kg_relationships.json"] = json.dumps(rels, indent=2)
    files["signals.csv"] = _signals_csv(accepted)
    files["fault_catalog.json"] = json.dumps(_fault_catalog(accepted), indent=2)
    files["parameters.json"] = json.dumps(_parameters(accepted, quantities), indent=2)
    files["review.json"] = json.dumps({
        "schema": "mira-contextualizer/review@1",
        "decisions": [{"tag": e["tagName"], "roles": e.get("roles", []), "status": e["status"],
                       "confidence": e.get("confidence"), "unsPath": e.get("unsPathProposed"),
                       "source": e.get("fileName"), "evidence": e.get("evidenceJson", {})}
                      for e in exts],
    }, indent=2)
    files["report.md"] = _report_md(proj, sources, exts, accepted)
    files["IMPORT.md"] = _IMPORT_MD
    return files


def zip_bytes(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path, content in sorted(files.items()):
            zf.writestr(path, content)
    return buf.getvalue()
