"""Conversation logger — append-only log of bot turns to NeonDB.

Every Telegram/Slack reply produced by the bot is written to the
`conversation_eval` table (NeonDB migration 012). The auto-scorer Celery
task and the human-review Telegram digest read from this table.

Design constraints:

- **Fail-open.** A logging failure (NeonDB down, env unset, schema drift)
  must NEVER block the user reply. All errors are caught and logged,
  never raised.
- **PII-sanitised.** User messages and bot responses go through
  ``InferenceRouter.sanitize_text`` — same regex set already enforced
  on cascade calls (IPs, MACs, serial numbers).
- **Lazy imports.** ``sqlalchemy`` is imported inside the function so
  bot containers that don't have it installed still boot.
- **Bounded latency.** A 2s timeout caps the INSERT; longer means
  something is wrong on the DB side and we'd rather drop the row.

See ``docs/specs/bot-eval-loop-spec.md`` for the full loop.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Optional

logger = logging.getLogger("mira-gsd.conversation_logger")

_INSERT_SQL = """
INSERT INTO conversation_eval (
    chat_id, source, user_message, bot_response, intent,
    has_citations, response_time_ms, meta
) VALUES (
    :chat_id, :source, :user_message, :bot_response, :intent,
    :has_citations, :response_time_ms, CAST(:meta AS JSONB)
)
"""

_TIMEOUT_SECONDS = 2


async def log_turn(
    *,
    chat_id: str,
    user_message: str,
    bot_response: str,
    source: str,
    intent: Optional[str] = None,
    has_citations: bool = False,
    response_time_ms: Optional[int] = None,
    meta: Optional[dict[str, Any]] = None,
) -> None:
    """Record one bot turn. Never raises.

    ``source`` is ``"telegram"`` or ``"slack"`` — drives downstream routing
    of the daily review digest. ``response_time_ms`` is the wall time
    measured by the caller around ``dispatcher.dispatch``.

    ``meta`` is optional surface-specific metadata stored as JSONB — e.g. the
    drive-pack labels ``{surface, pack_id, matched, matched_kind,
    answer_source, ...}`` the distillation flywheel mines for knowledge gaps.
    Serialized best-effort; a non-serialisable value degrades to ``NULL``
    rather than dropping the row.
    """
    try:
        await _insert(
            chat_id=str(chat_id),
            source=source,
            user_message=_sanitize(user_message),
            bot_response=_sanitize(bot_response),
            intent=intent,
            has_citations=has_citations,
            response_time_ms=response_time_ms,
            meta=_serialize_meta(meta),
        )
    except Exception as exc:
        # Fail-open: a logging error must not propagate to the user-reply path.
        logger.warning("conversation_eval insert skipped: %s", exc)


def _serialize_meta(meta: Optional[dict[str, Any]]) -> Optional[str]:
    """JSON-encode ``meta`` for the JSONB column; ``None``/unserialisable → None."""
    if meta is None:
        return None
    try:
        return json.dumps(meta, default=str)
    except Exception as exc:  # noqa: BLE001
        logger.warning("meta not serialisable, storing NULL: %s", exc)
        return None


def _sanitize(text: str) -> str:
    """Apply the cascade's PII sanitiser to a plain string.

    Lazy import: ``InferenceRouter`` pulls in ``httpx`` and provider config —
    not needed for the logger's "what regexes count as PII" question, but it's
    the authoritative source so we defer to it rather than reimplementing.
    """
    try:
        from .inference.router import InferenceRouter

        return InferenceRouter.sanitize_text(text)
    except Exception as exc:  # noqa: BLE001
        logger.warning("sanitize_text fallback (passthrough): %s", exc)
        return text or ""


async def _insert(
    *,
    chat_id: str,
    source: str,
    user_message: str,
    bot_response: str,
    intent: Optional[str],
    has_citations: bool,
    response_time_ms: Optional[int],
    meta: Optional[str] = None,
) -> None:
    """Perform the actual INSERT. Lazy SQLAlchemy import."""
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        # Treat as "logging disabled" — no warning spam.
        return

    import asyncio

    # Synchronous SQLAlchemy via a worker thread so the user-reply event loop
    # stays unblocked. ``run_in_executor`` is the canonical bridge.
    def _run() -> None:
        from sqlalchemy import create_engine
        from sqlalchemy import text as sql_text
        from sqlalchemy.pool import NullPool

        engine = create_engine(
            url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )
        with engine.connect() as conn:
            conn.execute(
                sql_text(_INSERT_SQL),
                {
                    "chat_id": chat_id,
                    "source": source,
                    "user_message": user_message,
                    "bot_response": bot_response,
                    "intent": intent,
                    "has_citations": has_citations,
                    "response_time_ms": response_time_ms,
                    "meta": meta,
                },
            )
            conn.commit()

    loop = asyncio.get_running_loop()
    await asyncio.wait_for(loop.run_in_executor(None, _run), timeout=_TIMEOUT_SECONDS)


def measure_ms(start: float) -> int:
    """Convenience: wall-time delta in milliseconds, given a ``time.monotonic()`` start."""
    return int((time.monotonic() - start) * 1000)
