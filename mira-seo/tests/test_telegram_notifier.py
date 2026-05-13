"""Tests for Telegram notifier — preview message + inline buttons."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import patch

import pytest
import respx
from httpx import Response

from mira_seo.models.content import (
    BlogPost,
    BlogSection,
    ContentBrief,
    DraftPayload,
    FeedItem,
    Infographic,
    LinkedInPost,
    MediumExcerpt,
)
from mira_seo.tools.telegram_notifier import _escape_md2, send_draft_preview


def _make_payload() -> DraftPayload:
    feed = FeedItem(
        title="VFD failures up 23%",
        url="https://example.com/a",
        source="example.com",
        published_at=datetime(2026, 5, 12, 12, 0, 0),
    )
    brief = ContentBrief(
        stories=[feed], keyword="VFD fault codes", angle="problem-aware", post_type="pain_story"
    )
    blog = BlogPost(
        slug="vfd-fault-codes-2026",
        title="VFD Fault Codes 2026",
        description="A guide.",
        date="2026-05-12",
        sections=[BlogSection(type="paragraph", text="hello world")],
    )
    li = LinkedInPost(text="Short post about VFDs.", hashtags=["VFD", "Maintenance"])
    medium = MediumExcerpt(title=blog.title, content="x", canonical_url="https://factorylm.com/blog/x")
    info = Infographic(svg_content="<svg/>", alt="card")
    return DraftPayload(
        blog_post=blog,
        linkedin_post=li,
        medium_excerpt=medium,
        infographic=info,
        feed_sources=[feed],
        brief=brief,
    )


def test_escape_md2_escapes_reserved_chars():
    assert _escape_md2("a.b") == "a\\.b"
    assert _escape_md2("(test)") == "\\(test\\)"
    assert _escape_md2("plain text") == "plain text"


@pytest.mark.asyncio
async def test_send_draft_preview_returns_message_id_on_success():
    payload = _make_payload()
    with patch.dict(
        "os.environ",
        {"TELEGRAM_BOT_TOKEN": "test-token", "TELEGRAM_ADMIN_CHAT_ID": "123"},
    ):
        with respx.mock:
            respx.post("https://api.telegram.org/bottest-token/sendMessage").mock(
                return_value=Response(200, json={"ok": True, "result": {"message_id": 42}})
            )
            msg_id = await send_draft_preview("draft-uuid-1", payload)
            assert msg_id == 42


@pytest.mark.asyncio
async def test_send_draft_preview_includes_inline_buttons():
    payload = _make_payload()
    captured: dict = {}

    def _capture(request):
        import json as _json

        captured.update(_json.loads(request.content))
        return Response(200, json={"ok": True, "result": {"message_id": 1}})

    with patch.dict(
        "os.environ",
        {"TELEGRAM_BOT_TOKEN": "tk", "TELEGRAM_ADMIN_CHAT_ID": "9"},
    ):
        with respx.mock:
            respx.post("https://api.telegram.org/bottk/sendMessage").mock(side_effect=_capture)
            await send_draft_preview("did-7", payload)

    buttons = captured["reply_markup"]["inline_keyboard"]
    callback_data = [b["callback_data"] for row in buttons for b in row]
    assert "approve_all:did-7" in callback_data
    assert "approve_blog:did-7" in callback_data
    assert "reject:did-7" in callback_data


@pytest.mark.asyncio
async def test_send_draft_preview_returns_zero_when_unconfigured():
    payload = _make_payload()
    with patch.dict("os.environ", {}, clear=True):
        msg_id = await send_draft_preview("d", payload)
        assert msg_id == 0
