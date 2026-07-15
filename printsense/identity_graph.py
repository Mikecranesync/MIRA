"""Phase C identity graph — typed entities from decoded designations.

Consumes a pageset index whose devices carry ``designation`` blocks (the
opt-in decoder integration) and constructs typed entity nodes and
relationships. Deterministic; NO LLM, NO network.

Doctrine carried forward:
- A1/A2-style connection points are children of one parent device — never
  aliases (relationship vocabulary has no auto-alias path here at all).
- ContactGroup nodes express marking conventions only: membership NEVER
  implies electrical continuity or state.
- The four formerly dormant relationship types emit ONLY with evidence:
  NESTED_DEVICE_OF (a decoded multi-device nested path),
  RELATIVE_REFERENCE_TO (page context actually supplied),
  PROJECT_EQUIVALENT_OF (a human-CONFIRMED legend rule),
  REVISION_VARIANT_OF (explicit revision metadata). Nothing is synthesized
  for coverage.
- Every relationship states its producing stage, evidence, confidence, and
  whether human confirmation was involved.
"""

from __future__ import annotations

import json

from .designations import decode
from .designations.relationships import migrate_alias_variations

_SCHEMA = "1.0"

_CHILD_TYPES = {
    "coil": ("Coil", "COIL_TERMINAL_OF"),
    "contact_terminal": ("Contact", "CHILD_CONNECTION_POINT_OF"),
    "terminal": ("Terminal", "CHILD_CONNECTION_POINT_OF"),
    "connector_pin": ("ConnectionPoint", "CONNECTOR_PIN_OF"),
    "port": ("Port", "PORT_OF"),
    "conductor_core": ("ConductorEndpoint", "CHILD_CONNECTION_POINT_OF"),
    "connection_point": ("ConnectionPoint", "CHILD_CONNECTION_POINT_OF"),
    "main_pole_terminal": ("Terminal", "CHILD_CONNECTION_POINT_OF"),
}


def _ensure_node(nodes: dict, key: str, entity_type: str, page: str | None,
                 sheet: str | None, provenance: dict | None) -> dict:
    node = nodes.get(key)
    if node is None:
        node = {"key": key, "entity_type": entity_type, "forms": [key],
                "pages": [], "sheets": [], "provenance": []}
        nodes[key] = node
    if page and page not in node["pages"]:
        node["pages"].append(page)
    if sheet and sheet not in node["sheets"]:
        node["sheets"].append(sheet)
    if provenance:
        node["provenance"].append(provenance)
    return node


def _rel(rels: list, rtype: str, src: str, dst: str, stage: str,
         evidence: dict, confidence: float, human_confirmed: bool = False):
    entry = {"type": rtype, "from": src, "to": dst, "stage": stage,
             "evidence": evidence, "confidence": round(confidence, 3),
             "human_confirmed": human_confirmed}
    if entry not in rels:
        rels.append(entry)


def _device_alpha_path(path: list[str]) -> bool:
    """True only when EVERY nested element is device-shaped (letter prefix) —
    bare structure digits ('-21/K01') are NOT nested-device evidence."""
    return len(path) > 1 and all(p[:1].isalpha() for p in path)


