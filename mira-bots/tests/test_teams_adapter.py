"""Tests for TeamsChatAdapter — normalize_incoming, render_outgoing, download_attachment,
and GraphClient token acquisition and file download."""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")
sys.path.insert(0, "mira-bots/teams")
sys.modules.pop("chat_adapter", None)  # isolate from slack/chat_adapter.py collision

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from chat_adapter import TeamsChatAdapter
from graph_client import GraphClient
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

APP_ID = "00000000-1111-2222-3333-444444444444"
APP_PASSWORD = "test-app-password"
TENANT_ID = "ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb"


@pytest.fixture
def adapter():
    return TeamsChatAdapter(app_id=APP_ID, app_password=APP_PASSWORD, tenant_id=TENANT_ID)


@pytest.fixture
def graph():
    return GraphClient(app_id=APP_ID, app_secret=APP_PASSWORD, tenant_id=TENANT_ID)


# ---------------------------------------------------------------------------
# normalize_incoming
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_normalize_incoming_personal_chat(adapter):
    raw = {
        "type": "message",
        "id": "1714000000000",
        "serviceUrl": "https://smba.trafficmanager.net/amer/",
        "channelId": "msteams",
        "from": {
            "id": "29:1abc123",
            "name": "Mike Harper",
            "aadObjectId": "00000000-aaaa-bbbb-cccc-111111111111",
        },
        "conversation": {
            "id": "a:19abc...",
            "tenantId": TENANT_ID,
            "conversationType": "personal",
        },
        "text": "VFD tripped on Line 3",
        "attachments": [],
    }
    event = await adapter.normalize_incoming(raw)

    assert event.platform == "teams"
    assert event.tenant_id == TENANT_ID
    assert event.external_user_id == "00000000-aaaa-bbbb-cccc-111111111111"
    assert event.external_channel_id == "a:19abc..."
    assert event.text == "VFD tripped on Line 3"
    assert event.event_id == "1714000000000"
    assert event.attachments == []
    assert event.event_type == "dm"  # personal conversation


@pytest.mark.asyncio
async def test_normalize_incoming_channel_message(adapter):
    raw = {
        "type": "message",
        "id": "1714000001000",
        "from": {
            "id": "29:1abc123",
            "aadObjectId": "00000000-aaaa-bbbb-cccc-111111111111",
        },
        "conversation": {
            "id": "19:channel@thread.skype",
            "tenantId": TENANT_ID,
            "conversationType": "channel",
        },
        "text": "Check conveyor motor",
        "attachments": [],
    }
    event = await adapter.normalize_incoming(raw)

    assert event.event_type == "mention"  # channel/team message
    assert event.external_channel_id == "19:channel@thread.skype"


@pytest.mark.asyncio
async def test_normalize_incoming_image_attachment(adapter):
    raw = {
        "type": "message",
        "id": "1714000002000",
        "from": {"id": "29:1abc123", "aadObjectId": "user-aad-id"},
        "conversation": {"id": "a:conv_id", "tenantId": TENANT_ID, "conversationType": "personal"},
        "text": "Check this fault",
        "attachments": [
            {
                "contentType": "image/jpeg",
                "contentUrl": "https://smba.trafficmanager.net/amer/attachments/abc.jpg",
                "name": "fault_panel.jpg",
            }
        ],
    }
    event = await adapter.normalize_incoming(raw)

    assert len(event.attachments) == 1
    att = event.attachments[0]
    assert att.kind == "image"
    assert att.mime_type == "image/jpeg"
    assert att.filename == "fault_panel.jpg"
    assert att.url == "https://smba.trafficmanager.net/amer/attachments/abc.jpg"
    assert att.auth_header == "BotToken"


