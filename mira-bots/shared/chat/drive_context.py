"""Adapter-agnostic per-conversation drive-pack memory (#2782 sibling: Slack parity).

Generalizes the Telegram-local `telegram_drive_context` table. When a nameplate
photo or a drive command identifies a drive for a conversation, remember its pack
so a later TEXT follow-up continues in that pack's context. Keyed by
(source, session_key) with a freshness TTL so a stale context can't hijack a new
topic. A context write must NEVER break the turn — all failures are swallowed.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import time

logger = logging.getLogger("chat-drive-context")

DRIVE_CONTEXT_TTL_S = 1800  # 30 min


def _db() -> sqlite3.Connection:
    db_path = os.environ.get("MIRA_DB_PATH", "/data/mira.db")
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute(
        "CREATE TABLE IF NOT EXISTS chat_drive_context ("
        "source TEXT NOT NULL, session_key TEXT NOT NULL, "
        "pack_id TEXT NOT NULL, updated_at REAL NOT NULL, "
        "PRIMARY KEY (source, session_key))"
    )
    return db


def set_drive_context(source: str, session_key: str, pack_id: str) -> None:
    try:
        db = _db()
        db.execute(
            "INSERT INTO chat_drive_context (source, session_key, pack_id, updated_at) "
            "VALUES (?, ?, ?, ?) ON CONFLICT(source, session_key) DO UPDATE SET "
            "pack_id = excluded.pack_id, updated_at = excluded.updated_at",
            (source, session_key, pack_id, time.time()),
        )
        db.commit()
        db.close()
    except Exception as exc:  # never let a context write break the turn
        logger.warning("drive-context write failed: %s", exc)


def get_drive_context(source: str, session_key: str, max_age_s: int | None = None) -> str | None:
    max_age = DRIVE_CONTEXT_TTL_S if max_age_s is None else max_age_s
    try:
        db = _db()
        row = db.execute(
            "SELECT pack_id, updated_at FROM chat_drive_context "
            "WHERE source = ? AND session_key = ?",
            (source, session_key),
        ).fetchone()
        db.close()
    except Exception:
        return None
    if not row:
        return None
    pack_id, updated_at = row
    if (time.time() - float(updated_at)) > max_age:
        return None
    return pack_id
