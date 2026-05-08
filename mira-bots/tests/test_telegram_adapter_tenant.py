"""Tests that TelegramChatAdapter populates tenant_id via chat_tenant.resolve()."""

from __future__ import annotations

import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest


def _fresh_chat_adapter():
    """Re-import chat_adapter so the patched module is the one whose globals
    the TelegramChatAdapter class actually closes over.

    Other tests in the suite (test_typing_indicator, test_image_downscale, etc.)
    pop ``chat_adapter`` from ``sys.modules`` to avoid cross-adapter collisions,
    which can leave this test's patched module out of sync with the class
    instance imported at module scope. Re-importing inside each test removes
    that ordering coupling.
    """
    sys.modules.pop("chat_adapter", None)
    import chat_adapter  # noqa: PLC0415

    return chat_adapter


@pytest.mark.asyncio
async def test_adapter_populates_tenant_id_from_resolver():
    chat_adapter = _fresh_chat_adapter()
    adapter = chat_adapter.TelegramChatAdapter(bot_token="dummy")
    raw = {
        "update_id": 1,
        "message": {
            "message_id": 99,
            "chat": {"id": 555, "type": "private"},
            "from": {"id": 555},
            "text": "hello",
        },
    }
    with patch.object(chat_adapter, "chat_tenant_resolve", return_value="t_acme"):
        evt = await adapter.normalize_incoming(raw)
    assert evt.tenant_id == "t_acme"
    assert evt.external_user_id == "555"


@pytest.mark.asyncio
async def test_adapter_empty_tenant_when_resolver_returns_empty(monkeypatch):
    # Clear MIRA_TENANT_ID so the env-var fallback inside the real resolver
    # cannot leak a value if the patch itself fails.
    monkeypatch.delenv("MIRA_TENANT_ID", raising=False)
    chat_adapter = _fresh_chat_adapter()
    adapter = chat_adapter.TelegramChatAdapter(bot_token="dummy")
    raw = {
        "update_id": 2,
        "message": {
            "message_id": 100,
            "chat": {"id": 999, "type": "private"},
            "from": {"id": 999},
            "text": "stranger",
        },
    }
    with patch.object(chat_adapter, "chat_tenant_resolve", return_value=""):
        evt = await adapter.normalize_incoming(raw)
    assert evt.tenant_id == ""