@pytest.mark.asyncio
async def test_normalize_incoming_teams_file_pdf(adapter):
    raw = {
        "type": "message",
        "id": "1714000003000",
        "from": {"id": "29:1abc123", "aadObjectId": "user-aad-id"},
        "conversation": {"id": "a:conv_id", "tenantId": TENANT_ID, "conversationType": "personal"},
        "text": "",
        "attachments": [
            {
                "contentType": "application/vnd.microsoft.teams.file.download.info",
                "content": {
                    "downloadUrl": "https://tenant.sharepoint.com/sites/...?sv=...&sig=...",
                    "uniqueId": "abc123",
                    "fileType": "pdf",
                },
                "name": "vfd_manual.pdf",
            }
        ],
    }
    event = await adapter.normalize_incoming(raw)

    assert len(event.attachments) == 1
    att = event.attachments[0]
    assert att.kind == "pdf"
    assert att.mime_type == "application/pdf"
    assert att.filename == "vfd_manual.pdf"
    assert "sharepoint.com" in att.url
    assert att.auth_header == ""  # pre-signed SAS URL


@pytest.mark.asyncio
async def test_normalize_incoming_reply_sets_thread_id(adapter):
    raw = {
        "type": "message",
        "id": "1714000004000",
        "from": {"id": "29:1abc", "aadObjectId": "user-aad-id"},
        "conversation": {"id": "a:conv_id", "tenantId": TENANT_ID, "conversationType": "personal"},
        "replyToId": "1714000000000",
        "text": "Still tripping",
        "attachments": [],
    }
    event = await adapter.normalize_incoming(raw)

    assert event.external_thread_id == "1714000000000"


@pytest.mark.asyncio
async def test_normalize_incoming_aad_fallback(adapter):
    """Falls back to Bot Framework user ID when aadObjectId is absent."""
    raw = {
        "type": "message",
        "id": "1714000005000",
        "from": {"id": "29:1no-aad"},
        "conversation": {"id": "a:conv", "tenantId": TENANT_ID, "conversationType": "personal"},
        "text": "hello",
        "attachments": [],
    }
    event = await adapter.normalize_incoming(raw)
    assert event.external_user_id == "29:1no-aad"


# ---------------------------------------------------------------------------
# render_outgoing — via stored TurnContext
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_render_outgoing_sends_adaptive_card(adapter):
    """render_outgoing sends an Activity with an Adaptive Card attachment."""
    response = NormalizedChatResponse(text="Check the motor overload relay.")
    event = NormalizedChatEvent(
        event_id="1714000000000",
        platform="teams",
        tenant_id=TENANT_ID,
        user_id="",
        external_user_id="user-aad-id",
        external_channel_id="a:conv_id",
        external_thread_id="",
    )

    mock_tc = MagicMock()
    mock_tc.send_activity = AsyncMock()
    adapter._turn_context = mock_tc

    await adapter.render_outgoing(response, event)

    mock_tc.send_activity.assert_called_once()
    sent_activity = mock_tc.send_activity.call_args[0][0]
    assert sent_activity.type == "message"
    assert len(sent_activity.attachments) == 1
    assert sent_activity.attachments[0].content_type == "application/vnd.microsoft.card.adaptive"
    card = sent_activity.attachments[0].content
    assert card["type"] == "AdaptiveCard"
    assert any(b.get("text") == "Check the motor overload relay." for b in card["body"])


@pytest.mark.asyncio
async def test_render_outgoing_with_blocks(adapter):
    """Blocks are translated to Adaptive Card body elements."""
    response = NormalizedChatResponse(
        text="Diagnostic result",
        blocks=[
            ResponseBlock(kind="header", data={"text": "VFD Fault Diagnosis"}),
            ResponseBlock(
                kind="key_value",
                data={"pairs": [["Fault code", "OC1"], ["Action", "Check motor load"]]},
            ),
            ResponseBlock(kind="citation", data={"source": "GS10 VFD Manual p.42"}),
        ],
    )
    event = NormalizedChatEvent(
        event_id="e2",
        platform="teams",
        tenant_id=TENANT_ID,
        user_id="",
        external_user_id="user-aad-id",
        external_channel_id="a:conv_id",
        external_thread_id="",
    )

    mock_tc = MagicMock()
    mock_tc.send_activity = AsyncMock()
    adapter._turn_context = mock_tc

    await adapter.render_outgoing(response, event)

    card = mock_tc.send_activity.call_args[0][0].attachments[0].content
    body_types = [b.get("type") for b in card["body"]]
    assert "TextBlock" in body_types
    assert "FactSet" in body_types
    header_blocks = [b for b in card["body"] if b.get("weight") == "Bolder"]
    assert any("VFD Fault Diagnosis" in b.get("text", "") for b in header_blocks)


