"""D7b — the DeepEval judge is OpenAI-first, key-gated, and falls through.

Before: `benchmarks/deepeval_suite.py` hardcoded a single Groq judge
(`openai/gpt-oss-120b`, `GROQ_API_KEY` only). With Groq billing-restricted
every case 400'd and the DeepEval Benchmark job was red on unchanged engine
code. The staging gate (`tools/staging_test.py`) already got the OpenAI-first
judge cascade in #4349; this is the same shape for the benchmark judge.

Contract pinned here (offline, zero network):
  - no OPENAI_API_KEY → exactly the pre-existing Groq judge body;
  - with the key → OpenAI first in the gpt-5 dialect (max_completion_tokens,
    no temperature, reasoning_effort medium);
  - a non-2xx or transport error on one provider falls through to the next,
    sync and async; every provider failing raises with the attempt list;
  - no provider configured raises before any request.

Run: cd mira-bots && python3 -m pytest tests/test_deepeval_judge_cascade.py -q
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from benchmarks import deepeval_suite as suite

PROMPT = "Grade this reply."


def _ok(content: str) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


@pytest.fixture(autouse=True)
def _pin_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Never inherit the shell: every key and model override is set per test."""
    for var in (
        "OPENAI_API_KEY",
        "GROQ_API_KEY",
        "OPENAI_MODEL",
        "DEEPEVAL_JUDGE_OPENAI_MODEL",
        "OPENAI_REASONING_EFFORT",
    ):
        monkeypatch.delenv(var, raising=False)


# ---------------------------------------------------------------------------
# Provider list + request dialect (pure)
# ---------------------------------------------------------------------------


