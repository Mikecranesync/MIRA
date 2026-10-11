"""OpenAI leads the cloud cascade (owner directive 2026-10-11) — offline contract.

No network: these pin the ORDER and the REQUEST DIALECT, which is where this
provider differs from the OpenAI-compatible trio. OpenAI's gpt-5 family rejects
`max_tokens` (wants `max_completion_tokens`) and any non-default `temperature`
with HTTP 400 — a mistake there would look like a provider outage and silently
fall through to Groq, which is exactly the billing-restricted provider OpenAI
was added to replace.

Run: cd mira-bots && python -m pytest tests/test_openai_first_cascade.py -q
"""

from __future__ import annotations

import pytest

from shared.inference.router import _Provider, _build_providers, _request_payload

KEYS = ("OPENAI_API_KEY", "GROQ_API_KEY", "CEREBRAS_API_KEY", "TOGETHERAI_API_KEY")
MODELS = ("OPENAI_MODEL", "OPENAI_VISION_MODEL", "OPENAI_TIMEOUT", "OPENAI_REASONING_EFFORT")


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for var in KEYS + MODELS:
        monkeypatch.delenv(var, raising=False)


def test_openai_leads_when_its_key_is_set(monkeypatch):
    for var in KEYS:
        monkeypatch.setenv(var, "k")
    names = [p.name for p in _build_providers()]
    assert names == ["openai", "groq", "cerebras", "together"]


def test_unset_openai_key_leaves_the_cascade_exactly_as_before(monkeypatch):
    for var in ("GROQ_API_KEY", "CEREBRAS_API_KEY", "TOGETHERAI_API_KEY"):
        monkeypatch.setenv(var, "k")
    names = [p.name for p in _build_providers()]
    assert names == ["groq", "cerebras", "together"]


def test_openai_provider_shape(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    (p,) = _build_providers()
    assert p.api_url == "https://api.openai.com/v1/chat/completions"
    assert p.model == "gpt-5.4-mini"
    assert p.request_style == "openai_reasoning"
    assert p.cap_key == "max_completion_tokens"
    # Text cascade only by default: vision stays on Together.
    assert p.vision_model == ""


def test_empty_string_env_does_not_win(monkeypatch):
    # compose maps ${OPENAI_MODEL:-} → "" in-container; the default must hold.
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("OPENAI_MODEL", "")
    monkeypatch.setenv("OPENAI_TIMEOUT", "")
    (p,) = _build_providers()
    assert p.model == "gpt-5.4-mini"
    assert p.timeout == 60.0


def test_request_payload_speaks_the_gpt5_dialect():
    openai = _Provider("openai", "u", "k", "gpt-5.4-mini", request_style="openai_reasoning")
    body = _request_payload(openai, "gpt-5.4-mini", [{"role": "user", "content": "hi"}], 321)
    assert body == {
        "model": "gpt-5.4-mini",
        "max_completion_tokens": 321,
        "messages": [{"role": "user", "content": "hi"}],
        "reasoning_effort": "low",
    }
    assert "max_tokens" not in body and "temperature" not in body


def test_request_payload_is_unchanged_for_the_compat_trio():
    groq = _Provider("groq", "u", "k", "openai/gpt-oss-120b")
    body = _request_payload(groq, "openai/gpt-oss-120b", [{"role": "user", "content": "hi"}], 321)
    assert body == {
        "model": "openai/gpt-oss-120b",
        "max_tokens": 321,
        "messages": [{"role": "user", "content": "hi"}],
        "temperature": 0.1,
    }
    assert groq.cap_key == "max_tokens"
