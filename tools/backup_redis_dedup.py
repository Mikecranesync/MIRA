#!/usr/bin/env python3
"""Backup Redis dedup sets to NeonDB kb_dedup_state table.

Dumps all mira:*:seen_* sets and mira:sitemaps:lastmod hash so they
can be restored after a Redis volume loss without re-ingesting the
entire knowledge base.

Usage:
    doppler run --project factorylm --config prd -- \
      uv run --with sqlalchemy --with psycopg2-binary --with redis \
      python tools/backup_redis_dedup.py [--dry-run]

Designed to run nightly after the ingest window (e.g. 04:30 UTC).
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import uuid
from urllib.parse import urlparse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("backup_redis_dedup")

NEON_DATABASE_URL = os.environ.get("NEON_DATABASE_URL")
CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")

# All Redis keys used for dedup state across crawler tasks.
# Format: (key_name, key_type, ttl_seconds_or_None)
DEDUP_KEYS: list[tuple[str, str, int | None]] = [
    ("mira:rss:seen_guids", "set", None),
    ("mira:reddit:seen_posts", "set", None),
    ("mira:youtube:seen_videos", "set", 90 * 86400),  # 90 days
    ("mira:sitemaps:lastmod", "hash", None),
    ("mira:gdrive:processed_files", "set", None),
    ("mira:patents:seen_ids", "set", None),
]


def _get_redis():
    """Build a Redis client from CELERY_BROKER_URL."""
    import redis

    parsed = urlparse(CELERY_BROKER_URL)
    host = parsed.hostname or "localhost"
    port = parsed.port or 6379
    return redis.Redis(host=host, port=port, db=0, decode_responses=True)


def _read_key(r, key_name: str, key_type: str) -> list | dict:
    """Read a Redis key and return its contents as a serializable structure."""
    if not r.exists(key_name):
        return [] if key_type == "set" else {}

    if key_type == "set":
        return sorted(r.smembers(key_name))
    elif key_type == "hash":
        return dict(r.hgetall(key_name))
    else:
        log.warning("Unknown key type %s for %s", key_type, key_name)
        return []


def _upsert_backup(conn, text_fn, key_name: str, key_type: str,
                   members: list | dict, ttl_seconds: int | None) -> bool:
    """Upsert one dedup key backup into kb_dedup_state."""
    member_count = len(members)
    try:
        conn.execute(text_fn(
            "INSERT INTO kb_dedup_state "
            "(id, key_name, key_type, members, member_count, ttl_seconds, backed_up_at) "
            "VALUES (:id, :key, :type, :members, :count, :ttl, now()) "
            "ON CONFLICT (key_name) DO UPDATE SET "
            "members = EXCLUDED.members, member_count = EXCLUDED.member_count, "
            "ttl_seconds = EXCLUDED.ttl_seconds, backed_up_at = now()"
        ), {
            "id": str(uuid.uuid4()),
            "key": key_name,
            "type": key_type,
            "members": json.dumps(members),
            "count": member_count,
            "ttl": ttl_seconds,
        })
        return True
    except Exception as e:
        log.error("Failed to backup %s: %s", key_name, e)
        return False


def main() -> None:
    from sqlalchemy import create_engine, text
    from sqlalchemy.pool import NullPool

    parser = argparse.ArgumentParser(description="Backup Redis dedup sets to NeonDB")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print what would be backed up without writing to NeonDB")
    args = parser.parse_args()

    if not NEON_DATABASE_URL:
        sys.exit("ERROR: NEON_DATABASE_URL required")

    r = _get_redis()
    log.info("Connected to Redis at %s", CELERY_BROKER_URL.split("@")[-1])

    # Ensure table exists
    engine = create_engine(
        NEON_DATABASE_URL, poolclass=NullPool,
        connect_args={"sslmode": "require"}, pool_pre_ping=True,
    )

    total_members = 0
    backed_up = 0

    with engine.connect() as conn:
        # Create table if not exists (idempotent)
        conn.execute(text(
            "CREATE TABLE IF NOT EXISTS kb_dedup_state ("
            "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),"
            "  key_name TEXT NOT NULL,"
            "  key_type TEXT NOT NULL,"
            "  members JSONB NOT NULL,"
            "  member_count INTEGER NOT NULL,"
            "  ttl_seconds INTEGER,"
            "  backed_up_at TIMESTAMP NOT NULL DEFAULT now(),"
            "  UNIQUE (key_name)"
            ")"
        ))
        conn.commit()

        for key_name, key_type, ttl_seconds in DEDUP_KEYS:
            members = _read_key(r, key_name, key_type)
            count = len(members)
            total_members += count

            if args.dry_run:
                log.info("  [DRY-RUN] %s (%s): %d members, TTL=%s",
                         key_name, key_type, count,
                         f"{ttl_seconds}s" if ttl_seconds else "none")
                continue

            if count == 0:
                log.info("  %s: empty — skipping", key_name)
                continue

            if _upsert_backup(conn, text, key_name, key_type, members, ttl_seconds):
                backed_up += 1
                log.info("  %s: backed up %d members", key_name, count)

        if not args.dry_run:
            conn.commit()

    if args.dry_run:
        log.info("Dry run complete — %d total members across %d keys",
                 total_members, len(DEDUP_KEYS))
    else:
        log.info("Backup complete — %d keys backed up, %d total members",
                 backed_up, total_members)


if __name__ == "__main__":
    main()
