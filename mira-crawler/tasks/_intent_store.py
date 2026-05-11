"""NeonDB persistence helper for intent_signals.

Idempotent insert via ``ON CONFLICT (source, platform_id) DO NOTHING`` —
re-runs of reddit_intent / youtube_intent never duplicate rows.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

logger = logging.getLogger("mira-crawler.tasks._intent_store")

_ENGINE = None


def _engine():
    global _ENGINE
    if _ENGINE is not None:
        return _ENGINE
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        raise RuntimeError("NEON_DATABASE_URL not set")
    _ENGINE = create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )
    return _ENGINE


_INSERT_SQL = text(
    """
    INSERT INTO intent_signals (
        source, platform_id, author, author_profile_url, company,
        url, title, content, intent_score, intent_category, suggested_reply
    ) VALUES (
        :source, :platform_id, :author, :author_profile_url, :company,
        :url, :title, :content, :intent_score, :intent_category, :suggested_reply
    )
    ON CONFLICT (source, platform_id) DO NOTHING
    RETURNING id
    """
)


def insert_signal(
    *,
    source: str,
    platform_id: str,
    url: str,
    intent_score: int,
    intent_category: str,
    suggested_reply: str,
    author: Optional[str] = None,
    author_profile_url: Optional[str] = None,
    company: Optional[str] = None,
    title: Optional[str] = None,
    content: Optional[str] = None,
) -> bool:
    """Insert one intent signal. Returns True if a row was created, False on conflict/error."""
    params = {
        "source": source,
        "platform_id": platform_id,
        "author": author,
        "author_profile_url": author_profile_url,
        "company": company,
        "url": url,
        "title": title,
        "content": (content or "")[:8000],
        "intent_score": int(intent_score),
        "intent_category": intent_category,
        "suggested_reply": suggested_reply,
    }
    try:
        with _engine().begin() as conn:
            row = conn.execute(_INSERT_SQL, params).fetchone()
            return row is not None
    except Exception as exc:
        logger.warning("insert_signal failed (%s:%s): %s", source, platform_id, exc)
        return False
