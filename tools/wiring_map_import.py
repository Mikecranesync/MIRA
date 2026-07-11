"""Structured import: cited electrical-model YAML -> `wiring_connections` (PR-1 seam proof).

The distillation discovery (`docs/discovery/2026-07-09-wiring-print-extraction-recovery.md`)
found that the `wiring_connections` table (migration 026) is provisioned + schema-verified
but **DORMANT** — no code writes it. This tool proves that single missing seam with the
lowest-risk cited data available: the hand-authored, evidence-tagged CV-101 electrical model
at `plc/conv_simple_electrical/model/*.yaml`. **No vision, no OCR, no PDF ingest, no Drive-Pack
schema change** — a deterministic YAML -> rows import only.

Why direct INSERT is allowed here: migration 026 reserves direct INSERT for **structured
imports** (EPLAN AML, confirmed schematic upload) and routes only *LLM-derived* rows through
`ai_suggestions`. This is a deterministic structured import from a cited repo artifact, so the
direct-INSERT path is the sanctioned one.

Grounding honesty (important): the CV-101 `wires.yaml` conductors are all `status: field_verify`
(the header states there is no as-built wire list; only the PLC terminal<->function map in
`terminals.yaml` is `verified`). So every connection is written `approval_state='proposed'` —
grounded in verified terminal/program evidence but awaiting field confirmation, which is exactly
what `proposed` means. The model `status` (`field_verify`) is preserved verbatim in
`evidence_summary.model_status`; nothing is upgraded or invented (evidence-or-gap).

Endpoints: `source_entity_id`/`dest_entity_id` are soft FKs (migration 026 §"soft FKs") — not
enforced against `kg_entities`. This import mints a **deterministic** `uuid5(NAMESPACE, asset:tag)`
per device tag so the same device always maps to the same id (idempotency-friendly) and stores
the human-readable tag/terminal in `evidence_summary`. Linking these ids to real `kg_entities`
rows is deliberately OUT of scope for this PR (that is the PR-2 extractor/linking work).

Usage::

    # dry-run: print the rows this would propose, write nothing
    python tools/wiring_map_import.py --tenant-id <uuid> --dry-run

    # apply: insert proposed rows (idempotent — re-running skips existing)
    NEON_DATABASE_URL=... python tools/wiring_map_import.py --tenant-id <uuid>

Design mirrors the flywheel tools (`tools/drive-pack-extract/gap_suggestion.py`): a pure,
injectable core (unit-tested against the real YAML) + a thin psycopg2 `main()`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import yaml

# Fixed namespace for deterministic device-endpoint ids. Arbitrary but STABLE —
# never change it, or previously-imported rows would fail to dedup.
NAMESPACE = uuid.UUID("e7c1a3b5-9d24-4f68-b0a1-c2d3e4f5a6b7")

_PROPOSED_BY = "import:conv_simple_electrical"
_APPROVAL_STATE = "proposed"  # migration 026 default; stated explicitly for clarity
_DEFAULT_MODEL_DIR = Path("plc/conv_simple_electrical/model")
_DEFAULT_ASSET = "cv-101"

# migration 026 CHECK: function_class IN ('power','signal','safety','comm','ground','unknown')
_VALID_FUNCTION_CLASSES = {"power", "signal", "safety", "comm", "ground", "unknown"}


# ---------------------------------------------------------------------------
# Pure core — no DB, no network (unit-tested against the real YAML)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WiringRow:
    """One `wiring_connections` row, computed deterministically from the model."""

    source_entity_id: str
    source_terminal: str
    dest_entity_id: str
    dest_terminal: str
    wire_number: Optional[str]
    function_class: str
    drawing_reference: str
    approval_state: str
    proposed_by: str
    evidence_summary: dict[str, Any]
    # carried for readability/tests; not a table column
    source_label: str = field(default="")
    dest_label: str = field(default="")

    def natural_key(self) -> tuple:
        """Dedup identity (no UNIQUE constraint exists on the table — see §note)."""
        return (
            self.source_entity_id,
            self.source_terminal,
            self.dest_entity_id,
            self.dest_terminal,
            self.wire_number,
        )


def entity_id(asset: str, device_tag: str) -> str:
    """Deterministic soft-FK id for a device tag under an asset (uuid5)."""
    return str(uuid.uuid5(NAMESPACE, f"{asset}:{device_tag}"))


def split_endpoint(endpoint: str) -> tuple[str, str]:
    """`"PLC1.I-00"` -> `("PLC1", "I-00")`; a bus node with no dot -> `(label, label)`."""
    ep = (endpoint or "").strip()
    if "." in ep:
        dev, term = ep.split(".", 1)
        return dev.strip(), term.strip()
    return ep, ep  # bus/rail node: device == terminal label


def classify_function(signal: str, wire_type: str) -> str:
    """Derive `function_class` from the wire's own `signal`/`type` — never invented.

    Safety (e-stop) wins; then ground (0V/common); then power (+24 VDC distribution);
    then signal (24 VDC inputs). Falls back to 'unknown' (a valid CHECK value)."""
    s = (signal or "").lower()
    t = (wire_type or "").lower()
    if "e_stop" in s or "estop" in s or "e-stop" in s:
        return "safety"
    if t == "control_0v" or "0v" in s or "common" in s:
        return "ground"
    if t == "control_24vdc" or "+24" in s or "24 vdc" in s and "input" not in t:
        return "power"
    if t.startswith("input"):
        return "signal"
    return "unknown"


def _verified_terminal_index(terminals_doc: dict[str, Any]) -> set[str]:
    """`{"PLC1.I-00", ...}` for terminals whose model status is `verified`."""
    verified: set[str] = set()
    for device, spec in (terminals_doc or {}).items():
        if not isinstance(spec, dict):
            continue
        for group in ("inputs", "outputs", "terminals"):
            for t in spec.get(group, []) or []:
                if isinstance(t, dict) and t.get("status") == "verified" and t.get("id"):
                    verified.add(f"{device}.{t['id']}")
    return verified


def load_wiring_rows(model_dir: Path, asset: str = _DEFAULT_ASSET) -> list[WiringRow]:
    """Parse `wires.yaml` (+ `terminals.yaml`/`devices.yaml` for provenance) into rows.

    Pure: no DB, no network. Every conductor in `wires.yaml` becomes one proposed row;
    each row's `evidence_summary` preserves the model `status`, signal, type, raw
    endpoints, the source file, and whether each endpoint terminal is `verified` in
    `terminals.yaml`. Nothing is invented — unknown physical attrs (gauge/color/cable)
    are left NULL.
    """
    wires_doc = _load_yaml(model_dir / "wires.yaml")
    terminals_doc = _load_yaml(model_dir / "terminals.yaml")
    devices_doc = _load_yaml(model_dir / "devices.yaml")

    sheet = wires_doc.get("sheet", "")
    signal_family = wires_doc.get("signal_family", "")
    verified_terms = _verified_terminal_index(terminals_doc)
    device_types = {
        d.get("tag"): d.get("type")
        for d in (devices_doc.get("devices", []) or [])
        if isinstance(d, dict) and d.get("tag")
    }
    source_rel = f"{model_dir.as_posix()}/wires.yaml"

    rows: list[WiringRow] = []
    for w in wires_doc.get("wires", []) or []:
        if not isinstance(w, dict) or not w.get("from") or not w.get("to"):
            continue
        src_dev, src_term = split_endpoint(w["from"])
        dst_dev, dst_term = split_endpoint(w["to"])
        signal = w.get("signal", "")
        wire_type = w.get("type", "")
        model_status = w.get("status", "")

        fclass = classify_function(signal, wire_type)
        if fclass not in _VALID_FUNCTION_CLASSES:  # defensive; classify never returns other
            fclass = "unknown"

        rows.append(
            WiringRow(
                source_entity_id=entity_id(asset, src_dev),
                source_terminal=src_term,
                dest_entity_id=entity_id(asset, dst_dev),
                dest_terminal=dst_term,
                wire_number=w.get("proposed_number") or None,
                function_class=fclass,
                drawing_reference=f"{sheet}: {signal}".strip(": ").strip(),
                approval_state=_APPROVAL_STATE,
                proposed_by=_PROPOSED_BY,
                evidence_summary={
                    "source": source_rel,
                    "asset": asset,
                    "sheet": sheet,
                    "signal_family": signal_family,
                    "signal": signal,
                    "wire_type": wire_type,
                    "model_status": model_status,  # field_verify — preserved verbatim
                    "from": w["from"],
                    "to": w["to"],
                    "source_device_type": device_types.get(src_dev),
                    "dest_device_type": device_types.get(dst_dev),
                    "source_terminal_verified": f"{src_dev}.{src_term}" in verified_terms,
                    "dest_terminal_verified": f"{dst_dev}.{dst_term}" in verified_terms,
                },
                source_label=w["from"],
                dest_label=w["to"],
            )
        )
    return rows


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


# ---------------------------------------------------------------------------
# DB glue — dedup then insert (idempotent; the table has no UNIQUE constraint)
# ---------------------------------------------------------------------------

_DEDUP_SQL = """
    SELECT id FROM wiring_connections
     WHERE tenant_id = %s::uuid
       AND source_entity_id = %s::uuid AND source_terminal = %s
       AND dest_entity_id = %s::uuid AND dest_terminal = %s
       AND wire_number IS NOT DISTINCT FROM %s
     LIMIT 1
