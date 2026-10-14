"""The intent router goes through InferenceRouter (OpenAI-first), not straight to Groq.

Hazard from the 2026-10-11 nap-window goal (item 4): `conversation_router.py`
POSTed to Groq directly with its own key check. With Groq billing-restricted
every turn logged `ROUTER_LLM_FAILURE` (HTTP 400) and intent silently fell
back to `continue_current` — the one provider that works (OpenAI) was never
tried, and the budget guard that wraps the shared router never saw the call.

Contract pinned here (offline, zero network):
  - the module has no provider URL and no HTTP client of its own;
  - a disabled shared router (no cloud backend / no keys) short-circuits with
    the honest "no router LLM" JSON and never calls complete();
  - a served completion is returned verbatim, requested with the 300-token
    cap the router needs;
  - an exhausted cascade ("" from complete()) and a thrown error both fall
    back to the continue_current JSON with a ROUTER_LLM_FAILURE log line.

Run: cd mira-bots && python3 -m pytest tests/test_conversation_router_cascade.py -q
"""

from __future__ import annotations

import json
import logging
import re
import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, "mira-bots")

from shared import conversation_router as cr  # noqa: E402

MESSAGES = [
    {"role": "system", "content": "router prompt"},
    {"role": "user", "content": "the drive faulted again"},
]


class FakeRouter:
    def __init__(self, *, enabled: bool = True, content: str = "", raises: Exception | None = None):
        self.enabled = enabled
        self._content = content
        self._raises = raises
        self.calls: list[dict[str, Any]] = []

    async def complete(self, messages: list[dict], **kw: Any) -> tuple[str, dict]:
        self.calls.append({"messages": messages, **kw})
        if self._raises:
            raise self._raises
        return self._content, {"provider": "openai"} if self._content else {}


@pytest.fixture
def use_router(monkeypatch: pytest.MonkeyPatch):
    """Install a FakeRouter as the module's shared router; return it."""

    def _install(router: FakeRouter) -> FakeRouter:
        monkeypatch.setattr(cr, "_get_router", lambda: router)
        return router

    return _install


# ---------------------------------------------------------------------------
# Source contract — the Groq-direct path cannot come back unnoticed
# ---------------------------------------------------------------------------


def test_source_has_no_direct_provider_call() -> None:
    src = Path(cr.__file__).read_text(encoding="utf-8")
    assert "api.groq.com" not in src
    assert not re.search(r"httpx\.(AsyncClient|post)", src), "router must not own an HTTP client"
    assert "GROQ_API_KEY" not in src, "key gating belongs to InferenceRouter, not here"
    assert "_get_router()" in src


# ---------------------------------------------------------------------------
# Behaviour
# ---------------------------------------------------------------------------


async def test_disabled_router_short_circuits_without_a_call(use_router) -> None:
    router = use_router(FakeRouter(enabled=False, content='{"intent": "diagnose_equipment"}'))
    out = json.loads(await cr._call_router_llm(MESSAGES))
    assert out["intent"] == "continue_current"
    assert "No router LLM available" in out["reasoning"]
    assert router.calls == []


async def test_served_completion_is_returned_verbatim_with_the_router_cap(use_router) -> None:
    served = '{"intent": "diagnose_equipment", "confidence": 0.9, "reasoning": "fault"}'
    router = use_router(FakeRouter(content=served))
    assert await cr._call_router_llm(MESSAGES) == served
    assert len(router.calls) == 1
    assert router.calls[0]["max_tokens"] == 300


async def test_exhausted_cascade_falls_back_and_logs(
    use_router, caplog: pytest.LogCaptureFixture
) -> None:
    use_router(FakeRouter(content=""))
    with caplog.at_level(logging.WARNING, logger="shared.conversation_router"):
        out = json.loads(await cr._call_router_llm(MESSAGES))
    assert out == {
        "intent": "continue_current",
        "confidence": 0.4,
        "reasoning": "Router LLM error — every provider failed",
    }
    assert any("ROUTER_LLM_FAILURE" in r.getMessage() for r in caplog.records)


async def test_thrown_error_falls_back_and_logs(
    use_router, caplog: pytest.LogCaptureFixture
) -> None:
    use_router(FakeRouter(raises=RuntimeError("boom")))
    with caplog.at_level(logging.WARNING, logger="shared.conversation_router"):
        out = json.loads(await cr._call_router_llm(MESSAGES))
    assert out["intent"] == "continue_current"
    assert out["confidence"] == 0.4
    assert "boom" in out["reasoning"]
    assert any("ROUTER_LLM_FAILURE" in r.getMessage() for r in caplog.records)


async def test_route_intent_end_to_end_uses_the_shared_router(use_router) -> None:
    router = use_router(
        FakeRouter(
            content='{"intent": "find_documentation", "confidence": 0.8, "reasoning": "manual"}'
        )
    )
    result = await cr.route_intent("send me the manual", [], "IDLE", "")
    assert result["intent"] == "find_documentation"
    assert len(router.calls) == 1
    roles = [m["role"] for m in router.calls[0]["messages"]]
    assert roles == ["system", "user"]


def test_shared_router_is_built_lazily_once_and_resettable(monkeypatch: pytest.MonkeyPatch) -> None:
    made: list[object] = []

    class Stub:
        enabled = False

    def _factory() -> Stub:
        s = Stub()
        made.append(s)
        return s

    monkeypatch.setattr(cr, "InferenceRouter", _factory)
    cr.reset_router_for_tests()
    a = cr._get_router()
    assert cr._get_router() is a and len(made) == 1
    cr.reset_router_for_tests()
    assert cr._get_router() is not a and len(made) == 2
    cr.reset_router_for_tests()
