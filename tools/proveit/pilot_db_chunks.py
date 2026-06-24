"""ProveIt Pilot DB -> citable knowledge chunks (offline transform).

Phase 2 of docs/plans/2026-06-22-proveit-factory-import-implementation-plan.md: turn the Cappy Hour
"Pilot Database Export" (the CMMS-like evidence MIRA cites) into human-readable, citable chunks.

The export is four BOM-encoded JSON files plus a markdown manual:
    itemmanagement      itemid -> name/class/bottlesize/labelvariant/packcount   (22 rows)
    lotnumber           lotnumberid -> itemid + lot string + isconsumed          (~33k rows)
    workordermanagement workorderid -> lotnumberid + assetid + target qty + state(~6k rows)
    statemanagement     code -> name/type (the OEE state glossary)               (15 rows)

Documented join (Technical-Documentation.md):
    Item (itemid) -> Lot (lotnumberid) -> Work Order (workorderid) -> Asset (assetid)

This module is a PURE, offline transform: read files -> join -> emit `Chunk`s -> shape rows for
`mira-core/mira-ingest/db/neon.insert_knowledge_entries_batch`. It does NOT embed or write to NeonDB
(that step needs infra + the nomic embedder, and must set `is_private=true` for this per-tenant
corpus -- see `.claude/rules/knowledge-entries-tenant-scoping.md`). The licensed corpus is never
committed; tests run on a synthetic fixture.

Read-only. stdlib-only (`json`, `hashlib`).
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

# The four export files are matched by this substring (the real filenames carry an export timestamp).
_FILE_KEYS = {
    "items": "itemmanagement",
    "lots": "lotnumber",
    "work_orders": "workordermanagement",
    "states": "statemanagement",
}


@dataclass
class Chunk:
    """One citable knowledge chunk: human-readable text + where it came from + structured metadata."""
    content: str
    chunk_type: str                 # "work_order" | "item" | "state_glossary"
    uns_path: str = ""              # ISA-95 path this chunk grounds to (dot ltree)
    source_file: str = ""           # provenance: which export file
    source_row: str = ""            # provenance: the row key (e.g. work order number)
    metadata: dict = field(default_factory=dict)


def load_pilot_db(directory: str | Path) -> dict[str, list[dict]]:
    """Load the four Pilot DB JSON exports from a directory. Handles the UTF-8 BOM the exports carry
    (`utf-8-sig`) and the single-top-level-key wrapper (`{"itemmanagement": [...]}`)."""
    directory = Path(directory)
    out: dict[str, list[dict]] = {}
    for logical, needle in _FILE_KEYS.items():
        match = sorted(p for p in directory.glob("*.json") if needle in p.name.lower())
        if not match:
            out[logical] = []
            continue
        out[logical] = _read_rows(match[0])
    return out


def _read_rows(path: Path) -> list[dict]:
    """Read one export file; tolerate the BOM and the `{key: [rows]}` wrapper."""
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for value in data.values():
            if isinstance(value, list):
                return value
    return []


def build_state_glossary_chunk(states: list[dict], uns_prefix: str = "") -> Chunk:
    """One chunk that explains every OEE state code -- the grounding for 'what does state 201 mean'."""
    lines = ["OEE state codes for this factory (code — name — type):"]
    for s in sorted(states, key=lambda r: r.get("code", 0)):
        lines.append("- %s — %s (%s)" % (s.get("code"), s.get("name", "?"), s.get("type", "?")))
    return Chunk(
        content="\n".join(lines),
        chunk_type="state_glossary",
        uns_path=uns_prefix,
        source_file="statemanagement",
        source_row="all",
        metadata={"state_count": len(states)},
    )


def build_item_chunks(items: list[dict], uns_prefix: str = "") -> list[Chunk]:
    """One chunk per catalog item (what is produced)."""
    out: list[Chunk] = []
    for it in items:
        name = it.get("itemname", "?")
        cls = it.get("itemclass", "?")
        size = it.get("bottlesize") or 0
        size_txt = (" %g L bottle" % size) if size else ""
        label = it.get("labelvariant") or ""
        pack = it.get("packcount") or 0
        pack_txt = (", %d-pack" % pack) if pack else ""
        content = "Item %s: '%s' (class %s%s%s%s)." % (
            it.get("itemid"), name, cls, size_txt,
            (", label %s" % label) if label else "", pack_txt)
        out.append(Chunk(content=content, chunk_type="item", uns_path=uns_prefix,
                         source_file="itemmanagement", source_row=str(it.get("itemid")),
                         metadata={k: it.get(k) for k in ("itemid", "itemname", "itemclass")}))
    return out


def build_work_order_chunks(
    db: dict[str, list[dict]],
    uns_prefix: str = "",
    asset_uns_by_id: dict | None = None,
) -> list[Chunk]:
    """One citable chunk per work order, joining WO -> lot -> item (+ asset UNS when resolvable).

    `asset_uns_by_id` maps a numeric `assetid` to an ISA-95 UNS path (e.g. from the Cappy Hour import
    engine's asset roster). When absent, chunks ground to `uns_prefix` and keep `assetid` in metadata.
    """
    asset_uns_by_id = asset_uns_by_id or {}
    items_by_id = {it.get("itemid"): it for it in db.get("items", [])}
    lots_by_id = {lot.get("lotnumberid"): lot for lot in db.get("lots", [])}

    out: list[Chunk] = []
    for wo in db.get("work_orders", []):
        lot = lots_by_id.get(wo.get("lotnumberid"))
        item = items_by_id.get(lot.get("itemid")) if lot else None
        wo_num = wo.get("workordernumber", "?")
        lot_str = lot.get("lotnumber", "?") if lot else "(unknown lot)"
        item_name = item.get("itemname", "?") if item else "(unknown item)"
        item_cls = item.get("itemclass", "?") if item else "?"
        asset_id = wo.get("assetid")
        asset_uns = asset_uns_by_id.get(asset_id) or asset_uns_by_id.get(str(asset_id)) or ""
        target = wo.get("targetquantity")
        uom = wo.get("uom", "")
        state = wo.get("statename", "?")
        asset_txt = ("asset %s" % asset_uns) if asset_uns else ("asset id %s" % asset_id)
        content = (
            "Work order %s (state %s) produces lot %s of item '%s' (%s) on %s; "
            "target %s %s." % (wo_num, state, lot_str, item_name, item_cls, asset_txt,
                               _fmt_num(target), uom)
        )
        out.append(Chunk(
            content=content,
            chunk_type="work_order",
            uns_path=asset_uns or uns_prefix,
            source_file="workordermanagement",
            source_row=str(wo_num),
            metadata={
                "workordernumber": wo_num, "lotnumber": lot_str, "itemname": item_name,
                "itemclass": item_cls, "assetid": asset_id, "targetquantity": target,
                "uom": uom, "statename": state,
            },
        ))
    return out


def build_chunks(
    db: dict[str, list[dict]],
    uns_prefix: str = "",
    asset_uns_by_id: dict | None = None,
) -> list[Chunk]:
    """The full set: the state glossary, one chunk per item, one per work order."""
    chunks: list[Chunk] = [build_state_glossary_chunk(db.get("states", []), uns_prefix)]
    chunks.extend(build_item_chunks(db.get("items", []), uns_prefix))
    chunks.extend(build_work_order_chunks(db, uns_prefix, asset_uns_by_id))
    return chunks


def to_knowledge_entry_rows(
    chunks: list[Chunk],
    tenant_id: str,
    source_type: str = "proveit_pilot_db",
) -> list[dict]:
    """Shape chunks into `insert_knowledge_entries_batch` row dicts.

    `embedding` is left None — it is filled by the (infra-gated) embed step before insert. Rows are
    `is_private=True` (this is the proveit tenant's own CMMS data, NOT the shared OEM corpus — see
    `.claude/rules/knowledge-entries-tenant-scoping.md`); the batch inserter must honor that. `id` is
    deterministic (content hash) so re-runs de-duplicate instead of duplicating.
    """
    rows: list[dict] = []
    for ch in chunks:
        digest = hashlib.sha256(("%s|%s" % (tenant_id, ch.content)).encode("utf-8")).hexdigest()
        rows.append({
            "id": "proveit_%s" % digest[:24],
            "tenant_id": tenant_id,
            "source_type": source_type,
            "manufacturer": None,
            "model_number": None,
            "content": ch.content,
            "embedding": None,                      # filled by the embed step (infra)
            "source_url": "pilot_db:%s" % ch.source_file,
            "source_page": ch.source_row,
            "metadata": json.dumps(ch.metadata, ensure_ascii=False),
            "chunk_type": ch.chunk_type,
            "isa95_path": ch.uns_path or None,
            "equipment_id": None,
            "data_type": "work_order" if ch.chunk_type == "work_order" else "manual",
            "is_private": True,
        })
    return rows


def _fmt_num(n) -> str:
    if isinstance(n, float) and n.is_integer():
        return str(int(n))
    return str(n) if n is not None else "?"
