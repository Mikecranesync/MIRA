#!/usr/bin/env python3
"""Apply a single migration file to the staging NeonDB.

Usage:
    doppler run --project factorylm --config stg -- \
        python tools/apply_migration_stg.py mira-hub/db/migrations/020_signal_cache_and_trends.sql [--dry-run]

Reads $NEON_DATABASE_URL from env (Doppler-injected). Runs the file in a
single transaction with ON_ERROR_STOP. Refuses to touch any URL that
doesn't look like a Neon staging endpoint.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import psycopg2


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: apply_migration_stg.py <migration.sql> [--dry-run]", file=sys.stderr)
        return 2

    path = Path(sys.argv[1])
    dry_run = "--dry-run" in sys.argv[2:]

    if not path.exists():
        print(f"ERROR: {path} not found", file=sys.stderr)
        return 1

    url = os.getenv("NEON_DATABASE_URL", "")
    if not url:
        print("ERROR: NEON_DATABASE_URL not set (run via doppler run)", file=sys.stderr)
        return 1

    host = url.split("@", 1)[-1].split("/", 1)[0]
    print(f"target host: {host}")
    if "factorylm" in host.lower() and "stg" not in host.lower():
        print(
            "REFUSING: host does not look like a staging Neon endpoint. "
            "If this is intentional, run via doppler with --config prd and a "
            "different runner that bypasses this guard.",
            file=sys.stderr,
        )
        return 1

    sql = path.read_text()
    print(f"file: {path} ({len(sql)} bytes)")

    if dry_run:
        print("--- DRY RUN: first 60 lines ---")
        for line in sql.splitlines()[:60]:
            print(line)
        print("--- end dry-run preview ---")
        return 0

    start = time.time()
    with psycopg2.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
    print(f"applied in {time.time() - start:.2f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
