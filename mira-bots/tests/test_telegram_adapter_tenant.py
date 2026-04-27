"""Tests that TelegramChatAdapter populates tenant_id via chat_tenant.resolve()."""

from __future__ import annotations

import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.modules.pop("chat_adapter", None)  # isolate from other bot adapters

import pytest
from chat_adapter import TelegramChatAdapter


@pytest.mark.asyncio
async def test_adapter_populates_tenant_id_from_resolver():
    adapter = TelegramChatAdapter(bot_token="dummy")
    raw = {
        "update_id": 1,
        "message": {
            "message_id": 99,
            "chat": {"id": 555, "type": "private"},
            "from": {"id": 555},
            "text": "hello",
        },
    }
    with patch("chat_adapter.chat_tenant_resolve", return_value="t_acme"):
        evt = await adapter.normalize_incoming(raw)
    assert evt.tenant_id == "t_acme"
    assert evt.external_user_id == "555"


@pytest.mark.asyncio
async def test_adapter_empty_tenant_when_resolver_returns_empty():
    adapter = TelegramChatAdapter(bot_token="dummy")
    raw = {
        "update_id": 2,
        "message": {
            "message_id": 100,
            "chat": {"id": 999, "type": "private"},
            "from": {"id": 999},
            "text": "stranger",
        },
    }
    with patch("chat_adapter.chat_tenant_resolve", return_value=""):
        evt = await adapter.normalize_incoming(raw)
    assert evt.tenant_id == ""
