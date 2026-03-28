#!/usr/bin/env python3
"""Backup NeonDB tables to JSON files for safe rollback before re-ingest.

Usage:
    doppler run --project factorylm --config prd -- python3 mira-core/scripts/backup_knowledge_base.py
"""
from __future__ import annotations

import gzip
import json
import os
import sys
from datetime import datetime
from pathlib import Path

TABLES = ["knowledge_entries", "fault_codes", "source_fingerprints", "manual_cache", "manuals"]


def main():
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        print("ERROR: NEON_DATABASE_URL not set")
        sys.exit(1)

    try:
        from sqlalchemy import create_engine, text
        from sqlalchemy.pool import NullPool
    except ImportError:
        print("ERROR: sqlalchemy not installed")
        sys.exit(1)

    engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})

    # Verify connection
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print("NeonDB connection OK")
    except Exception as e:
        print(f"ERROR: Cannot connect to NeonDB: {e}")
        sys.exit(1)

    timestamp = datetime.utcnow().strftime("%Y-%m-%d_%H%M%S")
    backup_dir = Path("backups") / timestamp
    backup_dir.mkdir(parents=True, exist_ok=True)

    manifest_lines = [f"MIRA NeonDB Backup", f"Timestamp: {timestamp}", "---"]

    for table in TABLES:
        print(f"Backing up {table}...")
        try:
            with engine.connect() as conn:
                count = conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar() or 0
                rows = conn.execute(text(f"SELECT * FROM {table}")).mappings().fetchall()
        except Exception as e:
            print(f"  WARNING: {table} failed: {e}")
            manifest_lines.append(f"{table}: ERROR ({e})")
            continue

        manifest_lines.append(f"{table}: {count} rows")

        # Write as gzipped JSON lines
        outpath = backup_dir / f"{table}.jsonl.gz"
        with gzip.open(outpath, "wt", encoding="utf-8") as f:
            for row in rows:
                # Convert non-serializable types to strings
                d = {}
                for k, v in dict(row).items():
                    if isinstance(v, (datetime,)):
                        d[k] = v.isoformat()
                    elif isinstance(v, bytes):
                        d[k] = v.hex()
                    else:
                        d[k] = v
                f.write(json.dumps(d, default=str) + "\n")

        size_kb = outpath.stat().st_size / 1024
        print(f"  → {count} rows, {size_kb:.1f} KB compressed")

    manifest_lines.extend([
        "---",
        f"Restore: gunzip + load JSON lines back via insert script",
    ])

    manifest_path = backup_dir / "MANIFEST.txt"
    manifest_path.write_text("\n".join(manifest_lines) + "\n")

    print(f"\nBackup complete: {backup_dir}/")
    print(f"Manifest:")
    for line in manifest_lines:
        print(f"  {line}")


if __name__ == "__main__":
    main()
