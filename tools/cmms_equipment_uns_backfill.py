"""Backfill cmms_equipment rows through the asset bridge (#3708, step 4).

A machine is placed when it has BOTH `cmms_equipment.uns_path` and a
`kg_entities` equipment node carrying the same path — every Hub consumer that
needs a location (notebook, V3 scope picker, machine memory / history /
signal-history via `resolveAssetUnsPath`) reads the NODE. The previous version
of this script stamped only the column, in the ISA-95 grammar, so the rows it
touched on 2026-09-09 still had no machine memory.

This version runs `shared.asset_bridge.bridge_asset` — the Python mirror of
the Hub's `mintAssetBridgeNode` → `backfillAssetUnsPath` — for every row that
lacks a node, then reconciles the column to the node's path when they differ
(the bridge itself only fills a NULL column). It ends with a verification
query and, in --commit mode, exits non-zero unless every bridgeable row has a
path, a node, and agreement between them.

Rows whose tenant_id is not a UUID (legacy slugs — `cmms_equipment.tenant_id`
is TEXT) cannot have a kg_entities node at all and are reported separately;
they are not counted as stamped.

Usage:
    python tools/cmms_equipment_uns_backfill.py                 # dry-run report
    python tools/cmms_equipment_uns_backfill.py --commit        # bridge + verify
    python tools/cmms_equipment_uns_backfill.py --tenant <uuid> --commit

Dispatched by .github/workflows/apply-migrations.yml (run_backfill=true),
staging first, then prod on a separate explicit decision.
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "mira-bots"))
from shared.asset_bridge import bridge_asset  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("cmms-uns-backfill")

_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
_UUID_SQL_RE = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"


@dataclass
class Stats:
    scanned: int = 0
    nodes_created: int = 0
    nodes_existing: int = 0
    column_set: int = 0  # NULL → node path (the bridge's own backfill)
    column_reconciled: int = 0  # non-NULL, different → node path
    legacy_tenant: int = 0  # tenant_id not a UUID: cannot be bridged
    failed: dict[str, int] = field(default_factory=dict)


@dataclass(frozen=True)
class Verification:
    total: int
    legacy_tenant_rows: int
    missing_path: int
    missing_node: int
    mismatched: int

    @property
    def clean(self) -> bool:
        """Every bridgeable row has a path, a node, and the two agree."""
        return self.missing_path == 0 and self.missing_node == 0 and self.mismatched == 0


def _engine():
    url = os.getenv("NEON_DATABASE_URL")
    if not url:
        raise RuntimeError("NEON_DATABASE_URL not set")
    return create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )


# Rows that still need work: no node, or a node whose path differs from the column.
_SELECT_PENDING = """
    SELECT e.id::text        AS id,
           e.tenant_id,
           e.equipment_number,
           e.description,
           e.manufacturer,
           e.model_number,
           e.uns_path::text  AS current_path,
           k.uns_path::text  AS node_path
      FROM cmms_equipment e
      LEFT JOIN kg_entities k
        ON k.entity_type = 'equipment'
       AND k.entity_id = e.id::text
       AND k.tenant_id::text = e.tenant_id
     WHERE (k.id IS NULL OR e.uns_path IS NULL OR k.uns_path IS DISTINCT FROM e.uns_path)
       {tenant_clause}
     ORDER BY e.tenant_id, e.id
"""

_VERIFY = """
    SELECT count(*)                                                            AS total,
           count(*) FILTER (WHERE e.tenant_id !~ :uuid_re)                     AS legacy_tenant_rows,
           count(*) FILTER (WHERE e.tenant_id ~ :uuid_re AND e.uns_path IS NULL) AS missing_path,
           count(*) FILTER (WHERE e.tenant_id ~ :uuid_re AND k.id IS NULL)       AS missing_node,
           count(*) FILTER (WHERE e.tenant_id ~ :uuid_re AND k.id IS NOT NULL
                              AND e.uns_path IS NOT NULL AND k.uns_path <> e.uns_path) AS mismatched
      FROM cmms_equipment e
      LEFT JOIN kg_entities k
        ON k.entity_type = 'equipment'
       AND k.entity_id = e.id::text
       AND k.tenant_id::text = e.tenant_id
     WHERE TRUE {tenant_clause}
