"""Tests for TelegramChatAdapter — normalize_incoming, render_outgoing, download_attachment."""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")
sys.path.insert(0, "mira-bots/telegram")
sys.modules.pop("chat_adapter", None)  # isolate from other bot adapters

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from chat_adapter import TelegramChatAdapter
from shared.chat.adapter import ChatAdapter
from shared.chat.types import (
    NormalizedAttachment,
    NormalizedChatEvent,
    NormalizedChatResponse,
    ResponseBlock,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

BOT_TOKEN = "1234567890:AATEST-token"


@pytest.fixture
def adapter():
    return TelegramChatAdapter(bot_token=BOT_TOKEN)


# ---------------------------------------------------------------------------
# normalize_incoming
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_normalize_incoming_text_message(adapter):
    raw = {
        "update_id": 100001,
        "message": {
            "message_id": 42,
            "from": {"id": 789, "first_name": "Mike", "is_bot": False},
            "chat": {"id": 789, "type": "private"},
            "date": 1714000000,
            "text": "VFD tripped on Line 3",
        },
    }
    event = await adapter.normalize_incoming(raw)

    assert event.platform == "telegram"
    assert event.tenant_id == ""
    assert event.external_user_id == "789"
    assert event.external_channel_id == "789"
    assert event.text == "VFD tripped on Line 3"
    assert event.event_id == "100001:42"
    assert event.attachments == []
    assert event.event_type == "dm"  # private chat


@pytest.mark.asyncio
async def test_normalize_incoming_group_message(adapter):
    raw = {
        "update_id": 100002,
        "message": {
            "message_id": 43,
            "from": {"id": 789},
            "chat": {"id": -100123456, "type": "supergroup"},
            "date": 1714000001,
            "text": "Check the conveyor motor",
        },
    }
    event = await adapter.normalize_incoming(raw)

    assert event.event_type == "mention"  # group chat
    assert event.external_channel_id == "-100123456"
    assert event.tenant_id == ""


@pytest.mark.asyncio
async def test_normalize_incoming_photo(adapter):
    raw = {
        "update_id": 100003,
        "message": {
            "message_id": 44,
            "from": {"id": 789},
            "chat": {"id": 789, "type": "private"},
            "date": 1714000002,
            "photo": [
                {"file_id": "thumb_abc", "file_unique_id": "t1", "width": 90, "height": 60, "file_size": 512},
                {"file_id": "large_xyz", "file_unique_id": "l1", "width": 800, "height": 600, "file_size": 102400},
            ],
            "caption": "Fault panel",
        },
    }
    event = await adapter.normalize_incoming(raw)

    assert len(event.attachments) == 1
    att = event.attachments[0]
    assert att.kind == "image"
    assert att.mime_type == "image/jpeg"
    assert att.url == "large_xyz"  # largest photo selected
    assert att.auth_header == f"Bot {BOT_TOKEN}"
    assert att.size_bytes == 102400
    assert event.text == "Fault panel"


@pytest.mark.asyncio
async def test_normalize_incoming_document_pdf(adapter):
    raw = {
        "update_id": 100004,
        "message": {
            "message_id": 45,
            "from": {"id": 789},
            "chat": {"id": 789, "type": "private"},
            "date": 1714000003,
            "document": {
                "file_id": "doc_file_id_123",
                "file_name": "vfd_manual.pdf",
                "mime_type": "application/pdf",
                "file_size": 1048576,
            },
        },
    }
    event = await adapter.normalize_incoming(raw)

    assert len(event.attachments) == 1
    att = event.attachments[0]
    assert att.kind == "pdf"
    assert att.mime_type == "application/pdf"
    assert att.filename == "vfd_manual.pdf"
    assert att.url == "doc_file_id_123"
    assert att.size_bytes == 1048576


@pytest.mark.asyncio
async def test_normalize_incoming_voice(adapter):
    raw = {
        "update_id": 100005,
        "message": {
            "message_id": 46,
            "from": {"id": 789},
            "chat": {"id": 789, "type": "private"},
            "date": 1714000004,
            "voice": {
                "file_id": "voice_file_id_456",
                "mime_type": "audio/ogg",
                "duration": 5,
                "file_size": 20480,
            },
        },
    }
    event = await adapter.normalize_incoming(raw)

    assert len(event.attachments) == 1
    att = event.attachments[0]
    assert att.kind == "other"
    assert att.mime_type == "audio/ogg"
    assert att.filename == "voice.ogg"
    assert att.url == "voice_file_id_456"


@pytest.mark.asyncio
async def test_normalize_incoming_thread_reply(adapter):
    raw = {
        "update_id": 100006,
        "message": {
            "message_id": 50,
            "from": {"id": 789},
            "chat": {"id": -100123456, "type": "group"},
            "date": 1714000005,
            "text": "Still tripping",
            "reply_to_message": {
                "message_id": 43,
            },
        },
    }
    event = await adapter.normalize_incoming(raw)

    assert event.external_thread_id == "43"


# ---------------------------------------------------------------------------
# render_outgoing — Telegram API via httpx
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_render_outgoing_plain_text(adapter):
    """No blocks → escapes text and sends via sendMessage."""
    response = NormalizedChatResponse(text="Check the motor overload relay.")
    event = NormalizedChatEvent(
        event_id="100001:42",
        platform="telegram",
        tenant_id="",
        user_id="",
        external_user_id="789",
        external_channel_id="789",
        external_thread_id="",
    )

    posted_payload = {}

    async def mock_post(url, headers=None, json=None, **kwargs):
        posted_payload.update(json or {})
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"ok": True, "result": {"message_id": 100}}
        return mock_resp

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=mock_post)
        mock_client_cls.return_value = mock_client

        await adapter.render_outgoing(response, event)

    assert posted_payload["chat_id"] == "789"
    assert posted_payload["parse_mode"] == "MarkdownV2"
    assert "motor overload relay" in posted_payload["text"]
    assert "reply_markup" not in posted_payload


