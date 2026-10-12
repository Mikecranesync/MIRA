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

import asyncio
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
        "DEEPEVAL_JUDGE_PRIMARY",
        "OPENAI_REASONING_EFFORT",
        "DEEPEVAL_JUDGE_BUDGET_USD",
        "OPENAI_PRICE_PER_MTOK_IN",
        "OPENAI_PRICE_PER_MTOK_OUT",
    ):
        monkeypatch.delenv(var, raising=False)
    # The committed evidence store must never be read or written by a test;
    # the recall tests point DEEPEVAL_JUDGE_EVIDENCE at a tmp file explicitly.
    monkeypatch.setenv("DEEPEVAL_JUDGE_EVIDENCE", "off")
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


MINI = "gpt-5.4-mini"


def test_budget_cap_defaults_and_env_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    assert suite.JudgeBudget().cap_usd == 2.0
    for junk in ("", "abc", "-1", "nan", "inf"):
        monkeypatch.setenv("DEEPEVAL_JUDGE_BUDGET_USD", junk)
        assert suite.JudgeBudget().cap_usd == 2.0, junk
    monkeypatch.setenv("DEEPEVAL_JUDGE_BUDGET_USD", "0.5")
    assert suite.JudgeBudget().cap_usd == 0.5


def test_budget_default_prices_equal_the_repo_declared_gpt54_mini_rate() -> None:
    prices = json.loads(
        (Path(suite.__file__).parents[2] / "tools/review_router/prices.json").read_text()
    )
    rate = prices["usd_per_mtok"][MINI]
    assert (suite.DEFAULT_PRICE_PER_MTOK_IN, suite.DEFAULT_PRICE_PER_MTOK_OUT) == (
        rate["input"],
        rate["output"],
    )
    assert suite.resolve_judge_prices(MINI) == (rate["input"], rate["output"])


def test_budget_estimate_is_a_worst_case_and_settle_charges_actual_usage() -> None:
    b = suite.JudgeBudget()
    est = b.estimate_usd("x" * 1000, MINI)
    # input bounded by bytes (+8 framing), output by the 1024-token cap, at 0.75/4.5 per Mtok
    assert est == pytest.approx((1008 * 0.75 + 1024 * 4.5) / 1e6)
    assert b.reserve(est) and b.held_usd == pytest.approx(est) and b.spent_usd == 0.0
    charged = b.settle(est, {"prompt_tokens": 100, "completion_tokens": 10}, MINI)
    assert charged == pytest.approx((100 * 0.75 + 10 * 4.5) / 1e6)
    assert b.spent_usd == pytest.approx(charged) and b.held_usd == pytest.approx(0.0)
    assert b.calls == 1
    # No usage block → the estimate is charged, never zero.
    assert b.reserve(est) and b.settle(est, None, MINI) == pytest.approx(est)
    assert b.reserve(est) and b.settle(est, {"prompt_tokens": "junk"}, MINI) == pytest.approx(est)
    assert b.calls == 3 and b.held_usd == pytest.approx(0.0)


