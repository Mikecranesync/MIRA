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
  - an HTTP 200 whose content is unusable (empty, null, truncated, malformed
    envelope, or JSON that fails the requested schema) ALSO falls through,
    inside the provider loop (Codex F1);
  - the report attributes scoring to the provider that actually graded, kept
    apart from the configured primary (Codex F2);
  - the metered provider is bounded by a declared dollar budget: worst case
    reserved before the call, actual usage charged after, refused before the
    request at the cap, Groq never budgeted (Codex F3);
  - no provider configured raises before any request.

Run: cd mira-bots && python3 -m pytest tests/test_deepeval_judge_cascade.py -q
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest

from benchmarks import deepeval_suite as suite

PROMPT = "Grade this reply."


def _ok(content: Any, usage: dict[str, int] | None = None, finish: str = "stop") -> httpx.Response:
    body: dict[str, Any] = {"choices": [{"message": {"content": content}, "finish_reason": finish}]}
    if usage is not None:
        body["usage"] = usage
    return httpx.Response(200, json=body)


class Schema:
    """Stands in for the pydantic schema DeepEval hands to generate()."""

    @staticmethod
    def model_validate_json(raw: str) -> dict[str, Any]:
        parsed = json.loads(raw)
        if not isinstance(parsed, dict) or "score" not in parsed:
            raise ValueError("score missing")
        return parsed


