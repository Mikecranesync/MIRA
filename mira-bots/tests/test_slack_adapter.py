"""Tests for SlackChatAdapter — normalize_incoming, render_outgoing, download_attachment."""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")
sys.path.insert(0, "mira-bots/slack")
sys.modules.pop("chat_adapter", None)  # isolate from other bot adapters

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from chat_adapter import SlackChatAdapter
from shared.chat.types import NormalizedAttachment, NormalizedChatResponse, ResponseBlock

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

BOT_TOKEN = "xoxb-test-token"
SIGNING_SECRET = "test-signing-secret"


@pytest.fixture
def adapter():
    return SlackChatAdapter(bot_token=BOT_TOKEN, signing_secret=SIGNING_SECRET)


# ---------------------------------------------------------------------------
# normalize_incoming
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_normalize_incoming_text_message(adapter):
    raw = {
        "type": "event_callback",
        "team_id": "T123",
        "event": {
            "type": "message",
            "ts": "1714000000.000100",
            "client_msg_id": "msg-abc",
            "user": "U456",
            "channel": "C789",
            "channel_type": "channel",
            "text": "VFD tripped on Line 3",
        },
    }
    event = await adapter.normalize_incoming(raw)

    assert event.platform == "slack"
    assert event.tenant_id == "T123"
    assert event.external_user_id == "U456"
    assert event.external_channel_id == "C789"
    assert event.text == "VFD tripped on Line 3"
    assert event.event_id == "msg-abc"
    assert event.attachments == []
    assert event.event_type == "mention"  # channel_type != "im"


@pytest.mark.asyncio
async def test_normalize_incoming_dm(adapter):
    raw = {
        "ts": "1714000000.000200",
        "user": "U456",
        "channel": "D789",
        "channel_type": "im",
        "text": "Hello MIRA",
    }
    event = await adapter.normalize_incoming(raw)

    assert event.event_type == "dm"
    assert event.external_channel_id == "D789"
    assert event.tenant_id == ""  # bare event, no team_id


@pytest.mark.asyncio
async def test_normalize_incoming_image_attachment(adapter):
    raw = {
        "team_id": "T123",
        "event": {
            "ts": "1714000000.000300",
            "user": "U456",
            "channel": "C789",
            "text": "Check this fault panel",
            "files": [
                {
                    "mimetype": "image/jpeg",
                    "name": "fault_panel.jpg",
                    "url_private_download": "https://files.slack.com/fault_panel.jpg",
                    "url_private": "https://files.slack.com/fault_panel.jpg",
                    "size": 204800,
                }
            ],
        },
    }
    event = await adapter.normalize_incoming(raw)

    assert len(event.attachments) == 1
    att = event.attachments[0]
    assert att.kind == "image"
    assert att.mime_type == "image/jpeg"
    assert att.filename == "fault_panel.jpg"
    assert att.url == "https://files.slack.com/fault_panel.jpg"
    assert att.auth_header == f"Bearer {BOT_TOKEN}"
    assert att.size_bytes == 204800


@pytest.mark.asyncio
async def test_normalize_incoming_pdf_attachment(adapter):
    raw = {
        "ts": "1714000000.000400",
        "user": "U456",
        "channel": "C789",
        "text": "",
        "files": [
            {
                "mimetype": "application/pdf",
                "name": "vfd_manual.pdf",
                "url_private_download": "https://files.slack.com/vfd_manual.pdf",
                "size": 1048576,
            }
        ],
    }
    event = await adapter.normalize_incoming(raw)

    assert len(event.attachments) == 1
    assert event.attachments[0].kind == "pdf"


@pytest.mark.asyncio
async def test_normalize_incoming_thread(adapter):
    raw = {
        "ts": "1714000001.000100",
        "user": "U456",
        "channel": "C789",
        "thread_ts": "1714000000.000100",
        "text": "Still tripping",
    }
    event = await adapter.normalize_incoming(raw)

    assert event.external_thread_id == "1714000000.000100"