def test_budget_reserve_is_atomic_release_and_uncertain_charge(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DEEPEVAL_JUDGE_BUDGET_USD", "0.01")
    b = suite.JudgeBudget()
    est = b.estimate_usd(PROMPT, MINI)
    assert est is not None and est == pytest.approx((len(PROMPT) + 8) * 0.75e-6 + 1024 * 4.5e-6)
    # Two holds fit under $0.01 (≈ $0.0046 each); a third does not — refused with nothing served.
    assert b.reserve(est) and b.reserve(est)
    assert not b.reserve(est) and b.refusals == 1 and b.calls == 0
    # A rejected request (non-2xx) releases its hold; the third caller now fits.
    b.release(est)
    assert b.held_usd == pytest.approx(est) and b.reserve(est)
    # A transport failure after dispatch keeps the hold as spend: counted, not refundable.
    b.charge_uncertain(est)
    assert b.spent_usd == pytest.approx(est) and b.held_usd == pytest.approx(est) and b.calls == 1
    assert b.summary()["held_usd"] == pytest.approx(est, abs=1e-6)


def test_sync_read_timeouts_after_dispatch_are_charged_until_the_cap_refuses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    monkeypatch.setenv("DEEPEVAL_JUDGE_BUDGET_USD", "0.01")  # room for two worst cases
    urls: list[str] = []

    def fake_post(url: str, **kw: Any) -> httpx.Response:
        urls.append(url.split("/")[2])
        if "api.openai.com" in url:
            raise httpx.ReadTimeout("slow")
        return _ok("from groq")

    monkeypatch.setattr(suite.httpx, "post", fake_post)
    judge = suite.CascadeJudge()
    for _ in range(4):
        assert judge.generate(PROMPT) == "from groq"
    b = suite.judge_budget()
    # Two timeouts were dispatched and charged at their worst case; the next two
    # were refused BEFORE the request because the uncertain spend stands.
    assert urls.count("api.openai.com") == 2 and urls.count("api.groq.com") == 4
    assert b.calls == 2 and b.refusals == 2 and b.held_usd == pytest.approx(0.0)
    assert b.spent_usd == pytest.approx(2 * (b.estimate_usd(PROMPT, MINI) or 0))


async def test_async_read_timeouts_after_dispatch_are_charged_until_the_cap_refuses(
    monkeypatch: pytest.MonkeyPatch, fake_async: type[_FakeAsyncClient]
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    monkeypatch.setenv("DEEPEVAL_JUDGE_BUDGET_USD", "0.01")
    fake_async.script = {"api.openai.com": httpx.ReadTimeout("slow"), "api.groq.com": _ok("g")}
    judge = suite.CascadeJudge()
    for _ in range(4):
        assert await judge.a_generate(PROMPT) == "g"
    hosts = [u.split("/")[2] for u in fake_async.seen]
    assert hosts.count("api.openai.com") == 2 and hosts.count("api.groq.com") == 4
    assert suite.judge_budget().calls == 2 and suite.judge_budget().refusals == 2


def test_sync_rejected_request_releases_the_hold(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    monkeypatch.setenv("DEEPEVAL_JUDGE_BUDGET_USD", "0.005")  # room for exactly one worst case
    monkeypatch.setattr(
        suite.httpx,
        "post",
        lambda url, **kw: (
            httpx.Response(429, text="slow down") if "api.openai.com" in url else _ok("from groq")
        ),
    )
    judge = suite.CascadeJudge()
    for _ in range(3):
        assert judge.generate(PROMPT) == "from groq"
    b = suite.judge_budget()
    # Every attempt was dispatched (the hold came back each time) and nothing was charged.
    assert (b.calls, b.refusals, b.spent_usd, b.held_usd) == (0, 0, 0.0, 0.0)


class _SlowAsyncClient(_FakeAsyncClient):
    """OpenAI answers only after yielding to the loop, so concurrent callers overlap in flight."""

    async def post(self, url: str, **kw: Any) -> httpx.Response:
        if "api.openai.com" in url:
            await asyncio.sleep(0.01)
        return await super().post(url, **kw)


async def test_concurrent_async_callers_share_one_reservation_pool(
    monkeypatch: pytest.MonkeyPatch, fake_async: type[_FakeAsyncClient]
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    monkeypatch.setenv("DEEPEVAL_JUDGE_BUDGET_USD", "0.005")  # room for exactly one worst case
    fake_async.script = {
        "api.openai.com": _ok("from openai", usage={"prompt_tokens": 5, "completion_tokens": 5}),
        "api.groq.com": _ok("from groq"),
    }
    monkeypatch.setattr(
        suite.httpx, "AsyncClient", _SlowAsyncClient
    )  # same script/seen, slow OpenAI
    judge = suite.CascadeJudge()
    results = await asyncio.gather(*(judge.a_generate(PROMPT) for _ in range(3)))
    hosts = [u.split("/")[2] for u in fake_async.seen]
    # Only ONE metered request was dispatched; the other two were refused by the
    # hold while the first was still in flight, and Groq served them.
    assert hosts.count("api.openai.com") == 1 and hosts.count("api.groq.com") == 2
    assert sorted(results) == ["from groq", "from groq", "from openai"]
    b = suite.judge_budget()
    assert b.calls == 1 and b.refusals == 2 and b.held_usd == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# Codex F4 — prices follow the SELECTED model; unknown prices fail closed
# ---------------------------------------------------------------------------


def test_prices_resolve_from_the_repo_table_for_the_selected_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    table = suite.declared_price_table()
    assert table[MINI] == (0.75, 4.5) and table["gpt-5.4"] == (2.5, 15.0)
    assert suite.resolve_judge_prices("gpt-5.4") == (2.5, 15.0)
    assert suite.resolve_judge_prices("gpt-nope") is None
    # An explicit override (both rates > 0) wins and makes an unknown model priceable.
    monkeypatch.setenv("OPENAI_PRICE_PER_MTOK_IN", "1")
    monkeypatch.setenv("OPENAI_PRICE_PER_MTOK_OUT", "2")
    assert suite.resolve_judge_prices("gpt-nope") == (1.0, 2.0)
    assert suite.resolve_judge_prices(MINI) == (1.0, 2.0)
    # A zero rate is not a price: the override is ignored and the table decides.
    monkeypatch.setenv("OPENAI_PRICE_PER_MTOK_OUT", "0")
    assert suite.resolve_judge_prices("gpt-nope") is None
    assert suite.resolve_judge_prices(MINI) == (0.75, 4.5)


def test_model_override_is_estimated_and_settled_at_its_own_rate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("DEEPEVAL_JUDGE_OPENAI_MODEL", "gpt-5.4")
    b = suite.JudgeBudget()
    est_mini = b.estimate_usd(PROMPT, MINI)
    est_big = b.estimate_usd(PROMPT, "gpt-5.4")
    assert est_big == pytest.approx(((len(PROMPT) + 8) * 2.5 + 1024 * 15.0) / 1e6)
    assert est_mini is not None and est_big is not None and est_big > est_mini * 3
    monkeypatch.setattr(
        suite.httpx,
        "post",
        lambda url, **kw: _ok("from openai", usage={"prompt_tokens": 100, "completion_tokens": 10}),
    )
    assert suite.CascadeJudge().generate(PROMPT) == "from openai"
    assert suite.judge_budget().spent_usd == pytest.approx((100 * 2.5 + 10 * 15.0) / 1e6)


def test_a_cap_between_the_mini_and_the_selected_model_cost_blocks_dispatch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    monkeypatch.setenv("DEEPEVAL_JUDGE_OPENAI_MODEL", "gpt-5.4")
    monkeypatch.setenv(
        "DEEPEVAL_JUDGE_BUDGET_USD", "0.01"
    )  # mini worst case ≈ $0.0046 fits; gpt-5.4 ≈ $0.0154 does not
    urls: list[str] = []
    monkeypatch.setattr(
        suite.httpx, "post", lambda url, **kw: urls.append(url.split("/")[2]) or _ok("x")
    )
    assert suite.CascadeJudge().generate(PROMPT) == "x"
    assert urls == ["api.groq.com"] and suite.judge_budget().refusals == 1


def test_unknown_model_price_fails_closed_before_any_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    monkeypatch.setenv("DEEPEVAL_JUDGE_OPENAI_MODEL", "gpt-nope")
    urls: list[str] = []
    monkeypatch.setattr(
        suite.httpx, "post", lambda url, **kw: urls.append(url.split("/")[2]) or _ok("x")
    )
    assert suite.CascadeJudge().generate(PROMPT) == "x"
    assert urls == ["api.groq.com"]
    monkeypatch.setenv("GROQ_API_KEY", "")
    with pytest.raises(RuntimeError, match="openai=price_unknown"):
        suite.CascadeJudge().generate(PROMPT)
    assert urls == ["api.groq.com"]  # still no metered request
    # Declaring the price (control) lets the override model through.
    monkeypatch.setenv("OPENAI_PRICE_PER_MTOK_IN", "1")
    monkeypatch.setenv("OPENAI_PRICE_PER_MTOK_OUT", "2")
    assert suite.CascadeJudge().generate(PROMPT) == "x"
    assert urls == ["api.groq.com", "api.openai.com"]


# ---------------------------------------------------------------------------
# Codex F5 — recall before recompute: unchanged inputs cost zero tokens
# ---------------------------------------------------------------------------


@pytest.fixture
def evidence_path(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    p = tmp_path / "judge_evidence.json"
    monkeypatch.setenv("DEEPEVAL_JUDGE_EVIDENCE", str(p))
    return p


def test_second_identical_judge_call_makes_zero_requests(
    monkeypatch: pytest.MonkeyPatch, evidence_path: Path
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    urls: list[str] = []
    monkeypatch.setattr(
        suite.httpx, "post", lambda url, **kw: urls.append(url) or _ok(json.dumps({"score": 4}))
    )
    judge = suite.CascadeJudge()
    assert judge.generate(PROMPT, schema=Schema) == {"score": 4}
    assert len(urls) == 1 and evidence_path.exists()
    stored = json.loads(evidence_path.read_text())
    assert stored["contract"] == suite.JUDGE_EVIDENCE_CONTRACT and len(stored["entries"]) == 1
    (entry,) = stored["entries"].values()
    assert entry["served_by"] == f"openai/{MINI}" and json.loads(entry["content"]) == {"score": 4}
    # Same inputs, a fresh judge in a fresh process: recalled, no HTTP, attributed as recall.
    judge2 = suite.CascadeJudge()
    assert judge2.generate(PROMPT, schema=Schema) == {"score": 4}
    assert len(urls) == 1  # recalled: no request
    assert judge2.served_counts().get(f"recall:openai/{MINI}") == 1
    assert judge2.evidence_summary()["hits"] == 1
    # The schema is part of the key: the same prompt WITHOUT a schema is a different verdict.
    assert judge2.generate(PROMPT) == json.dumps({"score": 4})
    assert len(urls) == 2
    assert suite.judge_budget().calls == 2  # every request, and only requests, was metered


def test_model_off_recall_answers_with_no_provider_configured(
    monkeypatch: pytest.MonkeyPatch, evidence_path: Path
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setattr(suite.httpx, "post", lambda url, **kw: _ok("verdict"))
    assert suite.CascadeJudge().generate(PROMPT) == "verdict"
    # Key gone: the CONFIGURATION is unchanged (primary OpenAI judge, default
    # model), so the verdict is recalled — a credential is not a key input.
    monkeypatch.delenv("OPENAI_API_KEY")
    calls: list[str] = []
    monkeypatch.setattr(suite.httpx, "post", lambda url, **kw: calls.append(url) or _ok("x"))
    judge = suite.CascadeJudge()
    assert judge.get_model_name() == f"openai/{MINI}"
    assert judge.generate(PROMPT) == "verdict" and calls == []
    assert judge.served_counts() == {f"recall:openai/{MINI}": 1}
    # A prompt the store has not seen still refuses before any request (control).
    with pytest.raises(RuntimeError, match="no judge provider"):
        judge.generate(PROMPT + " changed")
    assert calls == []


def test_changing_one_declared_dependency_regenerates_only_that_verdict(
    monkeypatch: pytest.MonkeyPatch, evidence_path: Path
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    served: list[str] = []
    monkeypatch.setattr(suite.httpx, "post", lambda url, **kw: served.append(url) or _ok("v1"))
    judge = suite.CascadeJudge()
    assert judge.generate("A") == "v1" and judge.generate("B") == "v1"
    assert len(served) == 2
    # Judge model changes → both keys miss; the old verdicts stay in the file for the old config.
    monkeypatch.setenv("DEEPEVAL_JUDGE_OPENAI_MODEL", "gpt-5.4")
    assert suite.CascadeJudge().generate("A") == "v1" and len(served) == 3
    assert len(json.loads(evidence_path.read_text())["entries"]) == 3
    # Back on the original model: A and B are recalled, only a NEW prompt C is judged.
    monkeypatch.delenv("DEEPEVAL_JUDGE_OPENAI_MODEL")
    judge3 = suite.CascadeJudge()
    assert judge3.generate("A") == "v1" and judge3.generate("B") == "v1" and len(served) == 3
    assert judge3.generate("C") == "v1" and len(served) == 4
    assert judge3.evidence_summary()["hits"] == 2 and judge3.evidence_summary()["misses"] == 1
    # A contract bump invalidates everything stored.
    monkeypatch.setattr(suite, "JUDGE_EVIDENCE_CONTRACT", "2")
    assert suite.CascadeJudge().generate("A") == "v1" and len(served) == 5


def test_unusable_stored_verdict_is_a_miss_not_an_answer(
    monkeypatch: pytest.MonkeyPatch, evidence_path: Path
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    key = suite.JudgeEvidenceStore.key(f"openai/{MINI}", "Schema", PROMPT)
    evidence_path.write_text(
        json.dumps(
            {
                "contract": suite.JUDGE_EVIDENCE_CONTRACT,
                "entries": {key: {"content": "not json", "served_by": "x"}},
            }
        )
    )
    served: list[str] = []
    monkeypatch.setattr(
        suite.httpx, "post", lambda url, **kw: served.append(url) or _ok(json.dumps({"score": 1}))
    )
    assert suite.CascadeJudge().generate(PROMPT, schema=Schema) == {"score": 1}
    assert len(served) == 1
    # And the bad entry was replaced by the served one.
    assert json.loads(json.loads(evidence_path.read_text())["entries"][key]["content"]) == {
        "score": 1
    }


def test_evidence_store_off_never_reads_or_writes(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("DEEPEVAL_JUDGE_EVIDENCE", "off")
    urls: list[str] = []
    monkeypatch.setattr(suite.httpx, "post", lambda url, **kw: urls.append(url) or _ok("x"))
    judge = suite.CascadeJudge()
    assert judge.generate(PROMPT) == "x" and judge.generate(PROMPT) == "x"
    assert len(urls) == 2 and judge.evidence_summary()["path"] == "off"
    assert list(tmp_path.iterdir()) == []


def test_committed_store_is_the_default_and_starts_at_the_current_contract() -> None:
    assert suite._DEFAULT_EVIDENCE_PATH.exists()
    raw = json.loads(suite._DEFAULT_EVIDENCE_PATH.read_text())
    assert raw["contract"] == suite.JUDGE_EVIDENCE_CONTRACT and isinstance(raw["entries"], dict)


def test_print_report_shows_the_recall_ledger(capsys: pytest.CaptureFixture[str]) -> None:
    r = suite.SuiteResult(
        mode="offline", timestamp="2026-10-11T22:00:00", judge_model=f"openai/{MINI}"
    )
    r.judge_recall = {"path": "x.json", "entries": 116, "hits": 116, "misses": 0, "writes": 0}
    suite._print_report(r)
    assert "Judge recall: 116 hits, 0 misses, 0 written (x.json)" in capsys.readouterr().out


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


# ---------------------------------------------------------------------------
# The CLI gate: a warm store lets a model-off run start; nothing else does
# ---------------------------------------------------------------------------


def test_judge_available_with_a_provider_or_a_warm_store_only(
    monkeypatch: pytest.MonkeyPatch, evidence_path: Path
) -> None:
    # No provider, empty (nonexistent) store → refused.
    ok, note = suite.judge_available()
    assert not ok and "no judge provider configured" in note
    # No provider, warm store → allowed with a loud warning naming the store.
    evidence_path.write_text(
        json.dumps(
            {
                "contract": suite.JUDGE_EVIDENCE_CONTRACT,
                "entries": {"k": {"content": "v", "served_by": "x"}},
            }
        )
    )
    ok, note = suite.judge_available()
    assert ok and note.startswith("WARNING") and "1 stored verdicts" in note
    # Store off, no provider → refused even though the file exists.
    monkeypatch.setenv("DEEPEVAL_JUDGE_EVIDENCE", "off")
    assert suite.judge_available()[0] is False
    # A provider (control) → allowed, no note.
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    assert suite.judge_available() == (True, "")


# ---------------------------------------------------------------------------
# Codex r3 — first-use budget initialization is serialized and every hold
# settles on the instance it was taken on; evidence writers merge, never clobber
# ---------------------------------------------------------------------------


def test_two_threads_first_use_share_one_budget_pool(monkeypatch: pytest.MonkeyPatch) -> None:
    import threading
    import time

    constructed: list[int] = []
    real_init = suite.JudgeBudget.__init__

    def slow_init(self: Any) -> None:  # widen the window in which both threads see "uninitialized"
        constructed.append(1)
        time.sleep(0.05)
        real_init(self)

    monkeypatch.setattr(suite.JudgeBudget, "__init__", slow_init)
    got: list[Any] = []
    threads = [threading.Thread(target=lambda: got.append(suite.judge_budget())) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(got) == 2 and got[0] is got[1]
    assert constructed == [1]  # exactly one pool was ever built


def test_two_sync_threads_under_a_one_call_cap_dispatch_exactly_one_metered_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import threading
    import time

    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    monkeypatch.setenv("DEEPEVAL_JUDGE_BUDGET_USD", "0.005")  # room for exactly one worst case
    hosts: list[str] = []
    lock = threading.Lock()

    def fake_post(url: str, **kw: Any) -> httpx.Response:
        with lock:
            hosts.append(url.split("/")[2])
        if "api.openai.com" in url:
            time.sleep(0.05)  # in flight while the other thread reserves
            return _ok("from openai", usage={"prompt_tokens": 5, "completion_tokens": 5})
        return _ok("from groq")

    monkeypatch.setattr(suite.httpx, "post", fake_post)
    judge = suite.CascadeJudge()
    results: list[str] = []
    threads = [
        threading.Thread(target=lambda: results.append(str(judge.generate(PROMPT))))
        for _ in range(2)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == ["from groq", "from openai"]
    assert hosts.count("api.openai.com") == 1 and hosts.count("api.groq.com") == 1
    b = suite.judge_budget()
    assert b.calls == 1 and b.refusals == 1
    assert b.held_usd == pytest.approx(0.0) and b.spent_usd >= 0.0


def test_two_stores_on_one_file_keep_each_others_verdicts(evidence_path: Path) -> None:
    s1 = suite.JudgeEvidenceStore(evidence_path)
    s2 = suite.JudgeEvidenceStore(evidence_path)  # both loaded the (empty) file before either wrote
    s1.put("A", "verdict-a", "openai/x")
    s2.put("B", "verdict-b", "openai/x")
    fresh = suite.JudgeEvidenceStore(evidence_path)
    assert fresh.get("A") == "verdict-a" and fresh.get("B") == "verdict-b"
    # The second writer's own view absorbed the first writer's verdict too.
    assert s2.get("A") == "verdict-a"
    assert json.loads(evidence_path.read_text())["contract"] == suite.JUDGE_EVIDENCE_CONTRACT
    assert (
        list(evidence_path.parent.glob(".judge_evidence.*.tmp")) == []
    )  # no temp file left behind


def test_concurrent_writers_lose_nothing_and_recall_costs_zero(
    monkeypatch: pytest.MonkeyPatch, evidence_path: Path
) -> None:
    import threading

    def writer(n: int) -> None:
        store = suite.JudgeEvidenceStore(evidence_path)
        for i in range(10):
            store.put(f"w{n}-{i}", f"v{n}-{i}", "openai/x")

    threads = [threading.Thread(target=writer, args=(n,)) for n in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    durable = json.loads(evidence_path.read_text())["entries"]
    assert len(durable) == 40
    assert all(durable[f"w{n}-{i}"]["content"] == f"v{n}-{i}" for n in range(4) for i in range(10))
    # Every verdict is recalled with no provider configured and no request.
    monkeypatch.setattr(
        suite.httpx, "post", lambda url, **kw: (_ for _ in ()).throw(AssertionError("no requests"))
    )
    fresh = suite.JudgeEvidenceStore(evidence_path)
    assert all(fresh.get(f"w{n}-{i}") == f"v{n}-{i}" for n in range(4) for i in range(10))
    assert fresh.hits == 40 and fresh.misses == 0


def test_one_shared_store_two_writers_keeps_both_verdicts(
    monkeypatch: pytest.MonkeyPatch, evidence_path: Path
) -> None:
    """Codex r4 F6 on #4358: two threads sharing ONE store (one CascadeJudge).

    Before the fix, `put` inserted into the shared `_entries` dict BEFORE taking
    the write lock. Writer A, inside the lock, copied `_entries` into `merged`;
    writer B then inserted B into `_entries`; A assigned the stale `merged` back,
    deleting B — and B's own write, now merging from A's stale view, never saw
    its verdict again. Both `put` calls returned; only A survived.

    The interleaving is forced deterministically: the durable read A performs
    inside the critical section returns a dict whose `update` (the copy step)
    pauses until B's verdict appears in the shared dict — which it can only do
    if B inserted OUTSIDE the lock. With the fix B is blocked on the lock, the
    pause times out, and both verdicts are durable.
    """
    import threading
    import time

    store = suite.JudgeEvidenceStore(evidence_path)
    real_load = suite.JudgeEvidenceStore._load
    a_copied = threading.Event()
    paused = {"done": False}

    class PausingDict(dict):
        def update(self, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
            super().update(*args, **kwargs)
            if paused["done"]:
                return
            paused["done"] = True
            a_copied.set()
            deadline = time.monotonic() + 1.5
            while "B" not in store._entries and time.monotonic() < deadline:
                time.sleep(0.005)

    def pausing_load(path: Path) -> dict[str, dict[str, str]]:
        return PausingDict(real_load(path))

    monkeypatch.setattr(suite.JudgeEvidenceStore, "_load", staticmethod(pausing_load))

    a = threading.Thread(target=store.put, args=("A", "verdict-a", "openai/x"))
    a.start()
    assert a_copied.wait(5.0), "writer A never reached its copy step"
    b = threading.Thread(target=store.put, args=("B", "verdict-b", "openai/x"))
    b.start()
    a.join(10.0)
    b.join(10.0)
    assert not a.is_alive() and not b.is_alive()

    durable = json.loads(evidence_path.read_text())["entries"]
    assert sorted(durable) == ["A", "B"], f"a shared-store writer lost a verdict: {sorted(durable)}"
    assert store.get("A") == "verdict-a" and store.get("B") == "verdict-b"
    assert store.writes == 2
    # A fresh judge recalls both with no provider configured and no request.
    monkeypatch.setattr(
        suite.httpx, "post", lambda url, **kw: (_ for _ in ()).throw(AssertionError("no requests"))
    )
    monkeypatch.setattr(suite.JudgeEvidenceStore, "_load", staticmethod(real_load))
    fresh = suite.JudgeEvidenceStore(evidence_path)
    assert fresh.get("A") == "verdict-a" and fresh.get("B") == "verdict-b"
    assert fresh.hits == 2 and fresh.misses == 0


# ---------------------------------------------------------------------------
# Codex r5 F7 on #4358 — the recall identity is DECLARED, not inferred from keys
# ---------------------------------------------------------------------------


def test_groq_only_seed_is_recalled_model_off_when_groq_stays_declared(
    monkeypatch: pytest.MonkeyPatch, evidence_path: Path
) -> None:
    """Seed through a Groq-only judge, remove every credential, keep the declared
    Groq configuration: identical sync and async calls recall with zero HTTP;
    an unseen prompt still refuses. Before the fix the identity flipped to the
    OpenAI default the moment the Groq key went away, so every key missed and
    the warm-store CLI gate admitted a run that then failed every case."""
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    monkeypatch.setattr(suite.httpx, "post", lambda url, **kw: _ok("groq-verdict"))
    seeded = suite.CascadeJudge()
    assert seeded.get_model_name() == "groq/openai/gpt-oss-120b"
    assert seeded.generate(PROMPT) == "groq-verdict"
    assert json.loads(evidence_path.read_text())["entries"]
    # Credentials gone; the DECLARED configuration is unchanged.
    monkeypatch.delenv("GROQ_API_KEY")
    monkeypatch.setenv("DEEPEVAL_JUDGE_PRIMARY", "groq")
    calls: list[str] = []
    monkeypatch.setattr(suite.httpx, "post", lambda url, **kw: calls.append(url) or _ok("x"))
    ok, warning = suite.judge_available()
    assert ok and "recalled evidence only" in warning
    judge = suite.CascadeJudge()
    assert judge.get_model_name() == "groq/openai/gpt-oss-120b"
    assert judge.generate(PROMPT) == "groq-verdict"
    assert asyncio.run(judge.a_generate(PROMPT)) == "groq-verdict"
    assert calls == []
    assert judge.served_counts() == {"recall:groq/openai/gpt-oss-120b": 2}
    with pytest.raises(RuntimeError, match="no judge provider"):
        judge.generate(PROMPT + " unseen")
    assert calls == []


def test_declared_primary_leads_the_cascade_and_names_the_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    monkeypatch.setenv("DEEPEVAL_JUDGE_PRIMARY", "groq")
    urls: list[str] = []
    monkeypatch.setattr(suite.httpx, "post", lambda url, **kw: urls.append(url) or _ok("v"))
    judge = suite.CascadeJudge()
    assert judge.get_model_name() == "groq/openai/gpt-oss-120b"
    assert [p.name for p in suite.judge_providers()] == ["groq", "openai"]
    assert judge.generate(PROMPT) == "v"
    assert urls == [suite.GROQ_API_URL]  # Groq led; OpenAI untouched, nothing metered
    assert suite.judge_budget().calls == 0
    # The explicit declaration also wins over a key-inferred identity.
    monkeypatch.setenv("DEEPEVAL_JUDGE_PRIMARY", "openai")
    monkeypatch.delenv("OPENAI_API_KEY")
    assert suite.CascadeJudge().get_model_name() == f"openai/{MINI}"
    assert [p.name for p in suite.judge_providers()] == ["groq"]  # fallback still serves


def test_unknown_declared_primary_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("DEEPEVAL_JUDGE_PRIMARY", "gemini")
    with pytest.raises(ValueError, match="DEEPEVAL_JUDGE_PRIMARY"):
        suite.CascadeJudge()


# ---------------------------------------------------------------------------
# Codex r6 F8 on #4358 — a recalled verdict must have been served by a model
# that is STILL configured; changing the fallback model invalidates its verdicts
# ---------------------------------------------------------------------------


def test_changing_the_fallback_model_regenerates_verdicts_it_served(
    monkeypatch: pytest.MonkeyPatch, evidence_path: Path
) -> None:
    """Groq declared primary, both keys present, Groq billing-restricted (HTTP 400):
    the OpenAI mini fallback serves and stores the verdict. Change ONLY the
    OpenAI model: a fresh judge must regenerate (sync and async) with the new
    model rather than recall the mini's verdict — the recall key names the
    primary, so the serving model is checked at recall time instead."""
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    monkeypatch.setenv("DEEPEVAL_JUDGE_PRIMARY", "groq")
    sent: list[tuple[str, str]] = []

    def post(url: str, **kw: Any) -> httpx.Response:
        if "api.groq.com" in url:
            return httpx.Response(400, json={"error": {"message": "billing"}})
        sent.append((url, kw["json"]["model"]))
        return _ok(f"verdict from {kw['json']['model']}")

    monkeypatch.setattr(suite.httpx, "post", post)
    seeded = suite.CascadeJudge()
    assert seeded.get_model_name() == "groq/openai/gpt-oss-120b"
    assert seeded.generate(PROMPT) == f"verdict from {MINI}"
    assert [m for _, m in sent] == [MINI]
    # Unchanged configuration, credentials removed: still recalled, zero HTTP (control).
    monkeypatch.delenv("OPENAI_API_KEY")
    monkeypatch.delenv("GROQ_API_KEY")
    assert suite.CascadeJudge().generate(PROMPT) == f"verdict from {MINI}" and len(sent) == 1
    # The fallback model changes; the primary identity does not.
    monkeypatch.setenv("OPENAI_API_KEY", "k0")
    monkeypatch.setenv("GROQ_API_KEY", "k1")
    monkeypatch.setenv("DEEPEVAL_JUDGE_OPENAI_MODEL", "gpt-5.4")
    judge = suite.CascadeJudge()
    assert judge.get_model_name() == "groq/openai/gpt-oss-120b"
    assert judge.generate(PROMPT) == "verdict from gpt-5.4"
    assert asyncio.run(judge.a_generate(PROMPT)) == "verdict from gpt-5.4"
    assert [m for _, m in sent] == [MINI, "gpt-5.4"]  # regenerated once, then recalled
    assert judge.served_counts() == {"openai/gpt-5.4": 1, "recall:openai/gpt-5.4": 1}
    # A stale-model entry counts as a miss in the store's own ledger.
    assert judge.evidence_summary()["misses"] >= 1
