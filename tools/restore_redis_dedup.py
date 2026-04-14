#!/usr/bin/env python3
"""Restore Redis dedup sets from NeonDB kb_dedup_state backup.

Rehydrates all dedup keys from the most recent backup, preserving
original TTLs. Run this after a Redis volume loss to prevent
re-ingesting the entire knowledge base.

Usage:
    doppler run --project factorylm --config prd -- \
      uv run --with sqlalchemy --with psycopg2-binary --with redis \
      python tools/restore_redis_dedup.py [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from urllib.parse import urlparse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("restore_redis_dedup")

NEON_DATABASE_URL = os.environ.get("NEON_DATABASE_URL")
CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")


def _get_redis():
    """Build a Redis client from CELERY_BROKER_URL."""
    import redis

    parsed = urlparse(CELERY_BROKER_URL)
    host = parsed.hostname or "localhost"
    port = parsed.port or 6379
    return redis.Redis(host=host, port=port, db=0, decode_responses=True)


def _restore_key(r, key_name: str, key_type: str,
                 members: list | dict, ttl_seconds: int | None) -> int:
    """Restore a single Redis key from backup data.

    Returns the number of members restored.
    """
    if not members:
        return 0

    if key_type == "set":
        if not isinstance(members, list):
            log.warning("Expected list for set key %s, got %s", key_name, type(members).__name__)
            return 0
        # Pipeline for efficiency
        pipe = r.pipeline()
        # Add in batches of 1000 to avoid huge SADD commands
        for i in range(0, len(members), 1000):
            batch = members[i : i + 1000]
            pipe.sadd(key_name, *batch)
        if ttl_seconds:
            pipe.expire(key_name, ttl_seconds)
        pipe.execute()
        return len(members)

    elif key_type == "hash":
        if not isinstance(members, dict):
            log.warning("Expected dict for hash key %s, got %s", key_name, type(members).__name__)
            return 0
        # HSET in batches
        pipe = r.pipeline()
        items = list(members.items())
        for i in range(0, len(items), 500):
            batch = dict(items[i : i + 500])
            pipe.hset(key_name, mapping=batch)
        if ttl_seconds:
            pipe.expire(key_name, ttl_seconds)
        pipe.execute()
        return len(members)

    else:
        log.warning("Unknown key type %s for %s", key_type, key_name)
        return 0


def main() -> None:
    from sqlalchemy import create_engine, text
    from sqlalchemy.pool import NullPool

    parser = argparse.ArgumentParser(description="Restore Redis dedup sets from NeonDB")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print what would be restored without writing to Redis")
    args = parser.parse_args()

    if not NEON_DATABASE_URL:
        sys.exit("ERROR: NEON_DATABASE_URL required")

    engine = create_engine(
        NEON_DATABASE_URL, poolclass=NullPool,
        connect_args={"sslmode": "require"}, pool_pre_ping=True,
    )

    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT key_name, key_type, members, member_count, ttl_seconds, backed_up_at "
            "FROM kb_dedup_state ORDER BY key_name"
        )).fetchall()

    if not rows:
        log.warning("No backup data found in kb_dedup_state — nothing to restore")
        return

    log.info("Found %d backed-up keys in NeonDB", len(rows))

    if args.dry_run:
        for row in rows:
            key_name, key_type, members_json, count, ttl, backed_up = row
            log.info("  [DRY-RUN] %s (%s): %d members, TTL=%s, backed_up=%s",
                     key_name, key_type, count,
                     f"{ttl}s" if ttl else "none",
                     backed_up)
        log.info("Dry run complete — would restore %d keys",
                 sum(1 for r in rows if r[3] > 0))
        return

    r = _get_redis()
    log.info("Connected to Redis at %s", CELERY_BROKER_URL.split("@")[-1])

    total_restored = 0
    keys_restored = 0

    for row in rows:
        key_name, key_type, members_json, count, ttl, backed_up = row

        # Check if key already exists in Redis
        if r.exists(key_name):
            existing_size = r.scard(key_name) if key_type == "set" else r.hlen(key_name)
            log.info("  %s: already has %d members in Redis — skipping (backup has %d)",
                     key_name, existing_size, count)
            continue

        if count == 0:
            log.info("  %s: backup is empty — skipping", key_name)
            continue

        members = json.loads(members_json) if isinstance(members_json, str) else members_json
        restored = _restore_key(r, key_name, key_type, members, ttl)
        total_restored += restored
        keys_restored += 1
        log.info("  %s: restored %d members (backup from %s)", key_name, restored, backed_up)

    log.info("Restore complete — %d keys, %d total members restored", keys_restored, total_restored)


if __name__ == "__main__":
    main()
