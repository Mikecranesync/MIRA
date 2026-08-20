"""Contract lock — MIRA-1000 P0002 provider seam is behavior-preserving.

The whole point of `shared/inference/provider.py` is that wrapping the existing
cascade changes **nothing**. These tests are the proof, not the assertion:
whatever `InferenceRouter.complete()` returns, `CascadeProvider.respond()` must
surface the identical text and the identical usage dict, and must call the
router with the identical arguments.

If a future change makes `CascadeProvider` transform, retry, re-prompt, or
"improve" the router's output, these tests fail — which is the intended alarm.
The seam exists to add *capability above* the router, never to alter it.

Zero network. Zero paid inference. See ADR-0037 and
`docs/architecture/mira-1000/CURRENT_TO_TARGET_MAP.md` §5.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shared.inference.provider import (  # noqa: E402
    DEFAULT_PROVIDER,
    PROVIDER_ENV,
    CascadeProvider,
    InferenceProvider,
    ToolCall,
    TurnResult,
    get_provider,
)

CONVERSATION = [{"role": "user", "content": "GS10 shows CE10, what now?"}]
USAGE = {"provider": "groq", "model": "groq/x", "input_tokens": 11, "output_tokens": 22}


def _router(text: str = "reply text", usage: dict | None = None) -> MagicMock:
    r = MagicMock()
    r.enabled = True
    r.complete = AsyncMock(return_value=(text, USAGE if usage is None else usage))
    return r


# ── the load-bearing contract ────────────────────────────────────────────────


async def test_text_is_passed_through_unchanged():
    r = _router("PowerFlex 525 F013 is an undervoltage fault.")
    out = await CascadeProvider(router=r).respond(CONVERSATION)
    assert out.text == "PowerFlex 525 F013 is an undervoltage fault."


async def test_usage_dict_is_passed_through_unchanged():
    r = _router()
    out = await CascadeProvider(router=r).respond(CONVERSATION)
    assert out.usage == USAGE, "usage must survive the wrap byte-for-byte"


async def test_router_is_called_with_the_same_arguments():
    """The wrap must not silently change max_tokens, session, or sanitization."""
    r = _router()
    await CascadeProvider(router=r).respond(
        CONVERSATION,
        metadata={"max_tokens": 2048, "session_id": "t1_telegram_42", "sanitize": False},
    )
    r.complete.assert_awaited_once_with(
        CONVERSATION, max_tokens=2048, session_id="t1_telegram_42", sanitize=False
    )


async def test_defaults_match_the_routers_own_defaults():
    """Omitted metadata must reproduce `complete()`'s signature defaults exactly."""
    r = _router()
    await CascadeProvider(router=r).respond(CONVERSATION)
    r.complete.assert_awaited_once_with(
        CONVERSATION,
        max_tokens=1024,
        session_id="unknown_unknown_unknown",
        sanitize=True,
    )


async def test_sanitize_defaults_on():
    """PII sanitization is default-on in the router; the wrap must not disable it."""
    r = _router()
    await CascadeProvider(router=r).respond(CONVERSATION)
    assert r.complete.await_args.kwargs["sanitize"] is True


# ── exhausted-cascade behavior ───────────────────────────────────────────────


async def test_exhausted_cascade_does_not_raise():
    """`complete()` returns ("", {}) rather than raising. The wrap must match."""
    r = _router("", usage={})
    out = await CascadeProvider(router=r).respond(CONVERSATION)
    assert out.text == ""
    assert out.ok is False
    assert out.finish_reason == "empty"


async def test_empty_text_still_reports_the_provider():
    """A last-error usage dict still carries provider identity for telemetry."""
    r = _router("", usage={"provider": "together", "error": "timeout"})
    out = await CascadeProvider(router=r).respond(CONVERSATION)
    assert out.provider == "together"
    assert out.ok is False


async def test_provider_falls_back_to_name_when_usage_is_bare():
    r = _router("hi", usage={})
    out = await CascadeProvider(router=r).respond(CONVERSATION)
    assert out.provider == "cascade"


# ── stated limitations must stay stated ──────────────────────────────────────


async def test_tools_and_policy_are_ignored_not_forwarded():
    """The cascade cannot honor tools/policy. It must ignore them, never fake them.

    Forwarding either into `complete()` would be a TypeError at runtime; silently
    dropping them without this lock would let a future caller believe the cascade
    supports tool calling.
    """
    r = _router()
    out = await CascadeProvider(router=r).respond(
        CONVERSATION,
        tools=[{"type": "function", "function": {"name": "recall_knowledge"}}],
        policy={"service_tier": "flex"},
        context={"asset": "CV-101"},
    )
    kwargs = r.complete.await_args.kwargs
    assert "tools" not in kwargs and "policy" not in kwargs and "context" not in kwargs
    assert out.tool_calls == (), "cascade must never invent tool calls"


# ── the interface itself ─────────────────────────────────────────────────────


def test_cascade_is_an_inference_provider():
    assert isinstance(CascadeProvider(router=_router()), InferenceProvider)


def test_interface_carries_no_factorylm_business_logic():
    """PRD §12: the provider interface must stay transport-shaped.

    A method named for retrieval, citations, tenancy, approval or UNS on the
    interface means business logic leaked downward.
    """
    forbidden = ("retriev", "citation", "tenant", "approv", "uns", "evidence", "permission")
    for attr in dir(InferenceProvider):
        if attr.startswith("_"):
            continue
        assert not any(f in attr.lower() for f in forbidden), f"business logic on the seam: {attr}"


def test_turn_result_ok_is_true_for_tool_calls_without_text():
    """A pure tool-call turn is actionable even with empty text."""
    out = TurnResult(
        text="",
        provider="p",
        tool_calls=(ToolCall(id="1", name="lookup_fault", arguments={"code": "F013"}),),
    )
    assert out.ok is True


def test_turn_result_is_immutable():
    """A turn result is evidence of what a provider said; nothing may edit it later."""
    out = TurnResult(text="x", provider="p")
    with pytest.raises(Exception):
        out.text = "tampered"  # type: ignore[misc]


# ── selection ────────────────────────────────────────────────────────────────


def test_default_selection_is_todays_behavior(monkeypatch):
    monkeypatch.delenv(PROVIDER_ENV, raising=False)
    assert DEFAULT_PROVIDER == "cascade"
    assert isinstance(get_provider(), CascadeProvider)


def test_env_selects_the_provider(monkeypatch):
    monkeypatch.setenv(PROVIDER_ENV, "CASCADE")
    assert isinstance(get_provider(), CascadeProvider)


def test_unknown_provider_raises_instead_of_falling_back(monkeypatch):
    """Asking for Cloud Gold and silently getting the free cascade would be a
    spend/quality bug that hides itself. Fail loudly instead."""
    monkeypatch.setenv(PROVIDER_ENV, "openai")
    with pytest.raises(ValueError, match="unknown inference provider"):
        get_provider()
