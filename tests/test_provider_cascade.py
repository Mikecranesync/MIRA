"""InferenceRouter cascade resilience tests.

Verifies that provider failures cascade correctly, all-down returns graceful
fallback, and sanitize_context strips PII before external calls.
All tests use mocked HTTP — no real API calls.
"""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

import pytest
from unittest.mock import AsyncMock, patch

from shared.inference.router import InferenceRouter, _build_providers, _Provider, _ProviderSkip


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_provider(name: str) -> _Provider:
    return _Provider(
        name=name,
        api_url="https://api.example.com/v1/chat/completions",
        api_key="test-key",
        model="test-model",
    )


def _make_router() -> InferenceRouter:
    with patch.dict("os.environ", {
        "INFERENCE_BACKEND": "cloud",
        "GROQ_API_KEY": "gk-test",
        "CEREBRAS_API_KEY": "cb-test",
        "GEMINI_API_KEY": "gem-test",
    }):
        return InferenceRouter()


# ── Cascade: first provider _ProviderSkip falls through to next ───────────────

@pytest.mark.asyncio
async def test_cascade_skips_failed_provider():
    """When _call_provider raises _ProviderSkip on provider 1, provider 2 is tried."""
    router = _make_router()
    if not router.providers:
        pytest.skip("No providers enabled")

    call_order = []

    async def mock_call_provider(provider, messages, max_tokens, session_id, has_image):
        call_order.append(provider.name)
        if len(call_order) == 1:
            raise _ProviderSkip(provider.name, "simulated failure")
        return ("Good diagnostic reply", {"provider": provider.name})

    router.enabled = True
    with patch.object(router, "_call_openai_compat", side_effect=mock_call_provider):
        reply, meta = await router.complete(
            [{"role": "user", "content": "VFD shows E.OC.3"}]
        )

    assert len(call_order) >= 2
    assert reply == "Good diagnostic reply"


@pytest.mark.asyncio
async def test_all_providers_fail_returns_empty():
    """When ALL providers raise _ProviderSkip, complete() returns ('', {}) — never raises."""
    router = _make_router()
    if not router.providers:
        pytest.skip("No providers enabled")

    async def always_skip(provider, *args, **kwargs):
        raise _ProviderSkip(provider.name, "all down")

    router.enabled = True
    with patch.object(router, "_call_openai_compat", side_effect=always_skip):
        try:
            reply, meta = await router.complete(
                [{"role": "user", "content": "Test message"}]
            )
            assert reply == ""
        except Exception as exc:
            pytest.fail(f"complete() raised instead of returning ('', {{}}): {exc!r}")


@pytest.mark.asyncio
async def test_cascade_stops_at_first_success():
    """Cascade must stop after the first successful reply."""
    router = _make_router()
    if not router.providers:
        pytest.skip("No providers enabled")

    call_count = 0

    async def first_wins(provider, messages, max_tokens, session_id, has_image):
        nonlocal call_count
        call_count += 1
        return ("Winner reply", {"provider": provider.name})

    router.enabled = True
    with patch.object(router, "_call_openai_compat", side_effect=first_wins):
        reply, _ = await router.complete([{"role": "user", "content": "test"}])

    assert call_count == 1
    assert reply == "Winner reply"


@pytest.mark.asyncio
async def test_disabled_router_returns_empty():
    """Router with INFERENCE_BACKEND=local must return ('', {}) without any provider calls."""
    with patch.dict("os.environ", {"INFERENCE_BACKEND": "local"}):
        router = InferenceRouter()
    assert not router.enabled
    reply, meta = await router.complete([{"role": "user", "content": "test"}])
    assert reply == ""
    assert meta == {}


# ── PII sanitization before external calls ───────────────────────────────────

def test_sanitize_context_strips_ipv4():
    msgs = [{"role": "user", "content": "The PLC at 192.168.1.100 is faulting"}]
    sanitized = InferenceRouter.sanitize_context(msgs)
    assert "192.168.1.100" not in sanitized[0]["content"]
    assert "[IP]" in sanitized[0]["content"]


def test_sanitize_context_strips_mac():
    msgs = [{"role": "user", "content": "MAC address is AA:BB:CC:DD:EE:FF"}]
    sanitized = InferenceRouter.sanitize_context(msgs)
    assert "AA:BB:CC:DD:EE:FF" not in sanitized[0]["content"]
    assert "[MAC]" in sanitized[0]["content"]


def test_sanitize_context_strips_serial():
    msgs = [{"role": "user", "content": "Serial number SN12345678 on the drive"}]
    sanitized = InferenceRouter.sanitize_context(msgs)
    assert "SN12345678" not in sanitized[0]["content"]


def test_sanitize_context_preserves_industrial_content():
    msgs = [{"role": "user", "content": "VFD shows fault E.OC.3 on the motor"}]
    sanitized = InferenceRouter.sanitize_context(msgs)
    assert "E.OC.3" in sanitized[0]["content"]
    assert "motor" in sanitized[0]["content"]


def test_sanitize_context_noop_for_clean_message():
    msgs = [{"role": "user", "content": "What does overcurrent mean?"}]
    sanitized = InferenceRouter.sanitize_context(msgs)
    assert sanitized[0]["content"] == msgs[0]["content"]


def test_sanitize_context_handles_empty():
    assert InferenceRouter.sanitize_context([]) == []


def test_sanitize_context_handles_multipart_content():
    msgs = [{"role": "user", "content": [{"type": "text", "text": "192.168.1.5 faulting"}]}]
    try:
        result = InferenceRouter.sanitize_context(msgs)
        assert isinstance(result, list)
        # IP should be stripped from the text block
        assert "192.168.1.5" not in result[0]["content"][0]["text"]
    except Exception as exc:
        pytest.fail(f"sanitize_context raised on multipart content: {exc!r}")


# ── Provider ordering: Groq should be first ───────────────────────────────────

def test_groq_is_first_provider():
    """After cascade reorder fix, Groq must be the first provider."""
    with patch.dict("os.environ", {
        "INFERENCE_BACKEND": "cloud",
        "GROQ_API_KEY": "gk-test",
        "CEREBRAS_API_KEY": "cb-test",
        "ANTHROPIC_API_KEY": "ant-test",
    }):
        providers = _build_providers()

    if not providers:
        pytest.skip("No providers enabled")
    assert "groq" in providers[0].name.lower(), (
        f"Expected Groq as first provider, got: {providers[0].name}"
    )


# ── System prompt TTL cache ────────────────────────────────────────────────────

def test_system_prompt_returns_string():
    from shared.inference.router import get_system_prompt
    prompt = get_system_prompt()
    assert isinstance(prompt, str)
    assert len(prompt) > 0


def test_system_prompt_cached():
    """Two calls in quick succession should return the same cached string."""
    from shared.inference.router import get_system_prompt
    first = get_system_prompt()
    second = get_system_prompt()
    assert first == second