@pytest.mark.asyncio
async def test_render_outgoing_no_turn_context_logs_error(adapter, caplog):
    """render_outgoing with no turn_context logs an error and does not raise."""
    import logging

    response = NormalizedChatResponse(text="test")
    event = NormalizedChatEvent(
        event_id="e",
        platform="teams",
        tenant_id="",
        user_id="",
        external_user_id="u",
        external_channel_id="c",
        external_thread_id="",
    )
    adapter._turn_context = None
    with caplog.at_level(logging.ERROR, logger="mira-teams"):
        await adapter.render_outgoing(response, event)
    assert "turn_context" in caplog.text


# ---------------------------------------------------------------------------
# download_attachment
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_download_attachment_presigned_url(adapter):
    """Pre-signed SAS URLs (auth_header='') are downloaded directly."""
    fake_bytes = b"%PDF-1.4 fake pdf"
    attachment = NormalizedAttachment(
        kind="pdf",
        mime_type="application/pdf",
        filename="manual.pdf",
        url="https://tenant.sharepoint.com/files/manual.pdf?sv=2022&sig=abc",
        auth_header="",
    )

    with patch("httpx.AsyncClient") as mock_cls:
        mock_resp = MagicMock()
        mock_resp.content = fake_bytes
        mock_resp.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=mock_resp)
        mock_cls.return_value = mock_client

        result = await adapter.download_attachment(attachment)

    assert result == fake_bytes


@pytest.mark.asyncio
async def test_download_attachment_bot_token_uses_graph(adapter):
    """BotToken attachments try Graph API first."""
    fake_bytes = b"\xff\xd8\xff\xe0fake_jpeg"
    attachment = NormalizedAttachment(
        kind="image",
        mime_type="image/jpeg",
        filename="panel.jpg",
        url="https://smba.trafficmanager.net/attachments/panel.jpg",
        auth_header="BotToken",
    )

    adapter._graph.get_token = AsyncMock(return_value="graph-token")

    with patch("httpx.AsyncClient") as mock_cls:
        mock_resp = MagicMock()
        mock_resp.content = fake_bytes
        mock_resp.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=mock_resp)
        mock_cls.return_value = mock_client

        result = await adapter.download_attachment(attachment)

    assert result == fake_bytes
    call_kwargs = mock_client.get.call_args
    assert call_kwargs.kwargs.get("headers", {}).get("Authorization") == "Bearer graph-token"


# ---------------------------------------------------------------------------
# GraphClient
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_graph_client_get_token(graph):
    """get_token POSTs client credentials and caches the result."""
    with patch("httpx.AsyncClient") as mock_cls:
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"access_token": "tok-abc", "expires_in": 3600}
        mock_resp.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_cls.return_value = mock_client

        token = await graph.get_token()

    assert token == "tok-abc"
    assert graph._token == "tok-abc"

    # Second call must use cache, not re-POST
    token2 = await graph.get_token()
    assert token2 == "tok-abc"
    mock_client.post.assert_called_once()


@pytest.mark.asyncio
async def test_graph_client_download_file(graph):
    """download_file fetches token then GETs with bearer auth."""
    graph._token = "cached-token"
    graph._token_expires = 9_999_999_999.0

    fake_bytes = b"file content here"

    with patch("httpx.AsyncClient") as mock_cls:
        mock_resp = MagicMock()
        mock_resp.content = fake_bytes
        mock_resp.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=mock_resp)
        mock_cls.return_value = mock_client

        result = await graph.download_file("https://graph.microsoft.com/v1.0/drives/abc/items/xyz/content")

    assert result == fake_bytes
    call_kwargs = mock_client.get.call_args
    assert call_kwargs.kwargs["headers"]["Authorization"] == "Bearer cached-token"


# ---------------------------------------------------------------------------
# ChatAdapter protocol compliance
# ---------------------------------------------------------------------------


def test_teams_adapter_satisfies_protocol(adapter):
    """TeamsChatAdapter must pass isinstance check against ChatAdapter."""
    assert isinstance(adapter, ChatAdapter)