"""

_INSERT_SQL = """
    INSERT INTO wiring_connections
        (tenant_id, source_entity_id, source_terminal, dest_entity_id, dest_terminal,
         wire_number, cable_id, gauge_awg, color, function_class,
         drawing_reference, approval_state, proposed_by, evidence_summary)
    VALUES
        (%s::uuid, %s::uuid, %s, %s::uuid, %s,
         %s, NULL, NULL, NULL, %s,
         %s, %s, %s, %s::jsonb)
"""


def write_rows(cur, tenant_id: str, rows: list[WiringRow]) -> tuple[int, int]:
    """Insert each row unless an identical one already exists. Returns (inserted, skipped).

    Idempotent by construction: the dedup SELECT on the natural key means re-running is
    a no-op. `cur` is a live DB cursor owned by the caller's transaction."""
    inserted, skipped = 0, 0
    for r in rows:
        cur.execute(
            _DEDUP_SQL,
            (
                tenant_id,
                r.source_entity_id,
                r.source_terminal,
                r.dest_entity_id,
                r.dest_terminal,
                r.wire_number,
            ),
        )
        if cur.fetchone():
            skipped += 1
            continue
        cur.execute(
            _INSERT_SQL,
            (
                tenant_id,
                r.source_entity_id,
                r.source_terminal,
                r.dest_entity_id,
                r.dest_terminal,
                r.wire_number,
                r.function_class,
                r.drawing_reference,
                r.approval_state,
                r.proposed_by,
                json.dumps(r.evidence_summary),
            ),
        )
        inserted += 1
    return inserted, skipped