def build_identity_graph(index: dict, legends: list | None = None) -> dict:
    nodes: dict[str, dict] = {}
    rels: list[dict] = []
    ambiguities: list[dict] = []
    unresolved: list[dict] = []

    for sheet_entry in index.get("sheets", []):
        sheet = str(sheet_entry.get("sheet"))
        page = sheet_entry.get("page_id")
        prefix = sheet_entry.get("context_prefix")
        page_context = {"prefix": prefix} if prefix else None

        for dev in sheet_entry.get("devices", []):
            dz_block = dev.get("designation")
            if not dz_block:
                continue
            profile = dz_block.get("profile", "eplan_iec")
            d = decode(dev["tag"], profile=profile, page_context=page_context)
            prov = {**(dev.get("provenance") or {}),
                    "confidence": dev.get("confidence")}
            cp = d.get("connection_point")
            base = d.get("base_designation")

            if cp is None:
                etype = "Device"
                path = d.get("nested_device_path") or []
                if _device_alpha_path(path):
                    etype = "Subdevice"
                _ensure_node(nodes, dev["tag"], etype, page, sheet, prov)
                if _device_alpha_path(path):
                    parent_key = dev["tag"].rsplit("-", 1)[0]
                    _ensure_node(nodes, parent_key, "Device", page, sheet, None)
                    _rel(rels, "NESTED_DEVICE_OF", dev["tag"], parent_key,
                         "token", {"nested_path": path, "page_id": page}, 0.7)
            else:
                kind = "coil" if cp.get("role") == "coil_or_control_terminal" \
                    else cp.get("kind", "connection_point")
                etype, primary_rel = _CHILD_TYPES.get(
                    kind, ("ConnectionPoint", "CHILD_CONNECTION_POINT_OF"))
                _ensure_node(nodes, dev["tag"], etype, page, sheet, prov)
                parent_class = None
                for seg in d.get("segments", []):
                    if seg.get("kind") == "device_candidate":
                        parent_class = seg.get("class_code")
                parent_type = "Connector" if parent_class == "XS" else "Device"
                _ensure_node(nodes, base, parent_type, page, sheet, None)
                evidence = {"page_id": page, "raw": dev["tag"],
                            "convention": cp.get("convention", {}).get("role")}
                _rel(rels, "CHILD_CONNECTION_POINT_OF", dev["tag"], base,
                     "token", evidence, 0.85)
                if primary_rel != "CHILD_CONNECTION_POINT_OF":
                    _rel(rels, primary_rel, dev["tag"], base, "token",
                         evidence, 0.85)
                pair = cp.get("pair_key")
                if pair:
                    group_key = f"{base}:{pair}"
                    group = _ensure_node(nodes, group_key, "ContactGroup",
                                         page, sheet, None)
                    group["state_proof"] = "never"
                    _rel(rels, "CONTACT_MEMBER_OF", dev["tag"], group_key,
                         "token", {**evidence, "state_proof": "never"}, 0.85)

            # stage 2: page context supplies omitted hierarchy
            resolved = d.get("resolved_full_designation")
            if prefix and resolved and resolved != dev["tag"]:
                _ensure_node(nodes, resolved, "Device", page, sheet, None)
                _rel(rels, "RELATIVE_REFERENCE_TO", dev["tag"], resolved,
                     "page_context",
                     {"prefix": prefix, "page_id": page}, 0.7)

            for a in d.get("ambiguities", []):
                if a not in ambiguities:
                    ambiguities.append(a)
            for u in d.get("unresolved_segments", []):
                entry = {**u, "page_id": page, "designation": dev["tag"]}
                if entry not in unresolved:
                    unresolved.append(entry)

        for u in sheet_entry.get("unresolved", []) or []:
            entry = {"raw": u.get("item"), "reason": u.get("status"),
                     "page_id": page}
            if entry not in unresolved:
                unresolved.append(entry)

    # cross-page identity honesty (adversarial review): a BARE tag (no
    # aspect prefix, no structure path) appearing on multiple sheets is
    # MERGED as one node — that is the cross-page identity assumption, and
    # it must be visible, never silent. Structure-qualified tags (-21/K01)
    # are globally unique by convention and are exempt.
    for key, node in nodes.items():
        if node["entity_type"] in ("Device", "Subdevice") \
                and len(node["sheets"]) > 1 \
                and "/" not in key and "=" not in key and "+" not in key:
            ambiguities.append({
                "kind": "cross_page_identity_assumed",
                "designation": key,
                "sheets": sorted(node["sheets"]),
                "resolution": "page/package context or legend required to "
                              "prove one physical device",
            })

    # stage 4: project profile — CONFIRMED legend equivalences only
    for rule in legends or []:
        pair = (rule.mapping or {}).get("designation_equivalence")
        if not pair or len(pair) != 2:
            continue
        if rule.human_confirmation_status != "confirmed":
            continue
        a, b = pair
        _ensure_node(nodes, a, "Device", None, None, None)
        _ensure_node(nodes, b, "Device", None, None, None)
        _rel(rels, "PROJECT_EQUIVALENT_OF", a, b, "project_profile",
             {"legend": rule.raw_text, "source_page": rule.source_page},
             rule.confidence, human_confirmed=True)

    # stage: revision metadata — variants + conflicts, never silent selection
    by_sheet: dict[str, list] = {}
    for sheet_entry in index.get("sheets", []):
        rev = sheet_entry.get("revision")
        if rev is not None:
            by_sheet.setdefault(str(sheet_entry["sheet"]), []).append(
                (rev, sheet_entry.get("page_id")))
    for sheet, revs in sorted(by_sheet.items()):
        if len(revs) < 2:
            continue
        revs = sorted(revs)
        for (r1, p1), (r2, p2) in zip(revs, revs[1:]):
            _rel(rels, "REVISION_VARIANT_OF", f"S{sheet}:{r1}",
                 f"S{sheet}:{r2}", "revision",
                 {"sheet": sheet, "pages": [p1, p2]}, 0.8)
        ambiguities.append({"kind": "revision_conflict", "sheet": sheet,
                            "revisions": [r for r, _ in revs],
                            "resolution": "requires_human_confirmation"})

    return {"schema_version": _SCHEMA, "nodes": nodes,
            "relationships": rels, "ambiguities": ambiguities,
            "unresolved": unresolved}


