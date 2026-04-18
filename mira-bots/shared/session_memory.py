"""Cross-session equipment memory — persist asset context across chat sessions.

Stores the last-identified asset, open work order, and recent fault codes in
NeonDB so returning technicians resume where they left off.  A 72-hour TTL
ensures stale sessions don't haunt techs the following week.

Read/write functions follow the same lazy-import, graceful-failure pattern
used in neon_recall.py — returns None/False on any failure, never raises.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger("mira-gsd")

# Rows older than this many hours are treated as expired.
SESSION_TTL_HOURS = int(os.getenv("MIRA_SESSION_TTL_HOURS", "72"))


def _get_engine():
    """Create a throw-away SQLAlchemy engine (NullPool — Neon PgBouncer pools)."""
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        return None
    try:
        from sqlalchemy import create_engine  # noqa: PLC0415
        from sqlalchemy.pool import NullPool  # noqa: PLC0415

        return create_engine(
            url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )
    except Exception as exc:
        logger.warning("session_memory: failed to create engine: %s", exc)
        return None


def ensure_table() -> bool:
    """Create user_asset_sessions table if it doesn't exist.  Returns True on success."""
    engine = _get_engine()
    if engine is None:
        return False
    try:
        from sqlalchemy import text  # noqa: PLC0415

        with engine.connect() as conn:
            conn.execute(
                text(
                    """\
                    CREATE TABLE IF NOT EXISTS user_asset_sessions (
                        chat_id          TEXT PRIMARY KEY,
                        asset_id         TEXT NOT NULL,
                        open_wo_id       TEXT,
                        last_seen_fault  TEXT,
                        updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )"""
                )
            )
            conn.commit()
        logger.info("session_memory: user_asset_sessions table ensured")
        return True
    except Exception as exc:
        logger.warning("session_memory: ensure_table failed: %s", exc)
        return False


def save_session(
    chat_id: str,
    asset_id: str,
    open_wo_id: Optional[str] = None,
    last_seen_fault: Optional[str] = None,
) -> bool:
    """Upsert the asset session for *chat_id*.  Returns True on success."""
    engine = _get_engine()
    if engine is None:
        return False
    try:
        from sqlalchemy import text  # noqa: PLC0415

        with engine.connect() as conn:
            conn.execute(
                text(
                    """\
                    INSERT INTO user_asset_sessions
                        (chat_id, asset_id, open_wo_id, last_seen_fault, updated_at)
                    VALUES (:cid, :aid, :wo, :fault, CURRENT_TIMESTAMP)
                    ON CONFLICT (chat_id) DO UPDATE SET
                        asset_id        = EXCLUDED.asset_id,
                        open_wo_id      = EXCLUDED.open_wo_id,
                        last_seen_fault = EXCLUDED.last_seen_fault,
                        updated_at      = CURRENT_TIMESTAMP"""
                ),
                {"cid": chat_id, "aid": asset_id, "wo": open_wo_id, "fault": last_seen_fault},
            )
            conn.commit()
        logger.info("session_memory: saved session for chat_id=%s asset=%s", chat_id, asset_id)
        return True
    except Exception as exc:
        logger.warning("session_memory: save_session failed: %s", exc)
        return False


def load_session(chat_id: str) -> Optional[dict[str, Any]]:
    """Load the persisted asset session for *chat_id*.

    Returns None if no session exists, the row is older than the TTL, or
    the query fails.  On TTL expiry the stale row is deleted.
    """
    engine = _get_engine()
    if engine is None:
        return None
    try:
        from sqlalchemy import text  # noqa: PLC0415

        with engine.connect() as conn:
            row = (
                conn.execute(
                    text(
                        "SELECT chat_id, asset_id, open_wo_id, last_seen_fault, updated_at "
                        "FROM user_asset_sessions WHERE chat_id = :cid"
                    ),
                    {"cid": chat_id},
                )
                .mappings()
                .fetchone()
            )
            if row is None:
                return None

            row = dict(row)

            # Enforce TTL
            updated = row["updated_at"]
            if isinstance(updated, str):
                # SQLite returns timestamps as strings
                for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S+00:00"):
                    try:
                        updated = datetime.strptime(updated, fmt)
                        break
                    except ValueError:
                        continue
                else:
                    # Last resort: strip microseconds/tz and parse
                    updated = datetime.fromisoformat(updated.replace("Z", "+00:00"))
            if updated.tzinfo is None:
                updated = updated.replace(tzinfo=timezone.utc)
            age_hours = (datetime.now(timezone.utc) - updated).total_seconds() / 3600
            if age_hours > SESSION_TTL_HOURS:
                conn.execute(
                    text("DELETE FROM user_asset_sessions WHERE chat_id = :cid"),
                    {"cid": chat_id},
                )
                conn.commit()
                logger.info(
                    "session_memory: expired session for chat_id=%s (%.1f h old)", chat_id, age_hours
                )
                return None

        logger.info(
            "session_memory: loaded session for chat_id=%s asset=%s (%.1f h old)",
            chat_id,
            row["asset_id"],
            age_hours,
        )
        return row
    except Exception as exc:
        logger.warning("session_memory: load_session failed: %s", exc)
        return None


def clear_session(chat_id: str) -> bool:
    """Delete the persisted session for *chat_id*.  Returns True on success."""
    engine = _get_engine()
    if engine is None:
        return False
    try:
        from sqlalchemy import text  # noqa: PLC0415

        with engine.connect() as conn:
            conn.execute(
                text("DELETE FROM user_asset_sessions WHERE chat_id = :cid"),
                {"cid": chat_id},
            )
            conn.commit()
        return True
    except Exception as exc:
        logger.warning("session_memory: clear_session failed: %s", exc)
        return False
