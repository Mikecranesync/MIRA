#!/usr/bin/env python3
"""Backfill the UNS asset hierarchy from a tenant-supplied CSV.

Schema target: `assets` (migration 011_assets_uns.sql).

CSV format (header row required):
    asset_tag,uns_path,name,atlas_asset_id
    AT-0001,acme.site_a.line_2.cell_3,VFD #1,1234
    AT-0002,acme.site_a.line_2.cell_4,VFD #2,1235
    ,acme.site_a,Site A,
    ,acme.site_a.line_2,Line 2,

Rows without `asset_tag` are still inserted (they represent intermediate
nodes in the hierarchy that don't carry QR codes — sites, lines, cells).

Usage:
    # Dry run — print what would be inserted
    NEON_DATABASE_URL=... MIRA_TENANT_ID=... \
        python3 backfill_uns.py --csv ./hierarchy.csv --dry-run

    # Apply
    NEON_DATABASE_URL=... MIRA_TENANT_ID=... \
        python3 backfill_uns.py --csv ./hierarchy.csv

The script is idempotent: it uses ON CONFLICT (tenant_id, uns_path) DO
UPDATE so re-running with an updated CSV refreshes name / asset_tag /
atlas_asset_id without producing duplicate rows.

Per CLAUDE.md feedback_no_throwaway_scripts.md: this is a versioned
pipeline command, not a throwaway. Use --dry-run to preview before
applying.
"""

from __future__ import annotations

import argparse
import csv
import logging
import os
import re
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("backfill-uns")

_LTREE_PATH_RE = re.compile(r"^[A-Za-z0-9_]{1,256}(\.[A-Za-z0-9_]{1,256})*$")


def _load_csv(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise SystemExit(f"{path} is empty")
    required = {"asset_tag", "uns_path", "name", "atlas_asset_id"}
    missing = required - set(rows[0].keys())
    if missing:
        raise SystemExit(f"{path} missing required columns: {sorted(missing)}")
    return rows


def _validate(rows: list[dict]) -> list[dict]:
    """Reject malformed paths early; return cleaned rows."""
    cleaned = []
    seen_paths: set[str] = set()
    for i, r in enumerate(rows, start=2):  # row 1 is the header
        path = (r.get("uns_path") or "").strip()
        if not _LTREE_PATH_RE.fullmatch(path):
            raise SystemExit(
                f"row {i}: invalid uns_path {path!r} — labels must be "
                "[A-Za-z0-9_], separated by dots"
            )
        if path in seen_paths:
            raise SystemExit(f"row {i}: duplicate uns_path {path!r}")
        seen_paths.add(path)
        cleaned.append(
            {
                "uns_path": path,
                "asset_tag": (r.get("asset_tag") or "").strip() or None,
                "name": (r.get("name") or "").strip() or None,
                "atlas_asset_id": (r.get("atlas_asset_id") or "").strip() or None,
            }
        )
    return cleaned


def _connect():
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        raise SystemExit("NEON_DATABASE_URL is not set")
    from sqlalchemy import create_engine, text  # noqa: PLC0415
    from sqlalchemy.pool import NullPool  # noqa: PLC0415

    engine = create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )
    return engine, text


def _upsert(rows: list[dict], tenant_id: str, dry_run: bool) -> None:
    if dry_run:
        for r in rows:
            logger.info(
                "[dry-run] would upsert tenant=%s path=%s tag=%s name=%s atlas=%s",
                tenant_id,
                r["uns_path"],
                r["asset_tag"],
                r["name"],
                r["atlas_asset_id"],
            )
        logger.info("[dry-run] %d rows would be upserted", len(rows))
        return

    engine, text = _connect()
    sql = text(
        """
        INSERT INTO assets (tenant_id, uns_path, asset_tag, name, atlas_asset_id)
        VALUES (:tid, :path::ltree, :tag, :name, :atlas)
        ON CONFLICT (tenant_id, uns_path) DO UPDATE SET
            asset_tag      = EXCLUDED.asset_tag,
            name           = EXCLUDED.name,
            atlas_asset_id = EXCLUDED.atlas_asset_id,
            updated_at     = NOW()
        """
    )
    inserted = 0
    with engine.begin() as conn:
        for r in rows:
            conn.execute(
                sql,
                {
                    "tid": tenant_id,
                    "path": r["uns_path"],
                    "tag": r["asset_tag"],
                    "name": r["name"],
                    "atlas": r["atlas_asset_id"],
                },
            )
            inserted += 1
    logger.info("Upserted %d rows for tenant=%s", inserted, tenant_id)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument(
        "--csv",
        type=Path,
        required=True,
        help="Path to hierarchy CSV (asset_tag,uns_path,name,atlas_asset_id)",
    )
    parser.add_argument(
        "--tenant-id",
        default=os.environ.get("MIRA_TENANT_ID", ""),
        help="Tenant UUID. Defaults to $MIRA_TENANT_ID.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would happen without writing.",
    )
    args = parser.parse_args()

    if not args.tenant_id:
        logger.error("--tenant-id (or MIRA_TENANT_ID) required")
        return 2

    rows = _load_csv(args.csv)
    cleaned = _validate(rows)
    logger.info("Loaded %d rows from %s", len(cleaned), args.csv)
    _upsert(cleaned, args.tenant_id, args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