# ---------------------------------------------------------------------------
# render_outgoing — Block Kit JSON
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_render_outgoing_plain_text_fallback(adapter):
    """When response has no blocks, falls back to plain text section block."""
    response = NormalizedChatResponse(text="Check the motor overload relay.")

    from shared.chat.types import NormalizedChatEvent

    event = NormalizedChatEvent(
        event_id="e1",
        platform="slack",
        tenant_id="T123",
        user_id="",
        external_user_id="U456",
        external_channel_id="C789",
        external_thread_id="",
    )

    posted_payload = {}

    async def mock_post(url, headers=None, json=None, **kwargs):
        posted_payload.update(json or {})
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"ok": True}
        return mock_resp

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=mock_post)
        mock_client_cls.return_value = mock_client

        await adapter.render_outgoing(response, event)

    assert posted_payload["channel"] == "C789"
    assert posted_payload["text"] == "Check the motor overload relay."
    assert len(posted_payload["blocks"]) == 1
    assert posted_payload["blocks"][0]["type"] == "section"


@pytest.mark.asyncio
async def test_render_outgoing_with_blocks(adapter):
    """Blocks are translated to Slack Block Kit format."""
    response = NormalizedChatResponse(
        text="Diagnostic result",
        blocks=[
            ResponseBlock(kind="header", data={"text": "VFD Fault Diagnosis"}),
            ResponseBlock(
                kind="key_value",
                data={"pairs": [["Fault code", "OC1"], ["Recommended action", "Check motor load"]]},
            ),
            ResponseBlock(kind="divider", data={}),
            ResponseBlock(kind="citation", data={"source": "GS10 VFD Manual p.42"}),
        ],
    )

    from shared.chat.types import NormalizedChatEvent

    event = NormalizedChatEvent(
        event_id="e2",
        platform="slack",
        tenant_id="T123",
        user_id="",
        external_user_id="U456",
        external_channel_id="C789",
        external_thread_id="T001",
    )

    posted_payload = {}

    async def mock_post(url, headers=None, json=None, **kwargs):
        posted_payload.update(json or {})
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"ok": True}
        return mock_resp

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=mock_post)
        mock_client_cls.return_value = mock_client

        await adapter.render_outgoing(response, event)

    blocks = posted_payload["blocks"]
    types = [b["type"] for b in blocks]
    assert "header" in types
    assert "section" in types  # key_value renders as section with fields
    assert "divider" in types
    assert "context" in types  # citation renders as context block
    # Thread reply
    assert posted_payload.get("thread_ts") == "T001"


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
        url="https://files.slack.com/panel.jpg",
        auth_header=f"Bearer {BOT_TOKEN}",
    )

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_resp = MagicMock()
        mock_resp.content = fake_bytes
        mock_resp.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=mock_resp)
        mock_client_cls.return_value = mock_client

        result = await adapter.download_attachment(attachment)

    assert result == fake_bytes
    mock_client.get.assert_called_once_with(
        "https://files.slack.com/panel.jpg",
        headers={"Authorization": f"Bearer {BOT_TOKEN}"},
    )


@pytest.mark.asyncio
async def test_download_attachment_raises_on_http_error(adapter):
    attachment = NormalizedAttachment(
        kind="image",
        mime_type="image/jpeg",
        filename="panel.jpg",
        url="https://files.slack.com/panel.jpg",
        auth_header=f"Bearer {BOT_TOKEN}",
    )

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_resp = MagicMock()
        mock_resp.raise_for_status.side_effect = Exception("HTTP 403")
        mock_resp.content = b""

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


def test_slack_adapter_satisfies_protocol(adapter):
    """SlackChatAdapter must pass isinstance check against ChatAdapter."""
    from shared.chat.adapter import ChatAdapter

    assert isinstance(adapter, ChatAdapter)