"""


def _tenant_clause(tenant: str | None) -> tuple[str, dict]:
    if tenant:
        return "AND e.tenant_id = :tenant", {"tenant": tenant}
    return "", {}


def verify(engine, tenant: str | None) -> Verification:
    clause, params = _tenant_clause(tenant)
    with engine.connect() as c:
        row = c.execute(
            text(_VERIFY.format(tenant_clause=clause)), {**params, "uuid_re": _UUID_SQL_RE}
        ).one()
    return Verification(
        total=int(row.total),
        legacy_tenant_rows=int(row.legacy_tenant_rows),
        missing_path=int(row.missing_path),
        missing_node=int(row.missing_node),
        mismatched=int(row.mismatched),
    )


def bridge_row(cur, row, stats: Stats) -> None:
    """Bridge ONE row on the given DB-API cursor; reconcile the column to the node."""
    if not _UUID_RE.match(row.tenant_id or ""):
        stats.legacy_tenant += 1
        return
    tag = (row.equipment_number or "").strip() or row.id
    res = bridge_asset(
        cur,
        row.tenant_id,
        row.id,
        tag,
        description=row.description,
        manufacturer=row.manufacturer,
        model=row.model_number,
    )
    if not res.ok:
        stats.failed[res.reason or "unknown"] = stats.failed.get(res.reason or "unknown", 0) + 1
        log.warning("row %s (tenant %s): bridge failed — %s", row.id, row.tenant_id, res.reason)
        return
    if res.created:
        stats.nodes_created += 1
    else:
        stats.nodes_existing += 1
    if row.current_path is None:
        stats.column_set += 1  # bridge_asset's own NULL-only backfill did it
    elif row.current_path != res.uns_path:
        cur.execute(
            """UPDATE cmms_equipment
                  SET uns_path = %s::ltree, updated_at = now()
                WHERE tenant_id = %s AND id = %s::uuid""",
            (res.uns_path, row.tenant_id, row.id),
        )
        stats.column_reconciled += 1


def run(tenant: str | None, batch_size: int, commit: bool) -> tuple[Stats, Verification]:
    engine = _engine()
    stats = Stats()
    clause, params = _tenant_clause(tenant)
    with engine.connect() as c:
        rows = list(c.execute(text(_SELECT_PENDING.format(tenant_clause=clause)), params))
    stats.scanned = len(rows)
    log.info("%d cmms_equipment rows lack a node, a path, or agreement between them", len(rows))

    if not commit:
        log.warning("DRY-RUN — %d rows would be bridged. Pass --commit to apply.", len(rows))
        for r in rows[:10]:
            log.info(
                "  would bridge %s (tenant %s, %r): column=%s node=%s",
                r.id,
                r.tenant_id,
                r.equipment_number,
                r.current_path,
                r.node_path,
            )
        if len(rows) > 10:
            log.info("  … and %d more", len(rows) - 10)
        return stats, verify(engine, tenant)

    for start in range(0, len(rows), batch_size):
        chunk = rows[start : start + batch_size]
        with engine.begin() as c:
            cur = c.connection.cursor()  # same DBAPI connection → same transaction
            for r in chunk:
                bridge_row(cur, r, stats)
        log.info("committed %d / %d", min(start + batch_size, len(rows)), len(rows))
    return stats, verify(engine, tenant)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--tenant", help="Restrict to one tenant_id (UUID)")
    p.add_argument("--batch-size", type=int, default=200)
    p.add_argument("--commit", action="store_true", help="Apply writes (default = dry-run)")
    args = p.parse_args()
    stats, v = run(args.tenant, args.batch_size, args.commit)
    log.info(
        "=== CMMS UNS BACKFILL VIA ASSET BRIDGE %s ===", "COMMIT" if args.commit else "DRY-RUN"
    )
    log.info("  rows needing work:      %d", stats.scanned)
    log.info("  nodes created:          %d", stats.nodes_created)
    log.info("  nodes already present:  %d", stats.nodes_existing)
    log.info("  column set (was NULL):  %d", stats.column_set)
    log.info("  column reconciled:      %d", stats.column_reconciled)
    log.info(
        "  legacy-tenant rows:     %d (non-UUID tenant_id — cannot carry a node)",
        stats.legacy_tenant,
    )
    log.info("  failed:                 %s", stats.failed or "0")
    log.info("=== VERIFICATION (bridgeable rows) ===")
    log.info(
        "  total rows:             %d (of which legacy-tenant: %d)", v.total, v.legacy_tenant_rows
    )
    log.info("  missing uns_path:       %d", v.missing_path)
    log.info("  missing kg node:        %d", v.missing_node)
    log.info("  column ≠ node path:     %d", v.mismatched)
    if args.commit and not v.clean:
        log.error("NOT CLEAN — some bridgeable rows still lack a path, a node, or agreement")
        return 1
    log.info(
        "%s",
        "CLEAN — every bridgeable row has uns_path + its KG node, and they agree"
        if v.clean
        else "dry-run: see counts above",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
