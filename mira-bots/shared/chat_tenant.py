"""chat_tenant — SQLite-backed chat_id → tenant_id resolver.

Lookup order for resolve(chat_id):
  1. chat_tenant_map table in mira.db
  2. MIRA_TENANT_ID environment variable fallback
  3. Empty string (no tenant configured)

DB path is read from MIRA_DB_PATH env var (default: /data/mira.db).
"""

from __future__ import annotations

import functools
import logging
import os
import sqlite3

logger = logging.getLogger("mira.chat_tenant")

_DB_PATH: str = os.environ.get("MIRA_DB_PATH", "/data/mira.db")


def _ensure_table() -> None:
    """Create chat_tenant_map table if it does not exist.

    Safe to call multiple times — CREATE TABLE IF NOT EXISTS is idempotent.
    Uses WAL journal mode for write concurrency with other MIRA services.
    """
    db = sqlite3.connect(_DB_PATH)
    try:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("""
            CREATE TABLE IF NOT EXISTS chat_tenant_map (
                chat_id    TEXT PRIMARY KEY,
                tenant_id  TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        db.execute("""
            CREATE INDEX IF NOT EXISTS idx_chat_tenant_map_tenant
            ON chat_tenant_map(tenant_id)
        """)
        db.commit()
        logger.debug("chat_tenant_map table ready at %s", _DB_PATH)
    except sqlite3.Error as exc:
        logger.error("Failed to initialise chat_tenant_map: %s", exc)
        raise
    finally:
        db.close()


# Call at import time so the table is guaranteed to exist before any resolver call.
_ensure_table()


@functools.lru_cache(maxsize=512)
def _db_lookup(chat_id: str) -> str | None:
    """Return the tenant_id stored for chat_id, or None if no mapping exists.

    Results are cached in an LRU cache (max 512 entries) to avoid repeated
    DB round-trips for active chat sessions.  Call _db_lookup.cache_clear()
    after set_mapping() to ensure the next resolve() sees the updated value.
    """
    try:
        db = sqlite3.connect(_DB_PATH)
        try:
            row = db.execute(
                "SELECT tenant_id FROM chat_tenant_map WHERE chat_id = ?", (chat_id,)
            ).fetchone()
            return row[0] if row else None
        except sqlite3.Error as exc:
            logger.error("DB lookup failed for chat_id=%s: %s", chat_id, exc)
            return None
        finally:
            db.close()
    except sqlite3.Error as exc:
        logger.error("Cannot connect to DB at %s: %s", _DB_PATH, exc)
        return None


def resolve(chat_id: str) -> str:
    """Return the tenant_id for chat_id.

    Lookup order:
      1. chat_tenant_map row in mira.db  (LRU-cached)
      2. MIRA_TENANT_ID env var fallback
      3. Empty string
    """
    stored = _db_lookup(chat_id)
    if stored is not None:
        return stored

    env_tenant = os.environ.get("MIRA_TENANT_ID", "")
    if env_tenant:
        logger.debug("chat_id=%s has no DB mapping — using MIRA_TENANT_ID=%s", chat_id, env_tenant)
        return env_tenant

    logger.warning("chat_id=%s has no mapping and MIRA_TENANT_ID is unset", chat_id)
    return ""


def set_mapping(chat_id: str, tenant_id: str) -> None:
    """Persist a chat_id → tenant_id mapping and invalidate the LRU cache entry.

    Uses INSERT OR REPLACE so repeated calls with the same chat_id overwrite
    the previous tenant_id (upsert semantics).
    """
    try:
        db = sqlite3.connect(_DB_PATH)
        try:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute(
                """
                INSERT INTO chat_tenant_map (chat_id, tenant_id, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(chat_id) DO UPDATE SET
                    tenant_id  = excluded.tenant_id,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (chat_id, tenant_id),
            )
            db.commit()
            logger.info("Mapped chat_id=%s → tenant_id=%s", chat_id, tenant_id)
        except sqlite3.Error as exc:
            logger.error("Failed to set mapping chat_id=%s: %s", chat_id, exc)
            raise
        finally:
            db.close()
    except sqlite3.Error as exc:
        logger.error("Cannot connect to DB at %s: %s", _DB_PATH, exc)
        raise

    # Invalidate only the affected cache entry by clearing the whole cache.
    # lru_cache does not support per-key invalidation; with maxsize=512 and
    # typical session counts this is inexpensive.
    _db_lookup.cache_clear()
