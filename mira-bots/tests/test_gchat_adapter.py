"""Tests for GoogleChatAdapter — normalize_incoming, render_outgoing, download_attachment,
and WorkspaceClient token acquisition, file download, and send_message."""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")
sys.path.insert(0, "mira-bots/gchat")

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from chat_adapter import GoogleChatAdapter
from shared.chat.adapter import ChatAdapter
from shared.chat.types import (
    NormalizedAttachment,
    NormalizedChatEvent,
    NormalizedChatResponse,
    ResponseBlock,
)
from workspace_client import WorkspaceClient, _parse_file_id

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

FAKE_SA = {
    "type": "service_account",
    "project_id": "mira-test",
    "private_key_id": "key-id",
    "private_key": "FAKE_PRIVATE_KEY",  # not validated at construction time
    "client_email": "mira@mira-test.iam.gserviceaccount.com",
    "token_uri": "https://oauth2.googleapis.com/token",
}


@pytest.fixture
def adapter():
    return GoogleChatAdapter(service_account_info=FAKE_SA)


@pytest.fixture
def workspace():
    return WorkspaceClient(service_account_info=FAKE_SA)


# ---------------------------------------------------------------------------
# normalize_incoming
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_normalize_incoming_text_message(adapter):
    raw = {
        "type": "MESSAGE",
        "eventTime": "2024-04-25T12:00:00Z",
        "message": {
            "name": "spaces/SPACE_ID/messages/MSG_ID",
            "sender": {"name": "users/USER_ID", "displayName": "Mike Harper"},
            "text": "VFD tripped on Line 3",
            "thread": {"name": "spaces/SPACE_ID/threads/THREAD_ID"},
        },
        "user": {"name": "users/USER_ID", "displayName": "Mike Harper"},
        "space": {"name": "spaces/SPACE_ID", "type": "ROOM"},
    }
    event = await adapter.normalize_incoming(raw)

    assert event.platform == "gchat"
    assert event.tenant_id == ""
    assert event.external_user_id == "USER_ID"
    assert event.external_channel_id == "spaces/SPACE_ID"
    assert event.text == "VFD tripped on Line 3"
    assert event.event_id == "spaces/SPACE_ID/messages/MSG_ID"
    assert event.external_thread_id == "THREAD_ID"
    assert event.attachments == []
    assert event.event_type == "mention"  # ROOM type


@pytest.mark.asyncio
async def test_normalize_incoming_dm(adapter):
    raw = {
        "type": "MESSAGE",
        "message": {
            "name": "spaces/DM_SPACE/messages/MSG_2",
            "text": "Hello MIRA",
            "thread": {"name": "spaces/DM_SPACE/threads/T1"},
        },
        "user": {"name": "users/USER_ID"},
        "space": {"name": "spaces/DM_SPACE", "type": "DM"},
    }
    event = await adapter.normalize_incoming(raw)

    assert event.event_type == "dm"
    assert event.external_channel_id == "spaces/DM_SPACE"
    assert event.tenant_id == ""


@pytest.mark.asyncio
async def test_normalize_incoming_image_attachment_download_uri(adapter):
    """Attachment with downloadUri — no auth required."""
    raw = {
        "type": "MESSAGE",
        "message": {
            "name": "spaces/S/messages/M",
            "text": "Check this fault panel",
            "thread": {"name": "spaces/S/threads/T"},
            "attachment": [
                {
                    "name": "spaces/S/messages/M/attachments/A1",
                    "contentType": "image/jpeg",
                    "downloadUri": "https://chat.googleapis.com/v1/media/file_abc?token=xyz",
                }
            ],
        },
        "user": {"name": "users/U1"},
        "space": {"name": "spaces/S", "type": "ROOM"},
    }
    event = await adapter.normalize_incoming(raw)

    assert len(event.attachments) == 1
    att = event.attachments[0]
    assert att.kind == "image"
    assert att.mime_type == "image/jpeg"
    assert att.url == "https://chat.googleapis.com/v1/media/file_abc?token=xyz"
    assert att.auth_header == ""  # pre-signed, no auth needed


