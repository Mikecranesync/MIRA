"""Telegram notifier — sends draft preview with Approve/Reject inline buttons via Bot API."""

from __future__ import annotations

import logging
import os

import httpx

from mira_seo.models.content import DraftPayload

logger = logging.getLogger("mira-seo.telegram-notifier")

_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
_ADMIN_CHAT_ID = os.getenv("TELEGRAM_ADMIN_CHAT_ID", "")
_API_BASE = "https://api.telegram.org"


def _escape_md2(text: str) -> str:
    """Escape characters reserved in Telegram MarkdownV2."""
    reserved = r"\_*[]()~`>#+-=|{}.!"
    return "".join(f"\\{c}" if c in reserved else c for c in text)


async def send_draft_preview(draft_id: str, payload: DraftPayload) -> int:
    """Send a Telegram preview message with inline Approve/Reject buttons.

    Args:
        draft_id: UUID string of the draft in NeonDB
        payload: DraftPayload with blog, linkedin, and brief data

    Returns:
        Telegram message_id of the sent message (0 on failure or unconfigured)
    """
    if not _BOT_TOKEN or not _ADMIN_CHAT_ID:
        logger.warning("TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID not set — skipping notify")
        return 0

    blog = payload.blog_post
    li = payload.linkedin_post
    brief = payload.brief

    preview_text = (
        f"*📰 Content Ready for Review*\n\n"
        f"*Blog:* {_escape_md2(blog.title)}\n"
        f"*Keyword:* {_escape_md2(brief.keyword)}\n"
        f"*Angle:* {_escape_md2(brief.angle)}\n\n"
        f"*LinkedIn preview \\({li.char_count} chars\\):*\n"
        f"{_escape_md2(li.text[:280])}{'\\.\\.\\.' if len(li.text) > 280 else ''}\n\n"
        f"*Sources:* {_escape_md2(', '.join(s.source for s in payload.feed_sources[:3]))}\n"
        f"*Draft ID:* `{draft_id}`"
    )

    keyboard = {
        "inline_keyboard": [
            [
                {"text": "✅ Publish All", "callback_data": f"approve_all:{draft_id}"},
                {"text": "📝 Blog Only", "callback_data": f"approve_blog:{draft_id}"},
            ],
            [
                {"text": "❌ Reject", "callback_data": f"reject:{draft_id}"},
            ],
        ]
    }

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.post(
                f"{_API_BASE}/bot{_BOT_TOKEN}/sendMessage",
                json={
                    "chat_id": _ADMIN_CHAT_ID,
                    "text": preview_text,
                    "parse_mode": "MarkdownV2",
                    "reply_markup": keyboard,
                },
            )
            resp.raise_for_status()
            result = resp.json()
            msg_id: int = result["result"]["message_id"]
            logger.info("Telegram preview sent for draft %s, message_id=%s", draft_id, msg_id)
            return msg_id
        except Exception:
            logger.exception("Failed to send Telegram preview for draft %s", draft_id)
            return 0
