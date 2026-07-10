"""Schematic-extractor output -> `wiring_connections` (PR-2 — reuse the PR-1 seam).

PR-1 (`tools/wiring_map_import.py`) proved the dormant `wiring_connections` writer
with cited YAML. This wires the **live vision extractor** into the *same* seam:
the `mira-mcp` `POST /api/kg/schematic` endpoint (schematic_intelligence: classify ->
detect_symbols -> trace_connections -> `to_kg_payload`) emits electrically-connected
relationships; this tool converts those into the SAME `WiringRow` shape and writes
them via the SAME `write_rows`, as `approval_state='proposed'`.

**Reuse, not reinvention.** `WiringRow`, `entity_id`, and `write_rows` are imported
verbatim from `wiring_map_import` — no second wiring table, no parallel writer, no
Drive-Pack schema change, no `schema_version` bump, no migration, no PDF/OCR path.

**Input** is the extractor output, NOT a live vision call — deterministic and
testable. Pass the `/api/kg/schematic` response JSON (either the whole
`{"ok":true,"result":{...}}` envelope or the inner `result`/`to_kg_payload` object)
via `--payload`. Only `relationship_type == 'electrically_connected'` rows become
conductors; the derived `controls`/`protects` semantic edges are ignored (they are
not wires).

**Provenance is preserved** in `evidence_summary`: the extractor name, schematic
type, drawing/image ref, parent equipment, the raw `from_terminal`/`to_terminal`,
the endpoint symbol subtypes, and the source. Endpoints reuse PR-1's deterministic
`uuid5` soft-FK ids (kg_entities linking stays PR-3+ work).

## Two honest gaps this surfaces (report, don't paper over)

1. **No function_class from the extractor.** A traced `Connection` carries only
   `from`/`to`/`wire_number` — no power/signal/safety class. Symbol *type* does not
   reliably map to a wire's function. So schematic-derived rows land
   `function_class='unknown'` (a valid CHECK value), with
   `evidence_summary.function_class_source='unclassified_by_extractor'`, awaiting a
   human/later classification. (PR-1 could derive it because the YAML named the
   signal/type; the vision extractor does not.)
2. **Doctrine tension (migration 026).** Mig 026 reserves direct INSERT for
   *structured imports* and routes *LLM-derived* rows through `ai_suggestions`.
   Schematic output IS LLM-derived (Gemini vision). Per the instruction to reuse the
   PR-1 writer seam, this tool direct-INSERTs — but every row is `approval_state=
   'proposed'` and `proposed_by='llm:*'`, so the LLM provenance is explicit and the
   human gate is intact. Routing these through `ai_suggestions` instead is the
   doctrine-strict alternative and is flagged for a follow-up decision, NOT silently
   assumed.

Usage::

    python tools/wiring_schematic_import.py --payload result.json --dry-run
    NEON_DATABASE_URL=... python tools/wiring_schematic_import.py \
        --tenant-id <uuid> --payload result.json --drawing-ref "CV-101 panel photo"
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Optional

# Reuse the PR-1 seam verbatim (WiringRow / entity_id / write_rows).
_HERE = Path(__file__).resolve().parent  # tools/
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import wiring_map_import as base  # noqa: E402

_EXTRACTOR = "schematic_intelligence"
_DEFAULT_PROPOSED_BY = "llm:schematic_intelligence"  # mig-026 'llm:*' convention (LLM-derived)
_ELECTRICAL_REL = "electrically_connected"
_DEFAULT_ASSET = base._DEFAULT_ASSET


# ---------------------------------------------------------------------------
# Pure core — extractor payload -> WiringRow list (no DB, no network, no vision)
# ---------------------------------------------------------------------------


def unwrap_payload(doc: dict[str, Any]) -> dict[str, Any]:
    """Accept either the `{"ok":true,"result":{...}}` envelope or a raw payload."""
    if isinstance(doc, dict) and isinstance(doc.get("result"), dict):
        return doc["result"]
    return doc


def _terminal_of(full_terminal: str, ref: str) -> str:
    """`("K1:A1", "K1") -> "A1"`; `("Q0.0:24V", "Q0.0") -> "24V"`; bare -> itself."""
    ft = (full_terminal or "").strip()
    if ref and ft.startswith(ref + ":"):
        return ft[len(ref) + 1 :]
    if ":" in ft:
        return ft.split(":", 1)[1]
    return ft


def kg_payload_to_rows(
    payload: dict[str, Any],
    asset: str = _DEFAULT_ASSET,
    *,
    drawing_ref: Optional[str] = None,
    proposed_by: str = _DEFAULT_PROPOSED_BY,
    source: str = "mira-mcp:/api/kg/schematic",
) -> list[base.WiringRow]:
    """Convert an `/api/kg/schematic` payload into PR-1 `WiringRow`s (pure, no I/O).

    Only `electrically_connected` relationships become conductors. Deduped by the
    same natural key PR-1 uses. `function_class` is 'unknown' (the extractor gives
    no classification — see module docstring gap #1); gauge/color/cable stay NULL.
    """
    payload = unwrap_payload(payload)
    schematic_type = payload.get("schematic_type")
    parent_equipment_id = payload.get("parent_equipment_id")
    entities = payload.get("entities") or []
    subtype_by_ref = {
        e.get("entity_id"): (e.get("properties") or {}).get("subtype")
        for e in entities
        if isinstance(e, dict) and e.get("entity_id")
    }
    # drawing_ref echoed onto entities if not passed explicitly.
    if not drawing_ref:
        for e in entities:
            dref = (e.get("properties") or {}).get("drawing_ref") if isinstance(e, dict) else None
            if dref:
                drawing_ref = dref
                break

    seen: set[tuple] = set()
    rows: list[base.WiringRow] = []
    for rel in payload.get("relationships") or []:
        if not isinstance(rel, dict) or rel.get("relationship_type") != _ELECTRICAL_REL:
            continue  # derived controls/protects edges are not wires
        props = rel.get("properties") or {}
        src_dev = rel.get("source_entity_id")
        dst_dev = rel.get("target_entity_id")
        from_term = props.get("from_terminal") or ""
        to_term = props.get("to_terminal") or ""
        if not src_dev or not dst_dev:
            continue

        src_terminal = _terminal_of(from_term, src_dev) or src_dev
        dst_terminal = _terminal_of(to_term, dst_dev) or dst_dev
        wire = props.get("wire_number") or None

        row = base.WiringRow(
            source_entity_id=base.entity_id(asset, src_dev),
            source_terminal=src_terminal,
            dest_entity_id=base.entity_id(asset, dst_dev),
            dest_terminal=dst_terminal,
            wire_number=wire,
            function_class="unknown",  # extractor carries no power/signal/safety class
            drawing_reference=drawing_ref or f"schematic:{schematic_type or 'unknown'}",
            approval_state=base._APPROVAL_STATE,  # 'proposed'
            proposed_by=proposed_by,
            evidence_summary={
                "source": source,
                "extractor": _EXTRACTOR,
                "asset": asset,
                "schematic_type": schematic_type,
                "drawing_ref": drawing_ref,
                "parent_equipment_id": parent_equipment_id,
                "from_terminal": from_term or f"{src_dev}",
                "to_terminal": to_term or f"{dst_dev}",
                "wire_number": wire,
                "source_subtype": subtype_by_ref.get(src_dev),
                "dest_subtype": subtype_by_ref.get(dst_dev),
                "function_class_source": "unclassified_by_extractor",  # gap #1, explicit
            },
            source_label=from_term or str(src_dev),
            dest_label=to_term or str(dst_dev),
        )
        if row.natural_key() in seen:
            continue
        seen.add(row.natural_key())
        rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# DB glue — reuse base.write_rows (the PR-1 seam)
# ---------------------------------------------------------------------------


def _load_payload(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def main(argv: Optional[list[str]] = None) -> int:  # pragma: no cover - DB glue
    parser = argparse.ArgumentParser(
        description="Import /api/kg/schematic output into wiring_connections."
    )
    parser.add_argument(
        "--payload", required=True, help="path to the /api/kg/schematic response JSON"
    )
    parser.add_argument(
        "--tenant-id", default=os.getenv("MIRA_TENANT_ID"), help="owning tenant UUID"
    )
    parser.add_argument(
        "--asset", default=_DEFAULT_ASSET, help="asset slug for deterministic endpoint ids"
    )
    parser.add_argument("--drawing-ref", default=None, help="override the drawing/image reference")
    parser.add_argument(
        "--proposed-by", default=_DEFAULT_PROPOSED_BY, help="provenance actor label"
    )
    parser.add_argument("--dry-run", action="store_true", help="print rows; write nothing")
    parser.add_argument("--database-url", default=None, help="override NEON_DATABASE_URL")
    args = parser.parse_args(argv)

    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass

    payload = _load_payload(Path(args.payload))
    rows = kg_payload_to_rows(
        payload, asset=args.asset, drawing_ref=args.drawing_ref, proposed_by=args.proposed_by
    )
    if not rows:
        print(
            "No electrically_connected relationships in the payload — nothing to import.",
            file=sys.stderr,
        )
        return 1

    if args.dry_run:
        for r in rows:
            print(
                f"[dry-run] {r.source_label} -> {r.dest_label}  [{r.function_class}] "
                f"wire={r.wire_number} ({r.approval_state}, by={r.proposed_by})"
            )
        print(
            f"[dry-run] {len(rows)} schematic connection(s) would be proposed for asset {args.asset}."
        )
        return 0

    if not args.tenant_id:
        print("ERROR: set --tenant-id or MIRA_TENANT_ID (required to write)", file=sys.stderr)
        return 2

    db_url = args.database_url or os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not db_url:
        print(
            "ERROR: set NEON_DATABASE_URL or DATABASE_URL (or pass --database-url)", file=sys.stderr
        )
        return 2

    import psycopg2  # local import: only main() needs the driver

    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT set_config('app.current_tenant_id', %s, true)", (args.tenant_id,))
            inserted, skipped = base.write_rows(cur, args.tenant_id, rows)
        conn.commit()
    finally:
        conn.close()

    print(
        f"wiring_connections: proposed {inserted} new schematic connection(s), "
        f"skipped {skipped} already-present (asset {args.asset})."
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
