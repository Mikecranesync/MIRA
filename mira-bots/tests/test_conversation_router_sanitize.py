"""PII sanitization for the conversation router (#1528 adversarial triage).

`conversation_router._call_router_llm` now goes through the shared
`InferenceRouter` (OpenAI-first cascade), which sanitizes by default — but the
router module still scrubs the payload itself before handing it over, so the
guarantee does not depend on a default argument somewhere else. This pins that
the messages reaching the shared router are already scrubbed (IPv4 / MAC /
serial), and that a disabled router never sees the message at all.
"""

from __future__ import annotations

import sys
from typing import Any

import pytest

sys.path.insert(0, "mira-bots")

from shared import conversation_router as cr  # noqa: E402


class _CapturingRouter:
    """Stands in for InferenceRouter: records what it was handed, does NOT sanitize."""

    enabled = True

    def __init__(self) -> None:
        self.received: list[dict] | None = None

    async def complete(self, messages: list[dict], **kw: Any) -> tuple[str, dict]:
        self.received = messages
        return '{"intent": "continue_current"}', {"provider": "fake"}


@pytest.fixture
def capturing(monkeypatch: pytest.MonkeyPatch) -> _CapturingRouter:
    router = _CapturingRouter()
    monkeypatch.setattr(cr, "_get_router", lambda: router)
    return router


async def test_router_sanitizes_ipv4_before_handoff(capturing: _CapturingRouter) -> None:
    messages = [
        {"role": "system", "content": "router prompt"},
        {"role": "user", "content": "PLC at 192.168.1.100 keeps tripping"},
    ]
    await cr._call_router_llm(messages)
    assert capturing.received is not None
    sent_user = next(m for m in capturing.received if m["role"] == "user")
    assert "192.168.1.100" not in sent_user["content"], "raw IP reached the provider layer"
    assert "[IP]" in sent_user["content"]


async def test_router_sanitizes_serial_before_handoff(capturing: _CapturingRouter) -> None:
    await cr._call_router_llm([{"role": "user", "content": "Serial: SN ABC123-DEF faulted"}])
    assert capturing.received is not None
    sent_user = next(m for m in capturing.received if m["role"] == "user")
    assert "[SN]" in sent_user["content"]


async def test_router_disabled_short_circuits_without_handoff(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No cloud router → no provider call, no crash (sanitize must not break the fallback)."""
    router = _CapturingRouter()
    router.enabled = False
    monkeypatch.setattr(cr, "_get_router", lambda: router)
    out = await cr._call_router_llm([{"role": "user", "content": "10.0.0.1 down"}])
    assert "continue_current" in out
    assert router.received is None
