"""Tests for the strict lookup_only gate in ChatDispatcher."""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from shared.chat.dispatcher import ChatDispatcher
from shared.chat.types import NormalizedAttachment, NormalizedChatEvent, NormalizedChatResponse
from shared.identity.service import IdentityService, MiraUser


@pytest.fixture
def fake_engine():
    eng = MagicMock()
    eng.process = AsyncMock(return_value="OK reply")
    return eng


def _event(ext_id: str, text: str, tenant_id: str = "t_acme") -> NormalizedChatEvent:
    return NormalizedChatEvent(
        event_id="e1",
        platform="telegram",
        tenant_id=tenant_id,
        user_id="",
        external_user_id=ext_id,
        external_channel_id=ext_id,
        external_thread_id="",
        text=text,
        attachments=[],
        event_type="dm",
        raw={},
    )


@pytest.mark.asyncio
async def test_stranger_blocked_with_invite_message(fake_engine):
    identity = MagicMock(spec=IdentityService)
    identity.lookup_only = MagicMock(return_value=None)
    disp = ChatDispatcher(fake_engine, identity_service=identity)
    resp = await disp.dispatch(_event("999", "hi"))
    assert "invite" in resp.text.lower()
    fake_engine.process.assert_not_called()


@pytest.mark.asyncio
async def test_known_user_passes_to_engine(fake_engine):
    identity = MagicMock(spec=IdentityService)
    identity.lookup_only = MagicMock(
        return_value=MiraUser(id="u1", tenant_id="t_acme", display_name="A", email="a@x")
    )
    disp = ChatDispatcher(fake_engine, identity_service=identity)
    resp = await disp.dispatch(_event("555", "diagnose this"))
    assert resp.text == "OK reply"
    # Engine must receive tenant_id and mira_user_id
    fake_engine.process.assert_awaited_once()
    call_kwargs = fake_engine.process.await_args.kwargs
    assert call_kwargs.get("tenant_id") == "t_acme"
    assert call_kwargs.get("mira_user_id") == "u1"


@pytest.mark.asyncio
async def test_slack_image_turn_preserves_platform_and_photo_for_engine(fake_engine):
    """Slack images must enter the same shared engine path as Telegram photos.

    The platform kwarg is part of the engine's interaction telemetry and
    decision traces; without it Slack turns are recorded as telegram by the
    Supervisor default, hiding the real backend path during incident review.
    """
    identity = MagicMock(spec=IdentityService)
    identity.lookup_only = MagicMock(
        return_value=MiraUser(id="u-slack", tenant_id="t_acme", display_name="A", email="a@x")
    )
    disp = ChatDispatcher(fake_engine, identity_service=identity)
    event = NormalizedChatEvent(
        event_id="e-slack-image",
        platform="slack",
        tenant_id="T123",
        user_id="",
        external_user_id="U456",
        external_channel_id="C789",
        external_thread_id="1714000000.000100",
        text="which contactor powers M1",
        attachments=[
            NormalizedAttachment(
                kind="image",
                mime_type="image/jpeg",
                filename="print.jpg",
                url="https://files.slack.com/print.jpg",
                data=b"PRINT_IMAGE",
            )
        ],
        event_type="mention",
        raw={},
    )

    resp = await disp.dispatch(event)

    assert resp.text == "OK reply"
    fake_engine.process.assert_awaited_once()
    call_kwargs = fake_engine.process.await_args.kwargs
    assert call_kwargs["platform"] == "slack"
    assert call_kwargs["chat_id"] == "slack:C789:1714000000.000100"
    assert call_kwargs["photo_b64"] == "UFJJTlRfSU1BR0U="


@pytest.mark.asyncio
async def test_no_identity_service_blocks_all(fake_engine):
    """If identity service is None (misconfig), block by default — fail closed."""
    disp = ChatDispatcher(fake_engine, identity_service=None)
    resp = await disp.dispatch(_event("123", "hi"))
    assert (
        "invite" in resp.text.lower()
        or "unavailable" in resp.text.lower()
        or "not configured" in resp.text.lower()
    )
    fake_engine.process.assert_not_called()


@pytest.mark.asyncio
async def test_admin_bypass_when_no_identity_link(fake_engine, monkeypatch):
    """Admin telegram IDs (operators of the bot) bypass the enrollment gate
    even without an identity_links row — they should never be locked out of
    their own bot."""
    monkeypatch.setenv("ADMIN_TELEGRAM_IDS", "8445149012")
    monkeypatch.setenv("MIRA_TENANT_ID", "t_admin")
    identity = MagicMock(spec=IdentityService)
    identity.lookup_only = MagicMock(return_value=None)
    disp = ChatDispatcher(fake_engine, identity_service=identity)
    resp = await disp.dispatch(_event("8445149012", "diagnose this"))
    assert resp.text == "OK reply"
    fake_engine.process.assert_awaited_once()
    # Engine should receive the admin bypass user with default tenant
    call_kwargs = fake_engine.process.await_args.kwargs
    assert call_kwargs.get("tenant_id") == "t_admin"
    assert call_kwargs.get("mira_user_id") == "admin:8445149012"


