"""Offline tests for the staging-gate judge cascade's OpenAI entry.

2026-10-11: the answering cascade leads with OpenAI (#4349) but the staging
judge still tried only groq → cerebras → gemini, all of which were down
(400 billing / 402 / 429), so `staging-gate` failed with
"all judge providers failed" on a run whose every answer came back 200 from
OpenAI. The judge must try the one funded provider first — and in the gpt-5
request dialect (`max_completion_tokens`, no `temperature`), because a
compat-shaped body gets HTTP 400 and would read as yet another outage.

Fully offline: no network, no model. Env is pinned per test, never inherited.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_SPEC_PATH = Path(__file__).resolve().parents[1] / "tools" / "staging_test.py"
_spec = importlib.util.spec_from_file_location("staging_test", _SPEC_PATH)
assert _spec is not None and _spec.loader is not None
st = sys.modules.get("staging_test") or importlib.util.module_from_spec(_spec)
if "staging_test" not in sys.modules:
    sys.modules["staging_test"] = st
    _spec.loader.exec_module(st)

_KEY_ENVS = ("OPENAI_API_KEY", "GROQ_API_KEY", "CEREBRAS_API_KEY", "GEMINI_API_KEY")


def _pin_keys(monkeypatch: pytest.MonkeyPatch, **present: str) -> None:
    """Pin every judge key env: set the given ones, delete the rest."""
    for env in _KEY_ENVS:
        monkeypatch.delenv(env, raising=False)
    for env, value in present.items():
        monkeypatch.setenv(env, value)


def test_openai_leads_the_judge_cascade_when_its_key_is_set(monkeypatch):
    _pin_keys(monkeypatch, OPENAI_API_KEY="sk-test", GROQ_API_KEY="gsk-test")
    names = [p.name for p in st._judge_providers()]
    assert names[:2] == ["openai", "groq"], names


def test_openai_is_absent_from_the_judge_cascade_without_its_key(monkeypatch):
    """Control: key-gated like every other member — unset key, no provider."""
    _pin_keys(monkeypatch, GROQ_API_KEY="gsk-test")
    names = [p.name for p in st._judge_providers()]
    assert names == ["groq"], names


def test_openai_judge_body_uses_the_gpt5_dialect(monkeypatch):
    _pin_keys(monkeypatch, OPENAI_API_KEY="sk-test")
    (openai,) = st._judge_providers()
    base = {"messages": [{"role": "user", "content": "x"}], "temperature": 0, "max_tokens": 1024}
    body = st._judge_request_body(openai, base)
    assert body["model"] == openai.model
    assert body["max_completion_tokens"] == 1024
    assert "max_tokens" not in body
    assert "temperature" not in body
    assert body.get("reasoning_effort")  # calibrated like the gpt-oss judges
    # The caller's base body is not mutated (it is reused for the next provider).
    assert base["max_tokens"] == 1024 and base["temperature"] == 0


def test_groq_judge_body_keeps_the_compat_dialect(monkeypatch):
    """Control: the pre-existing providers keep their exact body shape."""
    _pin_keys(monkeypatch, GROQ_API_KEY="gsk-test")
    (groq,) = st._judge_providers()
    base = {"messages": [{"role": "user", "content": "x"}], "temperature": 0, "max_tokens": 1024}
    body = st._judge_request_body(groq, base)
    assert body["max_tokens"] == 1024
    assert body["temperature"] == 0
    assert "max_completion_tokens" not in body
    assert body["response_format"] == {"type": "json_object"}
    assert body["reasoning_effort"] == "medium"  # gpt-oss judge calibration (#3195)