def test_control_no_openai_key_is_the_pre_existing_groq_judge(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    providers = suite.judge_providers()
    assert [p.name for p in providers] == ["groq"]
    body = suite.judge_request_body(providers[0], PROMPT)
    assert body == {
        "model": "openai/gpt-oss-120b",
        "messages": [{"role": "user", "content": PROMPT}],
        "temperature": 0.0,
        "max_tokens": 1024,
        "reasoning_effort": "medium",
    }


def test_openai_leads_in_the_gpt5_dialect(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    providers = suite.judge_providers()
    assert [p.name for p in providers] == ["openai", "groq"]
    openai = providers[0]
    assert openai.url == "https://api.openai.com/v1/chat/completions"
    body = suite.judge_request_body(openai, PROMPT)
    assert body["model"] == "gpt-5.4-mini"
    assert body["max_completion_tokens"] == 1024
    assert body["reasoning_effort"] == "medium"
    # The gpt-5 family answers HTTP 400 to either of these.
    assert "max_tokens" not in body
    assert "temperature" not in body


def test_openai_model_env_precedence_and_empty_string(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("OPENAI_MODEL", "")  # compose maps ${OPENAI_MODEL:-} to ""
    assert suite.judge_providers()[0].model == "gpt-5.4-mini"
    monkeypatch.setenv("OPENAI_MODEL", "gpt-x")
    assert suite.judge_providers()[0].model == "gpt-x"
    monkeypatch.setenv("DEEPEVAL_JUDGE_OPENAI_MODEL", "gpt-judge")
    assert suite.judge_providers()[0].model == "gpt-judge"


def test_no_provider_configured_is_empty_and_the_judge_refuses_before_any_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert suite.judge_providers() == []
    calls: list[str] = []
    monkeypatch.setattr(suite.httpx, "post", lambda url, **kw: calls.append(url) or _ok("x"))
    judge = suite.CascadeJudge()
    with pytest.raises(RuntimeError, match="no judge provider"):
        judge.generate(PROMPT)
    assert calls == []


# ---------------------------------------------------------------------------
# Sync fall-through
# ---------------------------------------------------------------------------


def test_sync_openai_400_falls_through_to_groq(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    seen: list[tuple[str, dict[str, Any], str]] = []

    def fake_post(url: str, **kw: Any) -> httpx.Response:
        seen.append((url, kw["json"], kw["headers"]["Authorization"]))
        if "api.openai.com" in url:
            return httpx.Response(400, json={"error": {"message": "bad request"}})
        return _ok("from groq")

    monkeypatch.setattr(suite.httpx, "post", fake_post)
    judge = suite.CascadeJudge()
    assert judge.generate(PROMPT) == "from groq"
    assert [u.split("/")[2] for u, _, _ in seen] == ["api.openai.com", "api.groq.com"]
    assert seen[0][2] == "Bearer k0"
    assert "max_completion_tokens" in seen[0][1] and "temperature" not in seen[0][1]
    assert seen[1][1]["max_tokens"] == 1024 and seen[1][1]["temperature"] == 0.0


def test_sync_transport_error_falls_through(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")

    def fake_post(url: str, **kw: Any) -> httpx.Response:
        if "api.openai.com" in url:
            raise httpx.ConnectError("boom")
        return _ok("from groq")

    monkeypatch.setattr(suite.httpx, "post", fake_post)
    assert suite.CascadeJudge().generate(PROMPT) == "from groq"


def test_sync_every_provider_failing_raises_with_the_attempt_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    monkeypatch.setattr(
        suite.httpx,
        "post",
        lambda url, **kw: httpx.Response(402 if "api.openai.com" in url else 400, text="no"),
    )
    with pytest.raises(RuntimeError) as exc:
        suite.CascadeJudge().generate(PROMPT)
    assert "openai=HTTP402" in str(exc.value) and "groq=HTTP400" in str(exc.value)


def test_control_sync_openai_serving_never_touches_groq(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    urls: list[str] = []
    monkeypatch.setattr(
        suite.httpx, "post", lambda url, **kw: urls.append(url) or _ok("from openai")
    )
    assert suite.CascadeJudge().generate(PROMPT) == "from openai"
    assert len(urls) == 1 and "api.openai.com" in urls[0]


# ---------------------------------------------------------------------------
# Async fall-through (the path DeepEval actually drives)
# ---------------------------------------------------------------------------


class _FakeAsyncClient:
    """Stands in for httpx.AsyncClient: same `async with` + `.post` surface."""

    script: dict[str, httpx.Response | Exception] = {}
    seen: list[str] = []

    def __init__(self, *a: Any, **kw: Any) -> None: ...

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, *a: Any) -> None: ...

    async def post(self, url: str, **kw: Any) -> httpx.Response:
        _FakeAsyncClient.seen.append(url)
        host = url.split("/")[2]
        r = _FakeAsyncClient.script[host]
        if isinstance(r, Exception):
            raise r
        return r


@pytest.fixture
def fake_async(monkeypatch: pytest.MonkeyPatch) -> type[_FakeAsyncClient]:
    _FakeAsyncClient.script = {}
    _FakeAsyncClient.seen = []
    monkeypatch.setattr(suite.httpx, "AsyncClient", _FakeAsyncClient)
    return _FakeAsyncClient


async def test_async_openai_402_falls_through_to_groq(
    monkeypatch: pytest.MonkeyPatch, fake_async: type[_FakeAsyncClient]
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    fake_async.script = {
        "api.openai.com": httpx.Response(402, text="credit"),
        "api.groq.com": _ok("from groq"),
    }
    assert await suite.CascadeJudge().a_generate(PROMPT) == "from groq"
    assert [u.split("/")[2] for u in fake_async.seen] == ["api.openai.com", "api.groq.com"]


async def test_async_every_provider_failing_raises(
    monkeypatch: pytest.MonkeyPatch, fake_async: type[_FakeAsyncClient]
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    fake_async.script = {
        "api.openai.com": httpx.ReadTimeout("slow"),
        "api.groq.com": httpx.Response(400, text="restricted"),
    }
    with pytest.raises(RuntimeError) as exc:
        await suite.CascadeJudge().a_generate(PROMPT)
    assert "openai=ReadTimeout" in str(exc.value) and "groq=HTTP400" in str(exc.value)


async def test_async_schema_path_parses_the_served_json(
    monkeypatch: pytest.MonkeyPatch, fake_async: type[_FakeAsyncClient]
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    fake_async.script = {"api.openai.com": _ok("```json\n" + json.dumps({"score": 4}) + "\n```")}

    class Schema:
        @staticmethod
        def model_validate_json(raw: str) -> dict[str, Any]:
            return json.loads(raw)

    assert await suite.CascadeJudge().a_generate(PROMPT, schema=Schema) == {"score": 4}


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def test_model_name_reports_the_primary_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    assert suite.CascadeJudge().get_model_name() == "groq/openai/gpt-oss-120b"
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    assert suite.CascadeJudge().get_model_name() == "openai/gpt-5.4-mini"


def test_groq_judge_alias_is_the_cascade_judge() -> None:
    assert suite.GroqJudge is suite.CascadeJudge
