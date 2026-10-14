"""Offline tests for the staging-gate judge cascade's OpenAI entry.

2026-10-11: the answering cascade leads with OpenAI (#4349) but the staging
judge still tried only groq → cerebras → gemini, all of which were down
(400 billing / 402 / 429), so `staging-gate` failed with
"all judge providers failed" on a run whose every answer came back 200 from
OpenAI. The judge must try the one funded provider first — and in the gpt-5
request dialect (`max_completion_tokens`, no `temperature`), because a
compat-shaped body gets HTTP 400 and would read as yet another outage.

2026-10-14 (Mike): OpenAI is the ONLY judge. Groq (400 billing), Cerebras
(402) and Gemini (429) are deprecated; as fallbacks they only turned one
OpenAI hiccup into "all judge providers failed". The real hiccup: gpt-5.4-mini
sometimes spends the whole 1024-token budget on reasoning and returns
finish_reason=length with empty content (reproduced 1/6 live). So the judge
gets reasoning headroom and retries an empty answer once.

Fully offline: no network, no model. Env is pinned per test, never inherited.
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
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


def test_openai_is_the_only_judge_provider(monkeypatch):
    _pin_keys(
        monkeypatch,
        OPENAI_API_KEY="sk-test",
        GROQ_API_KEY="gsk-test",
        CEREBRAS_API_KEY="csk-test",
        GEMINI_API_KEY="gem-test",
    )
    assert [p.name for p in st._judge_providers()] == ["openai"]


def test_no_openai_key_means_no_judge(monkeypatch):
    """Control: the deprecated keys alone never produce a judge."""
    _pin_keys(
        monkeypatch, GROQ_API_KEY="gsk-test", CEREBRAS_API_KEY="csk-test", GEMINI_API_KEY="gem-test"
    )
    assert st._judge_providers() == []
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        asyncio.run(st.judge_reply(_Client([]), _Q, "reply"))


def test_openai_judge_body_uses_the_gpt5_dialect_with_reasoning_headroom(monkeypatch):
    _pin_keys(monkeypatch, OPENAI_API_KEY="sk-test")
    (openai,) = st._judge_providers()
    base = {"messages": [{"role": "user", "content": "x"}], "temperature": 0, "max_tokens": 1024}
    body = st._judge_request_body(openai, base)
    assert body["model"] == openai.model
    # Measured: reasoning alone reached the 1024 cap (finish_reason=length,
    # empty content). The visible JSON is ~50 tokens; the rest is headroom.
    assert body["max_completion_tokens"] >= 4096
    assert "max_tokens" not in body
    assert "temperature" not in body
    assert body["reasoning_effort"] == "medium"  # #3195 calibration
    # The caller's base body is not mutated.
    assert base["max_tokens"] == 1024 and base["temperature"] == 0


# ---------------------------------------------------------------------------
# One retry on an empty / unparseable answer (no fallback provider remains).

_Q = st.Question(id="q1", category="oem_model_fault", message="PowerFlex 525 F004")
_GOOD = json.dumps(
    {"grounding": 5, "context": 4, "actionability": 5, "safety": 5, "tone": 4, "reason": "ok"}
)


class _Resp:
    def __init__(self, status: int, content: str | None, finish: str = "stop") -> None:
        self.status_code = status
        self._data = {"choices": [{"message": {"content": content}, "finish_reason": finish}]}

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            import httpx

            req = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
            raise httpx.HTTPStatusError(
                "err", request=req, response=httpx.Response(self.status_code, request=req)
            )

    def json(self) -> dict:
        return self._data


class _Client:
    def __init__(self, responses: list[_Resp]) -> None:
        self._responses = list(responses)
        self.calls = 0

    async def post(self, url: str, json: dict, headers: dict) -> _Resp:  # noqa: A002 - httpx signature
        self.calls += 1
        assert "api.openai.com" in url
        return self._responses.pop(0)


def test_an_empty_length_truncated_answer_is_retried_once(monkeypatch):
    _pin_keys(monkeypatch, OPENAI_API_KEY="sk-test")
    client = _Client([_Resp(200, "", finish="length"), _Resp(200, _GOOD)])
    score = asyncio.run(st.judge_reply(client, _Q, "reply"))
    assert client.calls == 2
    assert (score.grounding, score.safety) == (5, 5)
    assert score.judge_reason.startswith("[openai]")


def test_a_retryable_http_status_is_retried_once(monkeypatch):
    _pin_keys(monkeypatch, OPENAI_API_KEY="sk-test")
    client = _Client([_Resp(503, None), _Resp(200, _GOOD)])
    assert asyncio.run(st.judge_reply(client, _Q, "reply")).tone == 4
    assert client.calls == 2


def test_two_empty_answers_fail_closed_after_exactly_two_calls(monkeypatch):
    _pin_keys(monkeypatch, OPENAI_API_KEY="sk-test")
    client = _Client([_Resp(200, "", finish="length"), _Resp(200, "", finish="length")])
    with pytest.raises(RuntimeError, match="judge failed"):
        asyncio.run(st.judge_reply(client, _Q, "reply"))
    assert client.calls == 2


def test_a_clean_first_answer_is_never_retried(monkeypatch):
    """Control: a good answer costs exactly one call."""
    _pin_keys(monkeypatch, OPENAI_API_KEY="sk-test")
    client = _Client([_Resp(200, _GOOD)])
    asyncio.run(st.judge_reply(client, _Q, "reply"))
    assert client.calls == 1
