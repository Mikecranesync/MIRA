"""Provider seam for the prejudged benchmark's judge + technician simulator.

BENCH_JUDGE_PROVIDER selects who plays judge and simulated technician:
anthropic (historical default) or together (OpenAI-compat endpoint, owner
directive 2026-08-03 — paid eval runs go through Together, not Anthropic).

All offline: the Together path is exercised against a faked httpx.post. Every
positive assertion has a failing direction (wrong model forwarded, think block
kept, missing-key accepted) so the seam cannot silently regress.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "mira-bots" / "scripts" / "prejudged_benchmark_run.py"


@pytest.fixture(scope="module")
def mod():
    spec = importlib.util.spec_from_file_location("prejudged_benchmark_run", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_default_provider_is_anthropic(mod, monkeypatch):
    sentinel = object()
    monkeypatch.setattr(mod, "_get_anthropic_client", lambda: sentinel)
    monkeypatch.delenv("BENCH_JUDGE_PROVIDER", raising=False)
    assert mod._get_llm_client() is sentinel


def test_together_requires_api_key(mod, monkeypatch):
    monkeypatch.setenv("BENCH_JUDGE_PROVIDER", "together")
    monkeypatch.delenv("TOGETHERAI_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="TOGETHERAI_API_KEY"):
        mod._get_llm_client()


def test_unknown_provider_fails_loudly(mod, monkeypatch):
    monkeypatch.setenv("BENCH_JUDGE_PROVIDER", "openai")
    with pytest.raises(RuntimeError, match="openai"):
        mod._get_llm_client()


def test_together_client_selected_with_model_override(mod, monkeypatch):
    monkeypatch.setenv("BENCH_JUDGE_PROVIDER", "together")
    monkeypatch.setenv("TOGETHERAI_API_KEY", "fake-key")
    monkeypatch.setenv("BENCH_JUDGE_MODEL", "test-org/test-model")
    client = mod._get_llm_client()
    assert isinstance(client, mod._TogetherClient)
    assert client.model == "test-org/test-model"


def test_together_create_uses_own_model_and_strips_think(mod, monkeypatch):
    """The call sites pass an Anthropic model id — it must NOT be forwarded,
    and reasoning-model <think> blocks must not reach the JSON parser."""
    seen = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        seen["url"] = url
        seen["json"] = json
        payload = {
            "choices": [
                {"message": {"content": '<think>internal chain</think>\n{"accuracy": 4.0}'}}
            ],
            "usage": {"prompt_tokens": 120, "completion_tokens": 30},
        }
        return SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: payload,
        )

    monkeypatch.setattr(mod.httpx, "post", fake_post)
    client = mod._TogetherClient(api_key="fake", model="test-org/test-model", timeout=5.0)

    resp = client.messages.create(
        model="claude-sonnet-4-6", max_tokens=300, messages=[{"role": "user", "content": "hi"}]
    )

    assert seen["json"]["model"] == "test-org/test-model"  # not the Anthropic id
    text = resp.content[0].text
    assert "<think>" not in text and "internal chain" not in text
    assert json.loads(text) == {"accuracy": 4.0}
    assert (client.calls, client.prompt_tokens, client.completion_tokens) == (1, 120, 30)
    summary = client.usage_summary()
    assert summary["provider"] == "together" and summary["calls"] == 1
