"""Independent-page system adapter: manifest + per-page graphs -> sheet index.

Bridges N per-page interpretation results (one ``graph.json`` per photo — the
CLI's collapse-into-one-call mode is NOT used) into the sheet-index shape that
``systemgraph.build_system_graph`` consumes. Deterministic; NO LLM, NO network.

Every emitted device, cross-reference, and unresolved item retains page-level
provenance: ``page_id``, ``photo_sha256``, extractor identity (model / effort /
package version), the source section+field inside the per-page graph, the raw
source string for parsed cross-references, and the per-entity confidence.

Manifest shape (one entry per photo; a ``missing`` page has no graph)::

    {"pages": [{"page_id": "p21", "sheet": "21", "file": "<basename>",
                "photo_sha256": "<64hex>", "quality": "clear_upright",
                "extractor": {"model": ..., "effort": ...,
                               "package_version": ...}}, ...]}

Honesty stays in systemgraph: this adapter does not decide what a blurred or
missing sheet may claim — it only carries quality + provenance through, and
systemgraph classifies phantom observations and unverifiable crossings.
"""

from __future__ import annotations

from . import xrefnorm

# Entity sections harvested as devices (off_page_references is the xref
# source, unresolved passes through separately).
_DEVICE_SECTIONS = (
    "devices", "terminals", "conductors", "cables", "contacts",
    "power_domains", "pe_bonds", "plc_io_channels", "network_links",
)

_UNREADABLE = "UNREADABLE"


def _xref_entries(raw: str, sig: str, source_field: str, prov: dict,
                  confidence) -> list[dict]:
    """Parse one connects/off-page string into peer-bearing xref entries."""
    entries = []
    for atom in xrefnorm.parse_ref(raw):
        kind, token = atom["kind"], atom["token"]
        if kind == "sheet_col":
            # keep the column for humans; classification is sheet-level
            peer = f"S{token}"
        elif kind == "sheet":
            num = token[1:] if token[:1] in ("S", "s") else token
            if num.lower().startswith("sheet"):
                num = num[5:]
            peer = f"S{num}"
        elif kind == "assembly":
            peer = f"EXT:{token}"
        else:
            continue
        entries.append({
            "sig": sig, "dir": "", "peer": peer, "ev": "obs",
            "confidence": confidence,
            "provenance": {**prov, "source_field": source_field, "raw": raw},
        })
    return entries


def load_pageset(manifest: dict, graphs: dict[str, dict],
                 decoder_profile: str | None = None) -> dict:
    """Fold per-page graphs + manifest into a systemgraph sheet index.

    Raises ValueError on any manifest/graph mismatch: a graph without a
    manifest page, a non-missing page without a graph, or duplicate sheet
    ids (a reshoot is a NEW page/case, never a silent overwrite).

    ``decoder_profile`` (D19, STRICTLY OPT-IN): when set, each device also
    carries a ``designation`` block with the decoded identity keys
    (parent_device_key / connection_point_key / relationship) for Phase C
    entity construction. The ``tag`` used as graph identity is UNCHANGED —
    default behavior stays byte-identical (D20: no silent graph-ID changes).
    """
    pages = manifest.get("pages", [])
    page_ids = [p["page_id"] for p in pages]
    expected = {p["page_id"] for p in pages if p.get("quality") != "missing"}

    extra = set(graphs) - set(page_ids)
    if extra:
        raise ValueError(f"graphs with no manifest page: {sorted(extra)}")
    absent = expected - set(graphs)
    if absent:
        raise ValueError(f"manifest pages missing their graph: {sorted(absent)}")

    sheet_ids = [str(p["sheet"]).lower() for p in pages]
    if len(sheet_ids) != len(set(sheet_ids)):
        raise ValueError(
            "duplicate sheet ids in manifest — a recapture is registered as "
            "an additional page/case, never an overwrite")

    sheets = []
    for page in pages:
        prov_base = {
            "page_id": page["page_id"],
            "photo_sha256": page.get("photo_sha256"),
            "extractor": page.get("extractor"),
        }
        entry = {
            "sheet": str(page["sheet"]),
            "quality": page.get("quality", "clear_upright"),
            "page_id": page["page_id"],
            "devices": [],
            "xrefs": [],
            "unresolved": [],
        }
        # contextual-seam passthrough (Phase C): page-level context and
        # revision metadata travel with the sheet entry when declared
        for key in ("context_prefix", "revision"):
            if page.get(key) is not None:
                entry[key] = page[key]
        graph = graphs.get(page["page_id"])
        if graph is None:
            sheets.append(entry)
            continue

        for section in _DEVICE_SECTIONS:
            for i, ent in enumerate(graph.get(section, []) or []):
                tag = str(ent.get("tag", "")).strip()
                if not tag or tag == _UNREADABLE:
                    continue
                device = {
                    "tag": tag,
                    "kind": ent.get("type") or section,
                    "ev": "obs",
                    "confidence": ent.get("confidence"),
                    "provenance": {**prov_base, "section": section},
                }
                if decoder_profile is not None:
                    from .designations import decode
                    d = decode(tag, profile=decoder_profile)
                    device["designation"] = {
                        "profile": decoder_profile,
                        "parent_device_key": d["entity_plan"]["parent_device"],
                        "connection_point_key": d["entity_plan"]["child_entity"],
                        "relationship": d["entity_plan"]["relationship"],
                        "normalized": d["normalized"],
                    }
                entry["devices"].append(device)
                for j, raw in enumerate(ent.get("connects", []) or []):
                    entry["xrefs"].extend(_xref_entries(
                        str(raw), sig=tag,
                        source_field=f"{section}[{i}].connects[{j}]",
                        prov=prov_base, confidence=ent.get("confidence")))

        for i, ent in enumerate(graph.get("off_page_references", []) or []):
            tag = str(ent.get("tag", "")).strip()
            sources = [tag] + [str(c) for c in (ent.get("connects", []) or [])]
            for j, raw in enumerate(sources):
                if not raw or raw == _UNREADABLE:
                    continue
                field = (f"off_page_references[{i}].tag" if j == 0
                         else f"off_page_references[{i}].connects[{j - 1}]")
                entry["xrefs"].extend(_xref_entries(
                    raw, sig=tag or raw, source_field=field,
                    prov=prov_base, confidence=ent.get("confidence")))

        for item in graph.get("unresolved", []) or []:
            entry["unresolved"].append({
                "item": item.get("item") if isinstance(item, dict) else str(item),
                "status": (item.get("status")
                           if isinstance(item, dict) else None),
                "provenance": dict(prov_base),
            })

        sheets.append(entry)

    return {"sheets": sheets}
