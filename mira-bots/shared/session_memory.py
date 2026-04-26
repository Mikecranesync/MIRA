"""Cross-session equipment memory — persist asset context across chat sessions.

Stores the last-identified asset, open work order, and recent fault codes in
NeonDB so returning technicians resume where they left off.  A 72-hour TTL
ensures stale sessions don't haunt techs the following week.

Unit 7 additions
----------------
* ``load_asset_context_cache(tenant_id, asset_tag)`` — reads the per-asset
  pre-load written by the TS QR handler from ``asset_context_cache``.
* ``save_session`` extended to accept optional ``context_json`` / ``pre_loaded_at``
  so the Python ``/start`` handler can persist pre-loaded WO history into the
  ``user_asset_sessions`` row for the authed ``chat_id``.
* ``load_session`` now returns ``context_json`` when present so ``process_full``
  can surface it in the FSM initial message.

Read/write functions follow the same lazy-import, graceful-failure pattern
used in neon_recall.py — returns None/False on any failure, never raises.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("mira-gsd")

# Rows older than this many hours are treated as expired.
SESSION_TTL_HOURS = int(os.getenv("MIRA_SESSION_TTL_HOURS", "72"))

# Maximum age of an asset_context_cache row to be considered fresh (same TTL).
CACHE_TTL_HOURS = SESSION_TTL_HOURS


def _get_engine():
    """Create a throw-away SQLAlchemy engine (NullPool — Neon PgBouncer pools)."""
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        return None
    try:
        from sqlalchemy import create_engine  # noqa: PLC0415
        from sqlalchemy.pool import NullPool  # noqa: PLC0415
    except ImportError:
        return None
    try:
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
    open_wo_id: str | None = None,
    last_seen_fault: str | None = None,
    context_json: dict[str, Any] | None = None,
    pre_loaded_at: datetime | None = None,
) -> bool:
    """Upsert the asset session for *chat_id*.  Returns True on success.

    Unit 7: ``context_json`` and ``pre_loaded_at`` are optional.  When provided
    they store the Atlas WO history pre-loaded by the TS QR handler so
    ``load_session`` can surface it to the FSM on the next message.
    """
    engine = _get_engine()
    if engine is None:
        return False
    try:
        from sqlalchemy import text  # noqa: PLC0415

        context_str = json.dumps(context_json) if context_json is not None else None

        with engine.connect() as conn:
            conn.execute(
                text(
                    """\
                    INSERT INTO user_asset_sessions
                        (chat_id, asset_id, open_wo_id, last_seen_fault,
                         context_json, pre_loaded_at, updated_at)
                    VALUES (:cid, :aid, :wo, :fault,
                            :ctx, :pla, CURRENT_TIMESTAMP)
                    ON CONFLICT (chat_id) DO UPDATE SET
                        asset_id        = EXCLUDED.asset_id,
                        open_wo_id      = EXCLUDED.open_wo_id,
                        last_seen_fault = EXCLUDED.last_seen_fault,
                        context_json    = COALESCE(EXCLUDED.context_json, user_asset_sessions.context_json),
                        pre_loaded_at   = COALESCE(EXCLUDED.pre_loaded_at, user_asset_sessions.pre_loaded_at),
                        updated_at      = CURRENT_TIMESTAMP"""
                ),
                {
                    "cid": chat_id,
                    "aid": asset_id,
                    "wo": open_wo_id,
                    "fault": last_seen_fault,
                    "ctx": context_str,
                    "pla": pre_loaded_at,
                },
            )
            conn.commit()
        logger.info("session_memory: saved session for chat_id=%s asset=%s", chat_id, asset_id)
        return True
    except Exception as exc:
        logger.warning("session_memory: save_session failed: %s", exc)
        return False


def load_session(chat_id: str) -> dict[str, Any] | None:
    """Load the persisted asset session for *chat_id*.

    Returns None if no session exists, the row is older than the TTL, or
    the query fails.  On TTL expiry the stale row is deleted.

    Unit 7: the returned dict now includes ``context_json`` (dict or None) and
    ``pre_loaded_at`` (datetime or None).  ``context_json`` is parsed from
    JSON text / JSONB before being returned so callers always get a plain dict.
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
                        "SELECT chat_id, asset_id, open_wo_id, last_seen_fault, "
                        "       context_json, pre_loaded_at, updated_at "
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
                    "session_memory: expired session for chat_id=%s (%.1f h old)",
                    chat_id,
                    age_hours,
                )
                return None

        # Unit 7: parse context_json from JSONB/text → plain dict
        raw_ctx = row.get("context_json")
        if isinstance(raw_ctx, str):
            try:
                row["context_json"] = json.loads(raw_ctx)
            except (json.JSONDecodeError, ValueError):
                row["context_json"] = None
        elif not isinstance(raw_ctx, dict):
            row["context_json"] = None

        logger.info(
            "session_memory: loaded session for chat_id=%s asset=%s (%.1f h old) has_context=%s",
            chat_id,
            row["asset_id"],
            age_hours,
            row.get("context_json") is not None,
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


# ---------------------------------------------------------------------------
# Unit 7 — QR pre-load helpers
# ---------------------------------------------------------------------------


def load_asset_context_cache(
    tenant_id: str,
    asset_tag: str,
) -> dict[str, Any] | None:
    """Read the pre-loaded asset context written by the TS QR handler.

    Returns the parsed ``context_json`` dict (with ``work_orders``,
    ``asset_name``, ``asset_model``, ``pre_loaded_at`` keys) or ``None`` if
    the cache is empty, expired, or unavailable.

    TTL is enforced against ``pre_loaded_at`` using ``CACHE_TTL_HOURS``.
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
                        "SELECT context_json, pre_loaded_at "
                        "FROM asset_context_cache "
                        "WHERE tenant_id = :tid AND asset_tag = :tag"
                    ),
                    {"tid": tenant_id, "tag": asset_tag},
                )
                .mappings()
                .fetchone()
            )
            if row is None:
                return None

            row = dict(row)

            # TTL check on pre_loaded_at
            pla = row["pre_loaded_at"]
            if pla is None:
                return None
            if isinstance(pla, str):
                try:
                    pla = datetime.fromisoformat(pla.replace("Z", "+00:00"))
                except ValueError:
                    return None
            if pla.tzinfo is None:
                pla = pla.replace(tzinfo=timezone.utc)
            age_hours = (datetime.now(timezone.utc) - pla).total_seconds() / 3600
            if age_hours > CACHE_TTL_HOURS:
                logger.info(
                    "session_memory: stale asset_context_cache for tag=%s (%.1f h old)",
                    asset_tag,
                    age_hours,
                )
                return None

            # Parse context_json
            raw = row.get("context_json")
            if isinstance(raw, str):
                try:
                    parsed = json.loads(raw)
                except (json.JSONDecodeError, ValueError):
                    return None
            elif isinstance(raw, dict):
                parsed = raw
            else:
                return None

            logger.info(
                "session_memory: loaded asset_context_cache tag=%s (%.1f h old, %d WOs)",
                asset_tag,
                age_hours,
                len(parsed.get("work_orders", [])),
            )
            return parsed
    except Exception as exc:
        logger.warning("session_memory: load_asset_context_cache failed: %s", exc)
        return None


def build_preload_prompt(context: dict[str, Any]) -> str:
    """Build a human-readable context prefix for the FSM initial message.

    Given a parsed ``context_json`` dict from ``load_asset_context_cache``,
    returns a [MIRA MEMORY ... END MEMORY] block that engine.py prepends to
    the user's first message so the LLM can reference prior WO history
    without the technician having to re-explain it.

    Returns an empty string when there are no work orders (clean-slate asset).
    """
    work_orders = context.get("work_orders", [])
    if not work_orders:
        return ""

    asset_name = context.get("asset_name", "")
    asset_model = context.get("asset_model", "")
    asset_label = " ".join(filter(None, [asset_name, asset_model])) or "this asset"

    lines = [
        f"[MIRA MEMORY — QR scan pre-loaded context for {asset_label}]",
        "Recent work orders on this equipment:",
    ]
    for wo in work_orders[:5]:
        wo_id = wo.get("id", "?")
        title = wo.get("title", "(no title)")
        status = wo.get("status", "")
        created = str(wo.get("createdAt", ""))[:10]  # YYYY-MM-DD
        completed = wo.get("completedAt")
        age_note = (
            f"completed {completed[:10]}" if completed else f"opened {created}" if created else ""
        )
        lines.append(f"  • WO-{wo_id}: {title} [{status}]{' — ' + age_note if age_note else ''}")

    lines.append("[END MEMORY]")
    lines.append(
        "If the user's question relates to any of the above work orders, "
        "reference them naturally (e.g. 'I see WO-{id} was logged on this equipment — "
        "is this the same symptom?').  Do NOT fabricate work order details beyond what "
        "is listed above."
    )

    return "\n".join(lines)
