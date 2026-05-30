"""Backfill cmms_equipment.uns_path using the ISA-95 hierarchy.

Spec: docs/specs/uns-kg-unification-spec.md §3.1 (per-company site
hierarchy).
Helper module: mira-crawler/ingest/uns.py (path grammar, slug rules).
Schema: migration 015_equipment_uns_path.sql adds the column.

Path grammar:
    enterprise.{tenant}.site.{site}.area.{area}[.line.{line}
        [.work_cell.{cell}]].equipment.{equipment_number}

cmms_equipment doesn't carry first-class site/area/line/work_cell
columns yet — that's a future schema change. For now we derive the
hierarchy from the existing free-form fields:

    site   ← location  (or "unassigned" if NULL)
    area   ← department (or "unassigned" if NULL)
    line   ← omitted (no source column)
    cell   ← omitted (no source column)

This produces a valid ltree path for every row and keeps the
ISA-95 marker structure that the Hub UNS browser walks. When the
schema grows real columns, this script's `_derive_path()` helper
is the single spot to update.

Idempotent: only writes rows where uns_path IS NULL, OR where
`--force` is passed and the computed path differs from the current
value.

Usage:
    python tools/cmms_equipment_uns_backfill.py                    # dry-run
    python tools/cmms_equipment_uns_backfill.py --commit           # apply
    python tools/cmms_equipment_uns_backfill.py --commit --force   # recompute all
    python tools/cmms_equipment_uns_backfill.py --tenant T1 --commit
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

# The crawler ships its ingest module both ways depending on context;
# the dev workstation path uses the hyphenated directory.
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "mira-crawler"))
from ingest.uns import (  # noqa: E402
    assigned_equipment_path,
    is_valid_path,
    slug,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("cmms-uns-backfill")


@dataclass
class Stats:
    scanned: int = 0
    updated: int = 0
    unchanged: int = 0
    skipped_invalid: int = 0


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


def _derive_path(
    tenant_id: str,
    equipment_number: str | None,
    location: str | None,
    department: str | None,
    asset_id: str,
) -> str | None:
    """Build the UNS path for a single cmms_equipment row.

    Returns None when the row lacks enough structure to form a valid
    ltree label (e.g. equipment_number is NULL and the UUID slug is
    also blank — shouldn't happen but defensive against bad data).
    """
    tenant_slug = slug(tenant_id) or "unassigned"
    site_slug = slug(location or "") or "unassigned"
    area_slug = slug(department or "") or "unassigned"
    eq_slug = slug(equipment_number or "") or slug(asset_id)
    if not eq_slug:
        return None

    path = assigned_equipment_path(
        company=tenant_slug,
        site=site_slug,
        area=area_slug,
        equipment_id=eq_slug,
    )
    return path if is_valid_path(path) else None


def run(tenant: str | None, batch_size: int, commit: bool, force: bool) -> Stats:
    engine = _engine()
    stats = Stats()

    where: list[str] = []
    params: dict = {}
    if tenant:
        where.append("tenant_id = :tenant")
        params["tenant"] = tenant
    if not force:
        where.append("uns_path IS NULL")
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""

    select_sql = f"""
        SELECT id::text       AS id,
               tenant_id,
               equipment_number,
               location,
               department,
               uns_path::text  AS current_path
          FROM cmms_equipment
          {where_sql}
         ORDER BY tenant_id, id
    """

    with engine.connect() as c:
        rows = list(c.execute(text(select_sql), params))

    log.info("scanned %d cmms_equipment rows%s", len(rows), " (forcing recompute)" if force else "")

    pending: list[tuple[str, str]] = []  # (id, new_path)

    for r in rows:
        stats.scanned += 1
        new_path = _derive_path(
            tenant_id=r.tenant_id,
            equipment_number=r.equipment_number,
            location=r.location,
            department=r.department,
            asset_id=r.id,
        )
        if not new_path:
            stats.skipped_invalid += 1
            log.debug("skipping %s — no valid path could be derived", r.id)
            continue
        if r.current_path == new_path:
            stats.unchanged += 1
            continue
        pending.append((r.id, new_path))

    if not commit:
        log.warning("DRY-RUN — %d rows would be updated. Pass --commit to apply.", len(pending))
        for asset_id, new_path in pending[:10]:
            log.info("  would set %s → %s", asset_id, new_path)
        if len(pending) > 10:
            log.info("  … and %d more", len(pending) - 10)
        return stats

    for start in range(0, len(pending), batch_size):
        chunk = pending[start : start + batch_size]
        with engine.begin() as c:
            for asset_id, new_path in chunk:
                c.execute(
                    text(
                        "UPDATE cmms_equipment "
                        "   SET uns_path = CAST(:p AS ltree) "
                        " WHERE id = CAST(:id AS uuid)"
                    ),
                    {"p": new_path, "id": asset_id},
                )
        stats.updated += len(chunk)
        log.info("committed %d / %d", stats.updated, len(pending))

    return stats


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--tenant", help="Restrict backfill to one tenant_id")
    p.add_argument("--batch-size", type=int, default=500)
    p.add_argument(
        "--commit",
        action="store_true",
        help="Apply writes (default = dry-run)",
    )
    p.add_argument(
        "--force",
        action="store_true",
        help="Recompute uns_path even for rows that already have one",
    )
    args = p.parse_args()

    stats = run(args.tenant, args.batch_size, args.commit, args.force)

    log.info("=== CMMS UNS BACKFILL %s ===", "COMMIT" if args.commit else "DRY-RUN")
    log.info("  rows scanned:     %d", stats.scanned)
    log.info("  rows updated:     %d", stats.updated)
    log.info("  rows unchanged:   %d", stats.unchanged)
    log.info("  rows skipped:     %d (no valid path could be derived)", stats.skipped_invalid)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