@pytest.mark.asyncio
async def test_render_outgoing_with_blocks(adapter):
    """Blocks render to MarkdownV2; thread reply sets reply_to_message_id."""
    response = NormalizedChatResponse(
        text="Diagnostic result",
        blocks=[
            ResponseBlock(kind="header", data={"text": "VFD Fault Diagnosis"}),
            ResponseBlock(
                kind="key_value",
                data={"pairs": [["Fault code", "OC1"], ["Action", "Check motor load"]]},
            ),
            ResponseBlock(kind="divider", data={}),
            ResponseBlock(kind="citation", data={"source": "GS10 VFD Manual p.42"}),
        ],
    )
    event = NormalizedChatEvent(
        event_id="100002:50",
        platform="telegram",
        tenant_id="",
        user_id="",
        external_user_id="789",
        external_channel_id="-100123456",
        external_thread_id="43",
    )

    posted_payload = {}

    async def mock_post(url, headers=None, json=None, **kwargs):
        posted_payload.update(json or {})
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"ok": True, "result": {"message_id": 51}}
        return mock_resp

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=mock_post)
        mock_client_cls.return_value = mock_client

        await adapter.render_outgoing(response, event)

    text = posted_payload["text"]
    assert "*VFD Fault Diagnosis*" in text
    assert "OC1" in text
    assert "─────────────" in text
    assert "_GS10 VFD Manual p\\.42_" in text  # MarkdownV2 escapes dots
    assert posted_payload["reply_to_message_id"] == 43


@pytest.mark.asyncio
async def test_render_outgoing_suggestion_chips(adapter):
    """Suggestion chips produce InlineKeyboardMarkup."""
    response = NormalizedChatResponse(
        text="What would you like to do next?",
        suggestions=["Check motor", "View fault log", "Reset alarm"],
    )
    event = NormalizedChatEvent(
        event_id="e3",
        platform="telegram",
        tenant_id="",
        user_id="",
        external_user_id="789",
        external_channel_id="789",
        external_thread_id="",
    )

    posted_payload = {}

    async def mock_post(url, headers=None, json=None, **kwargs):
        posted_payload.update(json or {})
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"ok": True, "result": {"message_id": 52}}
        return mock_resp

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=mock_post)
        mock_client_cls.return_value = mock_client

        await adapter.render_outgoing(response, event)

    assert "reply_markup" in posted_payload
    keyboard = posted_payload["reply_markup"]["inline_keyboard"]
    assert len(keyboard) == 1
    button_texts = [b["text"] for b in keyboard[0]]
    assert "Check motor" in button_texts
    assert "Reset alarm" in button_texts


# ---------------------------------------------------------------------------
# download_attachment
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_download_attachment(adapter):
    fake_bytes = b"\xff\xd8\xff\xe0fake_jpeg_data"
    attachment = NormalizedAttachment(
        kind="image",
        mime_type="image/jpeg",
        filename="panel.jpg",
        url="AgACAgIAAxk_file_id",
        auth_header=f"Bot {BOT_TOKEN}",
    )

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_get_file_resp = MagicMock()
        mock_get_file_resp.json.return_value = {
            "ok": True,
            "result": {"file_id": "AgACAgIAAxk_file_id", "file_path": "photos/file_0.jpg"},
        }
        mock_get_file_resp.raise_for_status = MagicMock()

        mock_download_resp = MagicMock()
        mock_download_resp.content = fake_bytes
        mock_download_resp.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(side_effect=[mock_get_file_resp, mock_download_resp])
        mock_client_cls.return_value = mock_client

        result = await adapter.download_attachment(attachment)

    assert result == fake_bytes
    # First call: getFile
    first_call = mock_client.get.call_args_list[0]
    assert "getFile" in first_call.args[0]
    assert first_call.kwargs["params"]["file_id"] == "AgACAgIAAxk_file_id"
    # Second call: actual download
    second_call = mock_client.get.call_args_list[1]
    assert "photos/file_0.jpg" in second_call.args[0]


@pytest.mark.asyncio
async def test_download_attachment_raises_on_http_error(adapter):
    attachment = NormalizedAttachment(
        kind="image",
        mime_type="image/jpeg",
        filename="panel.jpg",
        url="bad_file_id",
        auth_header=f"Bot {BOT_TOKEN}",
    )

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_resp = MagicMock()
        mock_resp.raise_for_status.side_effect = Exception("HTTP 403")

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=mock_resp)
        mock_client_cls.return_value = mock_client

        with pytest.raises(Exception, match="HTTP 403"):
            await adapter.download_attachment(attachment)


# ---------------------------------------------------------------------------
# ChatAdapter protocol compliance
# ---------------------------------------------------------------------------


def test_telegram_adapter_satisfies_protocol(adapter):
    """TelegramChatAdapter must pass isinstance check against ChatAdapter."""
    assert isinstance(adapter, ChatAdapter)
