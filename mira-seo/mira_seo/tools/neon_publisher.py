"""NeonDB CRUD layer for blog_drafts table."""

from __future__ import annotations

import json
import logging
import os

import asyncpg

from mira_seo.models.content import DraftPayload

logger = logging.getLogger("mira-seo.neon-publisher")


async def _get_conn() -> asyncpg.Connection:
    """Open a single asyncpg connection from NEON_DATABASE_URL env var.

    Raises:
        RuntimeError: if NEON_DATABASE_URL is not set.
    """
    url = os.environ.get("NEON_DATABASE_URL", "")
    if not url:
        raise RuntimeError("NEON_DATABASE_URL not set")
    return await asyncpg.connect(url, ssl="require")


async def insert_draft(payload: DraftPayload, slug: str) -> str:
    """Insert or update blog draft with status='pending_review'.

    Uses ON CONFLICT (slug) DO UPDATE to upsert on slug uniqueness.

    Args:
        payload: DraftPayload model containing all blog content
        slug: unique slug identifier for the draft

    Returns:
        draft id (UUID string)

    Raises:
        RuntimeError: if NEON_DATABASE_URL not set
        asyncpg.PostgresError: on database error
    """
    content_json = payload.model_dump(mode="json")
    conn = await _get_conn()
    try:
        row = await conn.fetchrow(
            """
            INSERT INTO blog_drafts (slug, draft_type, status, content_json)
            VALUES ($1, 'article', 'pending_review', $2::jsonb)
            ON CONFLICT (slug) DO UPDATE
              SET content_json = EXCLUDED.content_json,
                  status = 'pending_review',
                  updated_at = NOW()
            RETURNING id::text
            """,
            slug,
            json.dumps(content_json),
        )
        draft_id = row["id"]
        logger.info("Inserted draft %s (slug=%s)", draft_id, slug)
        return draft_id
    finally:
        await conn.close()


async def set_status(draft_id: str, status: str) -> None:
    """Update draft status; sets published_at=NOW() when transitioning to 'live'.

    Args:
        draft_id: UUID string of the draft
        status: one of 'pending_review', 'live', 'archived', 'rejected'

    Raises:
        RuntimeError: if NEON_DATABASE_URL not set
        asyncpg.PostgresError: on database error
    """
    conn = await _get_conn()
    try:
        if status == "live":
            await conn.execute(
                "UPDATE blog_drafts SET status=$1, published_at=NOW(), updated_at=NOW() WHERE id=$2::uuid",
                status,
                draft_id,
            )
        else:
            await conn.execute(
                "UPDATE blog_drafts SET status=$1, updated_at=NOW() WHERE id=$2::uuid",
                status,
                draft_id,
            )
        logger.info("Draft %s → status=%s", draft_id, status)
    finally:
        await conn.close()


async def get_draft(draft_id: str) -> DraftPayload:
    """Retrieve draft by id and parse content_json into DraftPayload.

    Args:
        draft_id: UUID string of the draft

    Returns:
        parsed DraftPayload model

    Raises:
        RuntimeError: if NEON_DATABASE_URL not set
        ValueError: if draft not found
        asyncpg.PostgresError: on database error
    """
    conn = await _get_conn()
    try:
        row = await conn.fetchrow(
            "SELECT content_json FROM blog_drafts WHERE id=$1::uuid", draft_id
        )
        if row is None:
            raise ValueError(f"Draft {draft_id} not found")
        data = row["content_json"]
        if isinstance(data, str):
            data = json.loads(data)
        return DraftPayload.model_validate(data)
    finally:
        await conn.close()


async def store_telegram_msg_id(draft_id: str, msg_id: int) -> None:
    """Store Telegram message_id for draft review interactions.

    Args:
        draft_id: UUID string of the draft
        msg_id: Telegram message ID for edit/reply later

    Raises:
        RuntimeError: if NEON_DATABASE_URL not set
        asyncpg.PostgresError: on database error
    """
    conn = await _get_conn()
    try:
        await conn.execute(
            "UPDATE blog_drafts SET telegram_msg_id=$1, updated_at=NOW() WHERE id=$2::uuid",
            msg_id,
            draft_id,
        )
        logger.info("Stored Telegram msg_id %s for draft %s", msg_id, draft_id)
    finally:
        await conn.close()