@pytest.mark.asyncio
async def test_non_admin_still_blocked(fake_engine, monkeypatch):
    """A non-admin telegram ID still hits the invite gate — bypass is admin-only."""
    monkeypatch.setenv("ADMIN_TELEGRAM_IDS", "8445149012")
    identity = MagicMock(spec=IdentityService)
    identity.lookup_only = MagicMock(return_value=None)
    disp = ChatDispatcher(fake_engine, identity_service=identity)
    resp = await disp.dispatch(_event("999", "hi"))
    assert "invite" in resp.text.lower()
    fake_engine.process.assert_not_called()


@pytest.mark.asyncio
async def test_canonical_workflow_uses_resolved_identity_and_bypasses_engine(fake_engine):
    tenant = "11111111-1111-4111-8111-111111111111"
    user = "22222222-2222-4222-8222-222222222222"
    identity = MagicMock(spec=IdentityService)
    identity.lookup_only = MagicMock(
        return_value=MiraUser(id=user, tenant_id=tenant, display_name="A", email="a@x")
    )
    workflow = MagicMock()
    workflow.enabled = True
    workflow.tenant_id = tenant
    workflow.prepare_execute = AsyncMock(
        return_value=NormalizedChatResponse(
            text="Canonical answer",
            operation_id="33333333-3333-4333-8333-333333333333",
            workflow_handled=True,
        )
    )
    disp = ChatDispatcher(fake_engine, identity_service=identity, channel_workflow_client=workflow)
    incoming = _event("555", "find the manual", tenant_id="malicious-adapter-hint")

    response = await disp.try_channel_workflow(incoming)

    assert response is not None
    assert response.text == "Canonical answer"
    workflow.prepare_execute.assert_awaited_once_with(
        incoming,
        actor_id=user,
        uploader_id=user,
        action="message",
        context=None,
        prior_operation_id="",
        confirmed_identity=None,
        on_progress=None,
    )
    assert incoming.tenant_id == tenant
    assert incoming.user_id == user
    identity.lookup_only.assert_called_once_with("telegram", "555", tenant)
    fake_engine.process.assert_not_called()


@pytest.mark.asyncio
async def test_canonical_workflow_never_uses_the_legacy_admin_identity_bypass(
    fake_engine, monkeypatch
):
    tenant = "11111111-1111-4111-8111-111111111111"
    monkeypatch.setenv("ADMIN_TELEGRAM_IDS", "8445149012")
    identity = MagicMock(spec=IdentityService)
    identity.lookup_only = MagicMock(return_value=None)
    workflow = MagicMock(enabled=True, tenant_id=tenant)
    workflow.prepare_execute = AsyncMock()
    disp = ChatDispatcher(fake_engine, identity_service=identity, channel_workflow_client=workflow)

    response = await disp.try_channel_workflow(_event("8445149012", "find the manual"))

    assert response is not None
    assert "invite" in response.text.lower()
    identity.lookup_only.assert_called_once_with("telegram", "8445149012", tenant)
    workflow.prepare_execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_disabled_or_delegated_workflow_falls_through_without_duplicate_delivery(fake_engine):
    tenant = "11111111-1111-4111-8111-111111111111"
    user = "22222222-2222-4222-8222-222222222222"
    identity = MagicMock(spec=IdentityService)
    identity.lookup_only = MagicMock(
        return_value=MiraUser(id=user, tenant_id=tenant, display_name="A", email="a@x")
    )
    disabled = MagicMock(enabled=False)
    disp = ChatDispatcher(fake_engine, identity_service=identity, channel_workflow_client=disabled)
    assert await disp.try_channel_workflow(_event("555", "diagnose")) is None
    disabled.prepare_execute.assert_not_called()

    delegated = MagicMock(enabled=True)
    delegated.tenant_id = tenant
    delegated.prepare_execute = AsyncMock(
        return_value=NormalizedChatResponse(text="", workflow_handled=False)
    )
    disp = ChatDispatcher(fake_engine, identity_service=identity, channel_workflow_client=delegated)
    assert await disp.try_channel_workflow(_event("555", "diagnose")) is None

    replay = MagicMock(enabled=True)
    replay.tenant_id = tenant
    replay.prepare_execute = AsyncMock(
        return_value=NormalizedChatResponse(text="", workflow_handled=True, suppress_delivery=True)
    )
    disp = ChatDispatcher(fake_engine, identity_service=identity, channel_workflow_client=replay)
    suppressed = await disp.try_channel_workflow(_event("555", "diagnose"))
    assert suppressed is not None and suppressed.suppress_delivery is True
    fake_engine.process.assert_not_called()


@pytest.mark.asyncio
async def test_delivery_ack_is_explicitly_separate_from_workflow_execution(fake_engine):
    workflow = MagicMock(enabled=True)
    workflow.ack_delivery = AsyncMock(return_value=True)
    disp = ChatDispatcher(fake_engine, identity_service=None, channel_workflow_client=workflow)
    response = NormalizedChatResponse(
        text="answer",
        operation_id="33333333-3333-4333-8333-333333333333",
        terminal_delivery_token="44444444-4444-4444-8444-444444444444",
    )

    assert await disp.ack_channel_delivery(response) is True
    workflow.ack_delivery.assert_awaited_once_with(response)