_PARENT_RELS = {"CHILD_CONNECTION_POINT_OF", "CONNECTOR_PIN_OF", "PORT_OF",
                "COIL_TERMINAL_OF"}


def query_designation(graph: dict, raw: str,
                      systemgraph_result: dict | None = None) -> dict:
    """Retrieve a designation's full context. Safety-flagged contradictions
    are ALWAYS included — bounded retrieval never drops them."""
    nodes = graph["nodes"]
    node = nodes.get(raw)
    rels = graph["relationships"]
    parent_key = next((r["to"] for r in rels
                       if r["from"] == raw and r["type"] in _PARENT_RELS), None)
    children = [nodes[r["from"]] for r in rels
                if r["to"] == raw and r["type"] in _PARENT_RELS
                and r["from"] in nodes]
    seen: list = []
    children = [c for c in children
                if c["key"] not in seen and not seen.append(c["key"])]
    groups = [n for k, n in nodes.items()
              if n["entity_type"] == "ContactGroup" and k.startswith(f"{raw}:")]
    contradictions: list = []
    for c in (systemgraph_result or {}).get("contradictions", []):
        mentions = raw in json.dumps(c)
        if c.get("safety") or mentions:
            contradictions.append(c)
    return {
        "node": node,
        "parent": nodes.get(parent_key) if parent_key else None,
        "children": children,
        "contact_groups": groups,
        "pages": sorted({p for c in ([node] if node else []) + children
                         for p in c.get("pages", [])}),
        "relationships": [r for r in rels if raw in (r["from"], r["to"])],
        "ambiguities": [a for a in graph.get("ambiguities", [])
                        if raw in json.dumps(a)
                        or a.get("kind") == "revision_conflict"],
        "unresolved": [u for u in graph.get("unresolved", [])
                       if u.get("designation") == raw],
        "contradictions": contradictions,
    }


def reinterpret_with_records(legacy_graph: dict, index: dict | None = None,
                             profile: str = "eplan_iec") -> dict:
    """WS3 migration layer: versioned reinterpretation records on top of
    migrate_alias_variations — legacy findings stay untouched."""
    base = migrate_alias_variations(legacy_graph, profile=profile)

    # provenance lookup from the index (page + source section per form)
    prov: dict[str, tuple] = {}
    for sheet_entry in (index or {}).get("sheets", []):
        for dev in sheet_entry.get("devices", []):
            p = dev.get("provenance") or {}
            prov.setdefault(dev["tag"],
                            (p.get("page_id"), p.get("section")))

    records = []
    for reint in base["reinterpretations"]:
        members = []
        pages = []
        for m in reint["members"]:
            page, section = prov.get(m["form"], (None, None))
            if page and page not in pages:
                pages.append(page)
            members.append({
                "child_designation": m["form"],
                "parent_designation": reint.get("anchor"),
                "typed_relationship": m["relationship"],
                "legacy_classification": "alias_variation",
                "confidence": 0.9 if m["relationship"] != "AMBIGUOUS_WITH"
                else 0.4,
                "ambiguities": [] if m["relationship"] != "AMBIGUOUS_WITH"
                else ["cannot be resolved from legacy data alone"],
                "source_page": page,
                "source_field_path": section,
                "state_proof": "never",
            })
        records.append({
            "key": reint["key"],
            "legacy_classification": "alias_variation",
            "original": reint["original"],
            "anchor": reint.get("anchor"),
            "members": members,
            "profile": profile,
            "source_pages": pages,
            "migration_version": _SCHEMA,
        })
    return {"migration_version": _SCHEMA, "records": records,
            "counts": base["counts"], "total": base["total"],
            "note": base["note"]}
