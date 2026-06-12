"""PII sanitization for the conversation router (#1528 adversarial triage).

`conversation_router._call_router_llm` POSTs the user message straight to Groq,
bypassing `InferenceRouter.complete()`'s default-on sanitize. This pins that the
outgoing payload is scrubbed (IPv4 / MAC / serial) before it leaves the process.
"""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

from unittest.mock import AsyncMock, MagicMock, patch

from shared.conversation_router import _call_router_llm


def _fake_async_client(captured: dict):
    """Return a MagicMock standing in for httpx.AsyncClient that records the
    JSON payload of the POST into `captured`."""
    resp = MagicMock()
    resp.raise_for_status = MagicMock(return_value=None)
    resp.json = MagicMock(
        return_value={"choices": [{"message": {"content": '{"intent": "continue_current"}'}}]}
    )

    async def _post(url, **kwargs):
        captured["json"] = kwargs.get("json")
        return resp

    client = MagicMock()
    client.post = AsyncMock(side_effect=_post)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=client)
    ctx.__aexit__ = AsyncMock(return_value=None)
    return MagicMock(return_value=ctx)


async def test_router_sanitizes_ipv4_before_post():
    captured: dict = {}
    messages = [
        {"role": "system", "content": "router prompt"},
        {"role": "user", "content": "PLC at 192.168.1.100 keeps tripping"},
    ]
    with patch.dict("os.environ", {"GROQ_API_KEY": "test-key"}), patch(
        "shared.conversation_router.httpx.AsyncClient", _fake_async_client(captured)
    ):
        await _call_router_llm(messages)

    sent = captured["json"]["messages"]
    sent_user = next(m for m in sent if m["role"] == "user")
    assert "192.168.1.100" not in sent_user["content"], "raw IP leaked to Groq"
    assert "[IP]" in sent_user["content"]


async def test_router_sanitizes_serial_before_post():
    captured: dict = {}
    messages = [{"role": "user", "content": "Serial: SN ABC123-DEF faulted"}]
    with patch.dict("os.environ", {"GROQ_API_KEY": "test-key"}), patch(
        "shared.conversation_router.httpx.AsyncClient", _fake_async_client(captured)
    ):
        await _call_router_llm(messages)

    sent_user = next(m for m in captured["json"]["messages"] if m["role"] == "user")
    assert "[SN]" in sent_user["content"]


async def test_router_no_groq_key_short_circuits_without_post():
    """No key → no network call, no crash (sanitize must not break the fallback)."""
    with patch.dict("os.environ", {"GROQ_API_KEY": ""}):
        out = await _call_router_llm([{"role": "user", "content": "10.0.0.1 down"}])
    assert "continue_current" in out
