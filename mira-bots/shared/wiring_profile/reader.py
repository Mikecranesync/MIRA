"""Read-only assembly of a `MachineWiringProfile` from `wiring_connections`.

Doctrine enforced here:
- **Read-only.** `load_profile` issues a SELECT only — no writes, no control.
  Writers already exist (`tools/wiring_map_import.py`,
  `tools/wiring_schematic_import.py`); this module never duplicates them.
- **Never invent.** `profile_from_rows` coerces DB-shaped rows into
  `WiringConnection` without filling in missing optional fields — absent
  stays `None`, `function_class` passes through verbatim (including the
  literal string `'unknown'`).
- **Preserve provenance.** `evidence_summary` and `drawing_reference`
  round-trip byte-for-byte (parsed once from JSON text if the driver hands
  back a string; left as-is if already a dict).
- `psycopg2` is imported ONLY inside `main()` (local import) so this module
  stays importable without the DB driver installed — mirrors
  `tools/wiring_map_import.py`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Iterable, Mapping
from typing import Any, Optional, Union

from .schema import MachineWiringProfile, WiringConnection

_SELECT_SQL = """
    SELECT source_entity_id, source_terminal, dest_entity_id, dest_terminal,
           wire_number, cable_id, gauge_awg, color, function_class,
           drawing_reference, approval_state, proposed_by, evidence_summary
      FROM wiring_connections
     WHERE tenant_id = %s::uuid
       AND (%s::text IS NULL OR evidence_summary->>'asset' = %s)
"""

_ROW_FIELDS = (
    "source_entity_id",
    "source_terminal",
    "dest_entity_id",
    "dest_terminal",
    "wire_number",
    "cable_id",
    "gauge_awg",
    "color",
    "function_class",
    "drawing_reference",
    "approval_state",
    "proposed_by",
    "evidence_summary",
)


def _coerce_evidence(raw: Any) -> dict[str, Any]:
    """`evidence_summary` may arrive as a dict (psycopg2 JSONB), a JSON
    string (some drivers/fixtures), or None. Never invented — an
    unparseable/absent value becomes an empty dict, nothing more."""
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _row_to_connection(row: Union[Mapping[str, Any], WiringConnection]) -> WiringConnection:
    if isinstance(row, WiringConnection):
        return row
    return WiringConnection(
        source_entity_id=str(row.get("source_entity_id") or ""),
        source_terminal=str(row.get("source_terminal") or ""),
        dest_entity_id=str(row.get("dest_entity_id") or ""),
        dest_terminal=str(row.get("dest_terminal") or ""),
        wire_number=row.get("wire_number"),
        cable_id=row.get("cable_id"),
        gauge_awg=row.get("gauge_awg"),
        color=row.get("color"),
        function_class=row.get("function_class"),  # never coerced/upgraded
        drawing_reference=row.get("drawing_reference"),
        approval_state=str(row.get("approval_state") or "proposed"),
        proposed_by=row.get("proposed_by"),
        evidence_summary=_coerce_evidence(row.get("evidence_summary")),
    )


def profile_from_rows(
    rows: Iterable[Union[Mapping[str, Any], WiringConnection]],
    asset: str,
    tenant_id: Optional[str] = None,
) -> MachineWiringProfile:
    """Build a `MachineWiringProfile` from DB-shaped dict rows or already-built
    `WiringConnection`s. Pure — no DB, no network."""
    connections = tuple(_row_to_connection(r) for r in rows)
    return MachineWiringProfile(asset=asset, tenant_id=tenant_id, connections=connections)


def load_profile(
    cur, tenant_id: str, asset: Optional[str] = None
) -> MachineWiringProfile:  # pragma: no cover - DB glue
    """DB glue: SELECT-only read of `wiring_connections` for `tenant_id`
    (optionally scoped to one `asset` via `evidence_summary->>'asset'`).

    `cur` is a live DB cursor owned by the caller's transaction (mirrors
    `wiring_map_import.write_rows`). Sets `app.current_tenant_id` for RLS,
    exactly like the writer does before its own queries.
    """
    cur.execute("SELECT set_config('app.current_tenant_id', %s, true)", (tenant_id,))
    cur.execute(_SELECT_SQL, (tenant_id, asset, asset))
    rows = [dict(zip(_ROW_FIELDS, r)) for r in cur.fetchall()]
    return profile_from_rows(rows, asset=asset or "", tenant_id=tenant_id)


def _render_human(profile: MachineWiringProfile) -> str:
    return (
        f"asset:         {profile.asset}\n"
        f"total:         {len(profile.connections)}\n"
        f"approved:      {len(profile.approved)}\n"
        f"proposed:      {len(profile.proposed)}\n"
        f"needs_review:  {len(profile.needs_review)}\n"
        f"rejected:      {len(profile.rejected)}"
    )


def main(argv: Optional[list[str]] = None) -> int:  # pragma: no cover - DB glue
    parser = argparse.ArgumentParser(
        description="Read-only: assemble a MachineWiringProfile from wiring_connections."
    )
    parser.add_argument(
        "--tenant-id",
        default=os.getenv("MIRA_TENANT_ID"),
        help="owning tenant UUID (or MIRA_TENANT_ID)",
    )
    parser.add_argument(
        "--asset", default=None, help="scope to one asset (evidence_summary->>'asset')"
    )
    parser.add_argument("--database-url", default=None, help="override NEON_DATABASE_URL")
    parser.add_argument("--json", action="store_true", help="emit split counts as JSON")
    args = parser.parse_args(argv)

    if not args.tenant_id:
        print("ERROR: set --tenant-id or MIRA_TENANT_ID (required to read)", file=sys.stderr)
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
            profile = load_profile(cur, args.tenant_id, asset=args.asset)
    finally:
        conn.close()

    if args.json:
        print(
            json.dumps(
                {
                    "asset": profile.asset,
                    "total": len(profile.connections),
                    "approved": len(profile.approved),
                    "proposed": len(profile.proposed),
                    "needs_review": len(profile.needs_review),
                    "rejected": len(profile.rejected),
                },
                indent=2,
            )
        )
    else:
        print(_render_human(profile))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
