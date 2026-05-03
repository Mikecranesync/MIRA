"""Tests for the strict lookup_only gate in ChatDispatcher."""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from shared.chat.dispatcher import ChatDispatcher
from shared.chat.types import NormalizedChatEvent
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