@pytest.fixture(autouse=True)
def _pin_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Never inherit the shell: every key, model and budget override is set per test."""
    for var in (
        "OPENAI_API_KEY",
        "GROQ_API_KEY",
        "OPENAI_MODEL",
        "DEEPEVAL_JUDGE_OPENAI_MODEL",
        "OPENAI_REASONING_EFFORT",
        "DEEPEVAL_JUDGE_BUDGET_USD",
        "OPENAI_PRICE_PER_MTOK_IN",
        "OPENAI_PRICE_PER_MTOK_OUT",
    ):
        monkeypatch.delenv(var, raising=False)
    suite.reset_judge_budget_for_tests()
    yield
    suite.reset_judge_budget_for_tests()


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
    assert await suite.CascadeJudge().a_generate(PROMPT, schema=Schema) == {"score": 4}


# ---------------------------------------------------------------------------
# Codex F1 — an HTTP 200 with unusable content falls through INSIDE the loop
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("openai_resp", "reason"),
    [
        (_ok(""), "openai=empty_content"),
        (_ok(None), "openai=empty_content"),
        (_ok('{"sco', finish="length"), "openai=truncated"),
        (httpx.Response(200, json={"choices": []}), "openai=malformed_response:IndexError"),
        (httpx.Response(200, text="not json"), "openai=malformed_response:JSONDecodeError"),
        (_ok("not json at all"), "openai=schema_invalid:JSONDecodeError"),
        (_ok(json.dumps({"verdict": "x"})), "openai=schema_invalid:ValueError"),
    ],
)
def test_sync_unusable_200_falls_through_to_groq_with_schema(
    monkeypatch: pytest.MonkeyPatch, openai_resp: httpx.Response, reason: str
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    urls: list[str] = []

    def fake_post(url: str, **kw: Any) -> httpx.Response:
        urls.append(url.split("/")[2])
        return openai_resp if "api.openai.com" in url else _ok(json.dumps({"score": 3}))

    monkeypatch.setattr(suite.httpx, "post", fake_post)
    judge = suite.CascadeJudge()
    assert judge.generate(PROMPT, schema=Schema) == {"score": 3}
    assert urls == ["api.openai.com", "api.groq.com"]
    # And the attempt list names why OpenAI was passed over when everything fails.
    monkeypatch.setattr(
        suite.httpx, "post", lambda url, **kw: openai_resp if "api.openai.com" in url else _ok("")
    )
    with pytest.raises(RuntimeError) as exc:
        suite.CascadeJudge().generate(PROMPT, schema=Schema)
    assert reason in str(exc.value) and "groq=empty_content" in str(exc.value)


def test_sync_empty_200_falls_through_without_a_schema_too(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    monkeypatch.setattr(
        suite.httpx,
        "post",
        lambda url, **kw: _ok("   ") if "api.openai.com" in url else _ok("from groq"),
    )
    assert suite.CascadeJudge().generate(PROMPT) == "from groq"


async def test_async_unusable_200_falls_through_to_groq_with_schema(
    monkeypatch: pytest.MonkeyPatch, fake_async: type[_FakeAsyncClient]
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    fake_async.script = {
        "api.openai.com": _ok("", finish="length"),
        "api.groq.com": _ok(json.dumps({"score": 2})),
    }
    assert await suite.CascadeJudge().a_generate(PROMPT, schema=Schema) == {"score": 2}
    assert [u.split("/")[2] for u in fake_async.seen] == ["api.openai.com", "api.groq.com"]


async def test_async_all_unusable_raises_with_the_diagnostic_attempt_list(
    monkeypatch: pytest.MonkeyPatch, fake_async: type[_FakeAsyncClient]
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    fake_async.script = {
        "api.openai.com": _ok(json.dumps({"nope": 1})),
        "api.groq.com": httpx.Response(200, json={"choices": [{"message": {}}]}),
    }
    with pytest.raises(RuntimeError) as exc:
        await suite.CascadeJudge().a_generate(PROMPT, schema=Schema)
    assert "openai=schema_invalid:ValueError" in str(exc.value)
    assert "groq=malformed_response:KeyError" in str(exc.value)


def test_control_valid_200_is_accepted_first_time_with_schema(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    urls: list[str] = []
    monkeypatch.setattr(
        suite.httpx, "post", lambda url, **kw: urls.append(url) or _ok(json.dumps({"score": 5}))
    )
    assert suite.CascadeJudge().generate(PROMPT, schema=Schema) == {"score": 5}
    assert len(urls) == 1 and "api.openai.com" in urls[0]


# ---------------------------------------------------------------------------
# Codex F2 — scores are attributed to what actually graded
# ---------------------------------------------------------------------------


def test_model_name_reports_the_configured_primary(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    assert suite.CascadeJudge().get_model_name() == "groq/openai/gpt-oss-120b"
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    assert suite.CascadeJudge().get_model_name() == "openai/gpt-5.4-mini"


def test_served_counts_name_the_provider_that_graded(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    monkeypatch.setattr(
        suite.httpx,
        "post",
        lambda url, **kw: (
            httpx.Response(400, text="x") if "api.openai.com" in url else _ok("from groq")
        ),
    )
    judge = suite.CascadeJudge()
    assert judge.served_counts() == {}
    judge.generate(PROMPT)
    judge.generate(PROMPT)
    # The configured primary is still OpenAI; the grading was Groq's, twice.
    assert judge.get_model_name() == "openai/gpt-5.4-mini"
    assert judge.served_counts() == {"groq/openai/gpt-oss-120b": 2}


async def test_served_counts_record_a_mixed_run(
    monkeypatch: pytest.MonkeyPatch, fake_async: type[_FakeAsyncClient]
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    judge = suite.CascadeJudge()
    fake_async.script = {"api.openai.com": _ok("a")}
    await judge.a_generate(PROMPT)
    fake_async.script = {
        "api.openai.com": httpx.Response(402, text="credit"),
        "api.groq.com": _ok("b"),
    }
    await judge.a_generate(PROMPT)
    assert judge.served_counts() == {"openai/gpt-5.4-mini": 1, "groq/openai/gpt-oss-120b": 1}


def test_suite_result_carries_both_the_configured_and_the_actual_judges() -> None:
    r = suite.SuiteResult(mode="offline", timestamp="t", judge_model="openai/gpt-5.4-mini")
    assert r.judge_models_used == {} and r.judge_spend == {}
    r.judge_models_used = {"groq/openai/gpt-oss-120b": 21}
    r.judge_spend = {"cap_usd": 2.0, "spent_usd": 0.0, "metered_calls": 0, "refusals": 0}
    # The saved JSON (asdict) and the printed report carry both.
    assert suite.asdict(r)["judge_models_used"] == {"groq/openai/gpt-oss-120b": 21}


def test_print_report_shows_who_graded_and_the_spend(capsys: pytest.CaptureFixture[str]) -> None:
    r = suite.SuiteResult(
        mode="offline", timestamp="2026-10-11T22:00:00", judge_model="openai/gpt-5.4-mini"
    )
    r.judge_models_used = {"groq/openai/gpt-oss-120b": 21}
    r.judge_spend = {"cap_usd": 2.0, "spent_usd": 0.1234, "metered_calls": 3, "refusals": 1}
    suite._print_report(r)
    out = capsys.readouterr().out
    assert "Judge: openai/gpt-5.4-mini" in out
    assert "Graded by: groq/openai/gpt-oss-120b ×21" in out
    assert "Judge spend: $0.1234 of $2.00 cap (3 metered calls, 1 refused)" in out


# ---------------------------------------------------------------------------
# Codex F3 — the paid judge lane is bounded by a declared dollar budget
# ---------------------------------------------------------------------------


def test_budget_defaults_and_env_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    b = suite.JudgeBudget()
    assert (b.cap_usd, b.price_in, b.price_out) == (2.0, 0.75, 4.5)
    for junk in ("", "abc", "-1", "nan", "inf"):
        monkeypatch.setenv("DEEPEVAL_JUDGE_BUDGET_USD", junk)
        assert suite.JudgeBudget().cap_usd == 2.0, junk
    monkeypatch.setenv("DEEPEVAL_JUDGE_BUDGET_USD", "0.5")
    monkeypatch.setenv("OPENAI_PRICE_PER_MTOK_IN", "1")
    monkeypatch.setenv("OPENAI_PRICE_PER_MTOK_OUT", "2")
    b = suite.JudgeBudget()
    assert (b.cap_usd, b.price_in, b.price_out) == (0.5, 1.0, 2.0)


def test_budget_default_prices_equal_the_repo_declared_gpt54_mini_rate() -> None:
    prices = json.loads(
        (Path(suite.__file__).parents[2] / "tools/review_router/prices.json").read_text()
    )
    rate = prices["usd_per_mtok"]["gpt-5.4-mini"]
    assert (suite.DEFAULT_PRICE_PER_MTOK_IN, suite.DEFAULT_PRICE_PER_MTOK_OUT) == (
        rate["input"],
        rate["output"],
    )


def test_budget_estimate_is_a_worst_case_and_record_charges_actual_usage() -> None:
    b = suite.JudgeBudget()
    est = b.estimate_usd("x" * 1000)
    # input bounded by bytes (+8 framing), output by the 1024-token cap, at 0.75/4.5 per Mtok
    assert est == pytest.approx((1008 * 0.75 + 1024 * 4.5) / 1e6)
    charged = b.record({"prompt_tokens": 100, "completion_tokens": 10}, est)
    assert charged == pytest.approx((100 * 0.75 + 10 * 4.5) / 1e6)
    assert b.spent_usd == pytest.approx(charged) and b.calls == 1
    # No usage block → the estimate is charged, never zero.
    assert b.record(None, est) == pytest.approx(est)
    assert b.record({"prompt_tokens": "junk"}, est) == pytest.approx(est)
    assert b.calls == 3


def test_sync_budget_refuses_openai_before_the_request_and_falls_through(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    monkeypatch.setenv("DEEPEVAL_JUDGE_BUDGET_USD", "0.01")
    urls: list[str] = []

    def fake_post(url: str, **kw: Any) -> httpx.Response:
        urls.append(url.split("/")[2])
        if "api.openai.com" in url:
            return _ok("from openai", usage={"prompt_tokens": 1000, "completion_tokens": 2000})
        return _ok("from groq")

    monkeypatch.setattr(suite.httpx, "post", fake_post)
    judge = suite.CascadeJudge()
    # Call 1 fits (worst case ≈ $0.0047 < $0.01) and is charged its actual ≈ $0.00975.
    assert judge.generate(PROMPT) == "from openai"
    budget = suite.judge_budget()
    assert budget.calls == 1 and budget.spent_usd == pytest.approx(0.00975)
    # Call 2 would cross the cap: OpenAI is NOT requested, Groq serves.
    assert judge.generate(PROMPT) == "from groq"
    assert urls == ["api.openai.com", "api.groq.com"]
    assert budget.refusals == 1 and budget.calls == 1
    assert judge.served_counts() == {"openai/gpt-5.4-mini": 1, "groq/openai/gpt-oss-120b": 1}
    # With Groq also down the attempt list says why.
    monkeypatch.setenv("GROQ_API_KEY", "")
    with pytest.raises(RuntimeError, match="openai=budget_exhausted"):
        suite.CascadeJudge().generate(PROMPT)


async def test_async_budget_refuses_openai_before_the_request(
    monkeypatch: pytest.MonkeyPatch, fake_async: type[_FakeAsyncClient]
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    monkeypatch.setenv("DEEPEVAL_JUDGE_BUDGET_USD", "0")
    fake_async.script = {"api.openai.com": _ok("from openai"), "api.groq.com": _ok("from groq")}
    assert await suite.CascadeJudge().a_generate(PROMPT) == "from groq"
    assert [u.split("/")[2] for u in fake_async.seen] == ["api.groq.com"]
    assert suite.judge_budget().refusals == 1


def test_groq_is_never_budgeted(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    monkeypatch.setenv("DEEPEVAL_JUDGE_BUDGET_USD", "0")
    monkeypatch.setattr(suite.httpx, "post", lambda url, **kw: _ok("from groq"))
    assert suite.CascadeJudge().generate(PROMPT) == "from groq"
    b = suite.judge_budget()
    assert (b.calls, b.refusals, b.spent_usd) == (0, 0, 0.0)


def test_a_served_metered_call_is_charged_even_when_its_content_is_unusable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    monkeypatch.setattr(
        suite.httpx,
        "post",
        lambda url, **kw: (
            _ok("", usage={"prompt_tokens": 10, "completion_tokens": 5})
            if "api.openai.com" in url
            else _ok("from groq")
        ),
    )
    assert suite.CascadeJudge().generate(PROMPT) == "from groq"
    b = suite.judge_budget()
    assert b.calls == 1 and b.spent_usd == pytest.approx((10 * 0.75 + 5 * 4.5) / 1e6)


def test_groq_judge_alias_is_the_cascade_judge() -> None:
    assert suite.GroqJudge is suite.CascadeJudge
