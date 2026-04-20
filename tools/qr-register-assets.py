#!/usr/bin/env python3
"""MIRA Asset Registration Helper.

Bulk-register asset tags into NeonDB `asset_qr_tags`. Idempotent (ON CONFLICT DO NOTHING).

Usage:
  # From CLI args
  python3 tools/qr-register-assets.py --tenant-id <uuid> --tags VFD-07,PUMP-03

  # From CSV (columns: asset_tag, asset_name)
  python3 tools/qr-register-assets.py --tenant-id <uuid> --csv assets.csv

  # With channel config
  python3 tools/qr-register-assets.py --tenant-id <uuid> --tags VFD-07 --channels openwebui,telegram

CSV format:
  asset_tag,asset_name
  VFD-07,GS10 VFD Line 1
  PUMP-03,Coolant Pump
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
import uuid as uuid_mod


def connect():
    import psycopg2  # noqa: PLC0415
    url = os.environ.get("NEON_DATABASE_URL", "")
    if not url:
        sys.exit("NEON_DATABASE_URL not set — run via: doppler run --project factorylm --config prd -- python3 ...")
    return psycopg2.connect(url)


def register(conn, tenant_id: str, tags: list[tuple[str, str]]) -> int:
    cur = conn.cursor()
    inserted = 0
    for asset_tag, asset_name in tags:
        cur.execute(
            """
            INSERT INTO asset_qr_tags (id, tenant_id, asset_tag, asset_name, created_at)
            VALUES (%s, %s, %s, %s, NOW())
            ON CONFLICT (tenant_id, asset_tag) DO NOTHING
            """,
            (str(uuid_mod.uuid4()), tenant_id, asset_tag, asset_name or asset_tag),
        )
        if cur.rowcount:
            inserted += 1
    conn.commit()
    return inserted


def main() -> None:
    parser = argparse.ArgumentParser(description="MIRA Bulk Asset Registration")
    parser.add_argument("--tenant-id", required=True, help="Tenant UUID")
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--tags", help="Comma-separated asset tags")
    src.add_argument("--csv", dest="csv_path", help="Path to CSV file (asset_tag,asset_name)")
    parser.add_argument("--channels", default="openwebui",
                        help="Comma-separated channels (openwebui,telegram,guest)")
    args = parser.parse_args()

    if args.tags:
        pairs = [(t.strip(), t.strip()) for t in args.tags.split(",") if t.strip()]
    else:
        pairs = []
        with open(args.csv_path, newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                tag = row.get("asset_tag", "").strip()
                name = row.get("asset_name", "").strip()
                if tag:
                    pairs.append((tag, name or tag))

    if not pairs:
        sys.exit("No tags to register.")

    conn = connect()
    inserted = register(conn, args.tenant_id, pairs)
    skipped = len(pairs) - inserted
    conn.close()

    print(f"Registered {inserted} new tag(s), {skipped} already existed.")
    for tag, name in pairs:
        print(f"  {tag}: {name}")
        print(f"    → https://app.factorylm.com/m/{tag}")


if __name__ == "__main__":
    main()