def _dry_run_line(r: WiringRow) -> str:
    return (
        f"[dry-run] {r.source_label} -> {r.dest_label}  "
        f"[{r.function_class}] wire={r.wire_number} "
        f"({r.approval_state}, model_status={r.evidence_summary.get('model_status')})"
    )


def main(argv: Optional[list[str]] = None) -> int:  # pragma: no cover - DB glue
    parser = argparse.ArgumentParser(
        description="Import cited electrical-model YAML into wiring_connections."
    )
    parser.add_argument(
        "--tenant-id",
        default=os.getenv("MIRA_TENANT_ID"),
        help="owning tenant UUID (or MIRA_TENANT_ID)",
    )
    parser.add_argument(
        "--asset", default=_DEFAULT_ASSET, help="asset slug for deterministic endpoint ids"
    )
    parser.add_argument(
        "--model-dir",
        default=str(_DEFAULT_MODEL_DIR),
        help="dir holding wires.yaml/terminals.yaml/devices.yaml",
    )
    parser.add_argument("--dry-run", action="store_true", help="print rows; write nothing")
    parser.add_argument("--database-url", default=None, help="override NEON_DATABASE_URL")
    args = parser.parse_args(argv)

    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass

    rows = load_wiring_rows(Path(args.model_dir), asset=args.asset)
    if not rows:
        print(f"No wire records found under {args.model_dir} — nothing to import.", file=sys.stderr)
        return 1

    if args.dry_run:
        for r in rows:
            print(_dry_run_line(r))
        print(f"[dry-run] {len(rows)} connection(s) would be proposed for asset {args.asset}.")
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
            # RLS: scope reads+writes to this tenant (mirrors proposal_writer.py).
            cur.execute("SELECT set_config('app.current_tenant_id', %s, true)", (args.tenant_id,))
            inserted, skipped = write_rows(cur, args.tenant_id, rows)
        conn.commit()
    finally:
        conn.close()

    print(
        f"wiring_connections: proposed {inserted} new connection(s), "
        f"skipped {skipped} already-present (asset {args.asset})."
    )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