@pytest.mark.asyncio
async def test_normalize_incoming_attachment_drive_resource(adapter):
    """Attachment with Drive resourceName only — needs DriveAPI auth."""
    raw = {
        "type": "MESSAGE",
        "message": {
            "name": "spaces/S/messages/M",
            "text": "",
            "thread": {"name": "spaces/S/threads/T"},
            "attachment": [
                {
                    "name": "spaces/S/messages/M/attachments/A2",
                    "contentType": "application/pdf",
                    "attachmentDataRef": {
                        "resourceName": "//drive.googleapis.com/drive/v3/files/FILE_ID_123"
                    },
                }
            ],
        },
        "user": {"name": "users/U1"},
        "space": {"name": "spaces/S", "type": "ROOM"},
    }
    event = await adapter.normalize_incoming(raw)

    att = event.attachments[0]
    assert att.kind == "pdf"
    assert att.url == "//drive.googleapis.com/drive/v3/files/FILE_ID_123"
    assert att.auth_header == "DriveAPI"


@pytest.mark.asyncio
async def test_normalize_incoming_slash_command(adapter):
    """Slash command strips the command token and sets event_type=command."""
    raw = {
        "type": "MESSAGE",
        "message": {
            "name": "spaces/S/messages/M",
            "text": "/mira VFD fault OC1",
            "thread": {"name": "spaces/S/threads/T"},
            "slashCommand": {"commandId": 1},
        },
        "user": {"name": "users/U1"},
        "space": {"name": "spaces/S", "type": "ROOM"},
    }
    event = await adapter.normalize_incoming(raw)

    assert event.event_type == "command"
    assert event.command == "/mira"
    assert event.text == "VFD fault OC1"


# ---------------------------------------------------------------------------
# render_outgoing — async API path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_render_outgoing_plain_text(adapter):
    """Plain text response → text-only Cards message via send_message."""
    response = NormalizedChatResponse(text="Check the motor overload relay.")
    event = NormalizedChatEvent(
        event_id="spaces/S/messages/M",
        platform="gchat",
        tenant_id="",
        user_id="",
        external_user_id="USER_ID",
        external_channel_id="spaces/SPACE_ID",
        external_thread_id="",
    )

    adapter._workspace.send_message = AsyncMock(return_value={"name": "spaces/S/messages/R1"})
    await adapter.render_outgoing(response, event)

    adapter._workspace.send_message.assert_called_once()
    space, msg = adapter._workspace.send_message.call_args[0]
    assert space == "spaces/SPACE_ID"
    assert msg["text"] == "Check the motor overload relay."


@pytest.mark.asyncio
async def test_render_outgoing_with_blocks(adapter):
    """Blocks produce cardsV2 payload; thread reply adds thread field."""
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
        event_id="spaces/S/messages/M",
        platform="gchat",
        tenant_id="",
        user_id="",
        external_user_id="USER_ID",
        external_channel_id="spaces/SPACE_ID",
        external_thread_id="THREAD_ID",
    )

    adapter._workspace.send_message = AsyncMock(return_value={})
    await adapter.render_outgoing(response, event)

    _, msg = adapter._workspace.send_message.call_args[0]
    assert "cardsV2" in msg
    assert msg["thread"]["name"] == "spaces/SPACE_ID/threads/THREAD_ID"
    assert msg["messageReplyOption"] == "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD"
    sections = msg["cardsV2"][0]["card"]["sections"]
    assert any("VFD Fault Diagnosis" in str(s) for s in sections)


# ---------------------------------------------------------------------------
# download_attachment
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_download_attachment_presigned_uri(adapter):
    """downloadUri (auth_header='') downloaded directly via httpx."""
    fake_bytes = b"\xff\xd8\xff\xe0fake_jpeg"
    attachment = NormalizedAttachment(
        kind="image",
        mime_type="image/jpeg",
        filename="panel.jpg",
        url="https://chat.googleapis.com/v1/media/abc?token=xyz",
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
async def test_download_attachment_drive_api(adapter):
    """DriveAPI attachments delegate to workspace_client.download_file."""
    fake_bytes = b"%PDF-1.4 fake"
    attachment = NormalizedAttachment(
        kind="pdf",
        mime_type="application/pdf",
        filename="manual.pdf",
        url="//drive.googleapis.com/drive/v3/files/FILE_ID_XYZ",
        auth_header="DriveAPI",
    )

    adapter._workspace.download_file = AsyncMock(return_value=fake_bytes)
    result = await adapter.download_attachment(attachment)

    assert result == fake_bytes
    adapter._workspace.download_file.assert_called_once_with(
        "//drive.googleapis.com/drive/v3/files/FILE_ID_XYZ"
    )


# ---------------------------------------------------------------------------
# WorkspaceClient
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_workspace_client_get_token(workspace):
    """get_token builds JWT assertion, POSTs, caches result."""
    with patch("jwt.encode") as mock_jwt, patch("httpx.AsyncClient") as mock_cls:
        mock_jwt.return_value = "fake-jwt-assertion"

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"access_token": "tok-gchat", "expires_in": 3600}
        mock_resp.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_cls.return_value = mock_client

        token = await workspace.get_token()

    assert token == "tok-gchat"
    assert workspace._token == "tok-gchat"

    # Second call uses cache — no additional POST
    token2 = await workspace.get_token()
    assert token2 == "tok-gchat"
    mock_client.post.assert_called_once()


