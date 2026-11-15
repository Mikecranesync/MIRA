"""Time-boxed Anthropic cascade slot + MIRA_CASCADE_ORDER hot-swap — offline contract.

Owner decision 2026-11-15: PR #610 banned Anthropic because it billed real money
on auto-charge; a prepaid promotional credit reopens it, fenced so it can never
outlive that credit. These pin the three fail-closed fences and the order knob.

Run: cd mira-bots && python -m pytest tests/test_anthropic_cascade_slot.py -q
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from shared.inference.router import _anthropic_provider, _build_providers, _request_payload

ALL_ENV = (
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "GROQ_API_KEY",
    "CEREBRAS_API_KEY",
    "TOGETHERAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_CASCADE_ENABLED",
    "ANTHROPIC_CASCADE_NOT_AFTER",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_VISION_MODEL",
    "MIRA_CASCADE_ORDER",
)
FUTURE = (datetime.now(UTC) + timedelta(days=1)).isoformat()
PAST = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for k in ALL_ENV:
        monkeypatch.delenv(k, raising=False)


def _open(monkeypatch, not_after=FUTURE):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("ANTHROPIC_CASCADE_ENABLED", "1")
    if not_after is not None:
        monkeypatch.setenv("ANTHROPIC_CASCADE_NOT_AFTER", not_after)


def _names():
    return [p.name for p in _build_providers()]


def test_control_slot_present_when_all_three_fences_open(monkeypatch):
    _open(monkeypatch)
    p = _anthropic_provider()
    assert p is not None
    assert p.api_url == "https://api.anthropic.com/v1/chat/completions"
    assert p.model == "claude-sonnet-4-6"
    assert p.vision_model == ""  # text-only unless opted in
    assert _names() == ["anthropic"]


def test_key_alone_never_adds_the_slot(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("ANTHROPIC_CASCADE_NOT_AFTER", FUTURE)
    assert _anthropic_provider() is None
    assert "anthropic" not in _names()


def test_flag_without_key_is_off(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_CASCADE_ENABLED", "1")
    monkeypatch.setenv("ANTHROPIC_CASCADE_NOT_AFTER", FUTURE)
    assert _anthropic_provider() is None


@pytest.mark.parametrize("bad", [None, "", "tomorrow", "2026-11-17T19:00:00"])
def test_missing_unparseable_or_naive_expiry_fails_closed(monkeypatch, bad):
    _open(monkeypatch, not_after=bad)
    assert _anthropic_provider() is None


def test_expired_slot_is_off(monkeypatch):
    _open(monkeypatch, not_after=PAST)
    assert _anthropic_provider() is None


def test_expiry_boundary_is_exclusive(monkeypatch):
    t = datetime(2026, 11, 17, 19, 0, tzinfo=UTC)
    _open(monkeypatch, not_after=t.isoformat())
    assert _anthropic_provider(now=t - timedelta(seconds=1)) is not None
    assert _anthropic_provider(now=t) is None


def test_default_order_puts_anthropic_last(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("GROQ_API_KEY", "k")
    _open(monkeypatch)
    assert _names() == ["openai", "groq", "anthropic"]


def test_cascade_order_hot_swaps_without_dropping_providers(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setenv("TOGETHERAI_API_KEY", "k")
    _open(monkeypatch)
    monkeypatch.setenv("MIRA_CASCADE_ORDER", " Anthropic , together, nosuch, anthropic")
    assert _names() == ["anthropic", "together", "openai", "groq"]


def test_empty_cascade_order_is_default(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setenv("MIRA_CASCADE_ORDER", "")
    assert _names() == ["openai", "groq"]


def test_anthropic_payload_uses_compat_fields(monkeypatch):
    _open(monkeypatch)
    p = _anthropic_provider()
    body = _request_payload(p, p.model, [{"role": "user", "content": "hi"}], 512)
    assert body["max_tokens"] == 512
    assert "max_completion_tokens" not in body
    assert body["model"] == "claude-sonnet-4-6"
