"""Troubleshooting session lifecycle — Phase 7 (#1659).

Thin async wrapper for INSERT/UPDATE on NeonDB's `troubleshooting_sessions`
table (Hub migration 019).  All public functions are fail-open: every error
is caught and logged; none raise to the caller.  A NeonDB blip must never
affect bot replies.

Channel mapping from engine platform values:
  telegram → telegram   slack → slack   web → web   * → other
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Optional

logger = logging.getLogger("mira-gsd.ts_lifecycle")

_TIMEOUT_SECONDS = 2

_CHANNEL_MAP: dict[str, str] = {
    "telegram": "telegram",
    "slack": "slack",
    "web": "web",
}


def _map_channel(platform: str) -> str:
    return _CHANNEL_MAP.get(platform, "other")


# ── SQL ───────────────────────────────────────────────────────────────────────

_INSERT_SQL = """
INSERT INTO troubleshooting_sessions
    (tenant_id, asset_id, component_id, channel, status, confirmed_at, metadata)
VALUES
    (CAST(:tenant_id AS UUID),
     CAST(:asset_id AS UUID),
     CAST(:component_id AS UUID),
     :channel,
     'confirmed',
     now(),
     CAST(:metadata AS JSONB))
RETURNING id::text
"""

_APPEND_SQL = """
UPDATE troubleshooting_sessions
SET transcript = transcript || CAST(:turn AS JSONB),
    updated_at = now()
WHERE id = CAST(:session_id AS UUID)
  AND tenant_id = CAST(:tenant_id AS UUID)
"""

_CLOSE_SQL = """
UPDATE troubleshooting_sessions
SET status     = :status,
    resolved_at = now(),
    updated_at = now()
WHERE id       = CAST(:session_id AS UUID)
  AND tenant_id = CAST(:tenant_id AS UUID)
  AND status   = 'confirmed'
"""

_CLOSE_IDLE_SQL = """
UPDATE troubleshooting_sessions
SET status     = 'abandoned',
    updated_at = now()
WHERE status   = 'confirmed'
  AND updated_at < now() - (CAST(:cutoff_hours AS INTEGER) * INTERVAL '1 hour')
"""


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_neon_url() -> str:
    return os.getenv("NEON_DATABASE_URL", "")


def _make_engine(url: str):
    from sqlalchemy import create_engine  # noqa: PLC0415
    from sqlalchemy.pool import NullPool  # noqa: PLC0415

    return create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )


def _set_rls(conn, tenant_id: str) -> None:
    from sqlalchemy import text as sql_text  # noqa: PLC0415

    conn.execute(
        sql_text("SET LOCAL app.current_tenant_id = :tid"),
        {"tid": tenant_id},
    )


# ── Public async coroutines ───────────────────────────────────────────────────

async def open_session_coro(
    *,
    tenant_id: str,
    asset_id: Optional[str],
    component_id: Optional[str],
    channel: str,
    metadata: Optional[dict[str, Any]] = None,
) -> Optional[str]:
    """INSERT a new confirmed session; return the UUID string or None on error."""
    url = _get_neon_url()
    if not url or not tenant_id:
        return None

    params = {
        "tenant_id": tenant_id,
        "asset_id": asset_id or None,
        "component_id": component_id or None,
        "channel": _map_channel(channel),
        "metadata": json.dumps(metadata or {}),
    }

    def _run() -> Optional[str]:
        from sqlalchemy import text as sql_text  # noqa: PLC0415

        engine = _make_engine(url)
        try:
            with engine.connect() as conn:
                _set_rls(conn, tenant_id)
                row = conn.execute(sql_text(_INSERT_SQL), params).fetchone()
                conn.commit()
                return row[0] if row else None
        finally:
            engine.dispose()

    loop = asyncio.get_running_loop()
    try:
        session_id = await asyncio.wait_for(
            loop.run_in_executor(None, _run), timeout=_TIMEOUT_SECONDS
        )
        if session_id:
            logger.debug("TS_OPEN tenant=%s session=%s", tenant_id, session_id)
        return session_id
    except Exception:
        logger.warning("TS_OPEN_FAIL tenant=%s", tenant_id, exc_info=True)
        return None


async def append_turn_coro(
    *,
    session_id: str,
    tenant_id: str,
    role: str,
    content: str,
) -> bool:
    """Append one transcript turn.  Returns True on success."""
    url = _get_neon_url()
    if not url or not session_id or not tenant_id:
        return False

    from datetime import datetime, timezone  # noqa: PLC0415

    turn_doc = json.dumps(
        [{"role": role, "content": content[:4096], "ts": datetime.now(timezone.utc).isoformat()}]
    )
    params = {"session_id": session_id, "tenant_id": tenant_id, "turn": turn_doc}

    def _run() -> bool:
        from sqlalchemy import text as sql_text  # noqa: PLC0415

        engine = _make_engine(url)
        try:
            with engine.connect() as conn:
                _set_rls(conn, tenant_id)
                conn.execute(sql_text(_APPEND_SQL), params)
                conn.commit()
                return True
        finally:
            engine.dispose()

    loop = asyncio.get_running_loop()
    try:
        return await asyncio.wait_for(loop.run_in_executor(None, _run), timeout=_TIMEOUT_SECONDS)
    except Exception:
        logger.debug("TS_APPEND_FAIL session=%s", session_id, exc_info=True)
        return False


async def close_session_coro(
    *,
    session_id: str,
    tenant_id: str,
    reason: str = "resolved",
) -> bool:
    """Set session status to 'resolved' or 'abandoned'.  Returns True on success."""
    url = _get_neon_url()
    if not url or not session_id or not tenant_id:
        return False

    status = "resolved" if reason == "resolved" else "abandoned"
    params = {"session_id": session_id, "tenant_id": tenant_id, "status": status}

    def _run() -> bool:
        from sqlalchemy import text as sql_text  # noqa: PLC0415

        engine = _make_engine(url)
        try:
            with engine.connect() as conn:
                _set_rls(conn, tenant_id)
                conn.execute(sql_text(_CLOSE_SQL), params)
                conn.commit()
                logger.debug("TS_CLOSE session=%s status=%s", session_id, status)
                return True
        finally:
            engine.dispose()

    loop = asyncio.get_running_loop()
    try:
        return await asyncio.wait_for(loop.run_in_executor(None, _run), timeout=_TIMEOUT_SECONDS)
    except Exception:
        logger.debug("TS_CLOSE_FAIL session=%s", session_id, exc_info=True)
        return False


def close_idle_sessions(cutoff_hours: int = 24) -> int:
    """Synchronous: abandon all confirmed sessions idle > cutoff_hours.

    Designed for a nightly cron job / Celery beat task.  Returns row count.
    Returns 0 on any error (logged).
    """
    url = _get_neon_url()
    if not url:
        logger.warning("TS_CRON_SKIP: NEON_DATABASE_URL not set")
        return 0

    def _run() -> int:
        from sqlalchemy import text as sql_text  # noqa: PLC0415

        engine = _make_engine(url)
        try:
            with engine.connect() as conn:
                result = conn.execute(
                    sql_text(_CLOSE_IDLE_SQL), {"cutoff_hours": cutoff_hours}
                )
                conn.commit()
                count = result.rowcount
                logger.info("TS_CRON_CLOSED abandoned=%d cutoff_hours=%d", count, cutoff_hours)
                return count
        finally:
            engine.dispose()

    try:
        return _run()
    except Exception:
        logger.warning("TS_CRON_FAIL", exc_info=True)
        return 0