@pytest.mark.asyncio
async def test_workspace_client_download_file(workspace):
    """download_file constructs Drive API URL and downloads with Bearer token."""
    workspace._token = "cached-token"
    workspace._token_expires = 9_999_999_999.0
    fake_bytes = b"image data here"

    with patch("httpx.AsyncClient") as mock_cls:
        mock_resp = MagicMock()
        mock_resp.content = fake_bytes
        mock_resp.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=mock_resp)
        mock_cls.return_value = mock_client

        result = await workspace.download_file("//drive.googleapis.com/drive/v3/files/FILE_123")

    assert result == fake_bytes
    call_kwargs = mock_client.get.call_args
    assert "FILE_123" in call_kwargs.args[0]
    assert call_kwargs.kwargs["headers"]["Authorization"] == "Bearer cached-token"
    assert call_kwargs.kwargs["params"]["alt"] == "media"


@pytest.mark.asyncio
async def test_workspace_client_send_message(workspace):
    """send_message POSTs to Chat API with Bearer token."""
    workspace._token = "cached-token"
    workspace._token_expires = 9_999_999_999.0
    fake_response = {"name": "spaces/S/messages/R1"}

    with patch("httpx.AsyncClient") as mock_cls:
        mock_resp = MagicMock()
        mock_resp.json.return_value = fake_response
        mock_resp.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_cls.return_value = mock_client

        result = await workspace.send_message("spaces/SPACE_ID", {"text": "Hello"})

    assert result == fake_response
    call_args = mock_client.post.call_args
    assert "spaces/SPACE_ID/messages" in call_args.args[0]
    assert call_args.kwargs["headers"]["Authorization"] == "Bearer cached-token"


# ---------------------------------------------------------------------------
# _parse_file_id helper
# ---------------------------------------------------------------------------


def test_parse_file_id_full_resource_name():
    fid = _parse_file_id("//drive.googleapis.com/drive/v3/files/FILE_ID_XYZ")
    assert fid == "FILE_ID_XYZ"


def test_parse_file_id_short_form():
    fid = _parse_file_id("files/FILE_ID_ABC")
    assert fid == "FILE_ID_ABC"


def test_parse_file_id_bare():
    fid = _parse_file_id("BARE_FILE_ID")
    assert fid == "BARE_FILE_ID"


# ---------------------------------------------------------------------------
# Synchronous response format
# ---------------------------------------------------------------------------


def test_render_gchat_plain_text_returns_text_dict():
    """No blocks → {"text": ...} — the synchronous response body."""
    from shared.chat.renderers.gchat_cards import render_gchat

    response = NormalizedChatResponse(text="Motor overload relay tripped.")
    result = render_gchat(response)
    assert result == {"text": "Motor overload relay tripped."}


def test_render_gchat_with_blocks_returns_cards_v2():
    """Blocks → cardsV2 payload with fallback text."""
    from shared.chat.renderers.gchat_cards import render_gchat

    response = NormalizedChatResponse(
        text="Diagnosis complete",
        blocks=[
            ResponseBlock(kind="header", data={"text": "VFD Fault"}),
            ResponseBlock(kind="key_value", data={"pairs": [["Code", "OC1"]]}),
        ],
    )
    result = render_gchat(response)
    assert "cardsV2" in result
    assert result["text"] == "Diagnosis complete"
    sections = result["cardsV2"][0]["card"]["sections"]
    assert any("VFD Fault" in str(s) for s in sections)


# ---------------------------------------------------------------------------
# ChatAdapter protocol compliance
# ---------------------------------------------------------------------------


def test_gchat_adapter_satisfies_protocol(adapter):
    """GoogleChatAdapter must pass isinstance check against ChatAdapter."""
    assert isinstance(adapter, ChatAdapter)
