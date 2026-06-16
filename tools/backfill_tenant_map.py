#!/usr/bin/env python3
"""Backfill identity_links + mira_users + chat_tenant_map for existing
Telegram users so they keep working under the new strict dispatcher gate.

Idempotent. Safe to re-run.

Usage:
    doppler run --project factorylm --config prd -- \\
        python3 tools/backfill_tenant_map.py [--dry-run]
"""

from __future__ import annotations

import argparse
import logging
import os
import sqlite3
import sys
import uuid

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("backfill")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="Print what would be inserted, don't write")
    ap.add_argument(
        "--sqlite-path",
        default=os.environ.get("MIRA_DB_PATH", "/data/mira.db"),
        help="Path to mira.db (default: $MIRA_DB_PATH or /data/mira.db)",
    )
    args = ap.parse_args()

    tenant_id = os.environ.get("MIRA_TENANT_ID", "")
    if not tenant_id:
        logger.error("MIRA_TENANT_ID not set — cannot determine which tenant to backfill into.")
        return 2

    neon_url = os.environ.get("NEON_DATABASE_URL", "")
    if not neon_url:
        logger.error("NEON_DATABASE_URL not set — cannot reach NeonDB.")
        return 2

    # Load distinct chat_ids from local SQLite conversation_state
    if not os.path.exists(args.sqlite_path):
        logger.warning("SQLite DB not found at %s — nothing to backfill.", args.sqlite_path)
        return 0

    sq = sqlite3.connect(args.sqlite_path)
    rows = sq.execute("SELECT DISTINCT chat_id FROM conversation_state").fetchall()
    sq.close()
    chat_ids = [r[0] for r in rows if r[0]]
    logger.info("Found %d distinct chat_ids in conversation_state", len(chat_ids))

    # Filter: in private DMs, chat_id == user_id (positive int as str). Group chats
    # have negative IDs; skip those — Option B is per-user, not per-group.
    candidates: list[str] = []
    for cid in chat_ids:
        try:
            n = int(cid)
            if n > 0:
                candidates.append(str(n))
        except ValueError:
            continue
    logger.info("Of those, %d look like private-DM user IDs", len(candidates))

    if args.dry_run:
        for u in candidates:
            print(f"WOULD BACKFILL telegram:{u} → tenant:{tenant_id}")
        return 0

    # Connect to NeonDB
    try:
        import psycopg
    except ModuleNotFoundError:
        logger.error("psycopg not installed — install with `uv add psycopg[binary]`")
        return 2

    inserted_users = 0
    inserted_links = 0
    with psycopg.connect(neon_url) as conn:
        with conn.cursor() as cur:
            for ext_id in candidates:
                # Skip if identity_link already exists
                cur.execute(
                    "SELECT mira_user_id FROM identity_links "
                    "WHERE platform = 'telegram' AND external_user_id = %s "
                    "  AND tenant_id = %s",
                    (ext_id, tenant_id),
                )
                if cur.fetchone():
                    continue

                user_id = str(uuid.uuid4())
                cur.execute(
                    "INSERT INTO mira_users (id, tenant_id, display_name, email) "
                    "VALUES (%s, %s, 'legacy', '') "
                    "ON CONFLICT DO NOTHING",
                    (user_id, tenant_id),
                )
                inserted_users += cur.rowcount
                cur.execute(
                    "INSERT INTO identity_links "
                    "(id, mira_user_id, platform, external_user_id, tenant_id) "
                    "VALUES (%s, %s, 'telegram', %s, %s) "
                    "ON CONFLICT DO NOTHING",
                    (str(uuid.uuid4()), user_id, ext_id, tenant_id),
                )
                inserted_links += cur.rowcount
        conn.commit()

    # Also seed chat_tenant_map (informational)
    sq = sqlite3.connect(args.sqlite_path)
    sq.execute("PRAGMA journal_mode=WAL")
    sq.execute(
        "CREATE TABLE IF NOT EXISTS chat_tenant_map ("
        "chat_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, "
        "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, "
        "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
    )
    seeded_map = 0
    for ext_id in candidates:
        cur = sq.execute(
            "INSERT OR IGNORE INTO chat_tenant_map (chat_id, tenant_id) VALUES (?, ?)",
            (ext_id, tenant_id),
        )
        seeded_map += cur.rowcount
    sq.commit()
    sq.close()

    logger.info(
        "BACKFILL_DONE inserted_users=%d inserted_links=%d seeded_chat_tenant_map=%d",
        inserted_users,
        inserted_links,
        seeded_map,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
