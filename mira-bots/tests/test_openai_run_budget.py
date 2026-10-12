"""Per-run OpenAI spend hard stop — offline contract.

Pins: the cap/window/price env contract (incl. the compose empty-string case),
precheck-before / record-after arithmetic, the rolling window, the default
price equals the repo's declared gpt-5.4-mini rate, and the router skipping
OpenAI (falling through) once the window is exhausted while still recording
real usage after a served call.

Run: cd mira-bots && python -m pytest tests/test_openai_run_budget.py -q
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from shared.inference import run_budget as rb
from shared.inference.router import InferenceRouter, _build_providers

ENV = (
    "OPENAI_RUN_BUDGET_USD",
    "OPENAI_RUN_BUDGET_WINDOW_S",
    "OPENAI_PRICE_PER_MTOK_IN",
    "OPENAI_PRICE_PER_MTOK_OUT",
    "OPENAI_API_KEY",
    "GROQ_API_KEY",
    "CEREBRAS_API_KEY",
    "TOGETHERAI_API_KEY",
    "OPENAI_MODEL",
    "INFERENCE_BACKEND",
)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for var in ENV:
        monkeypatch.delenv(var, raising=False)
    rb.reset_openai_run_budget()
    yield
    rb.reset_openai_run_budget()


class FakeClock:
    def __init__(self, t: float = 0.0) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t


# ── env contract ──────────────────────────────────────────────────────────────


def test_defaults_when_env_is_unset():
    b = rb.OpenAIRunBudget(clock=FakeClock())
    assert b.cap_usd == 10.0
    assert b.window_s == 86_400.0
    assert b.estimate_usd(1_000_000, 0) == pytest.approx(0.75)
    assert b.estimate_usd(0, 1_000_000) == pytest.approx(4.5)


def test_env_overrides_and_compose_empty_string_does_not_win(monkeypatch):
    monkeypatch.setenv("OPENAI_RUN_BUDGET_USD", "2.5")
    monkeypatch.setenv("OPENAI_RUN_BUDGET_WINDOW_S", "3600")
    monkeypatch.setenv("OPENAI_PRICE_PER_MTOK_IN", "1.0")
    monkeypatch.setenv("OPENAI_PRICE_PER_MTOK_OUT", "")  # compose ${VAR:-} → ""
    b = rb.OpenAIRunBudget(clock=FakeClock())
    assert b.cap_usd == 2.5
    assert b.window_s == 3600.0
    assert b.estimate_usd(1_000_000, 1_000_000) == pytest.approx(1.0 + 4.5)


@pytest.mark.parametrize("bad", ["abc", "-1", "nan", "inf"])
def test_junk_cap_falls_back_to_the_default(monkeypatch, bad):
    monkeypatch.setenv("OPENAI_RUN_BUDGET_USD", bad)
    assert rb.OpenAIRunBudget(clock=FakeClock()).cap_usd == 10.0


def test_window_below_one_second_falls_back(monkeypatch):
    monkeypatch.setenv("OPENAI_RUN_BUDGET_WINDOW_S", "0")
    assert rb.OpenAIRunBudget(clock=FakeClock()).window_s == 86_400.0


def test_default_prices_equal_the_repo_declared_gpt54mini_rate():
    prices = json.loads(
        (
            Path(__file__).resolve().parents[2] / "tools" / "review_router" / "prices.json"
        ).read_text()
    )["usd_per_mtok"]["gpt-5.4-mini"]
    assert rb.DEFAULT_PRICE_PER_MTOK_IN == prices["input"]
    assert rb.DEFAULT_PRICE_PER_MTOK_OUT == prices["output"]


# ── precheck / record / window ────────────────────────────────────────────────


def test_precheck_passes_under_the_cap_and_records_actual_spend():
    b = rb.OpenAIRunBudget(cap_usd=1.0, clock=FakeClock())
    b.precheck(100_000, 10_000)  # worst case 0.075 + 0.045 = 0.12
    cost = b.record(100_000, 10_000)
    assert cost == pytest.approx(0.12)
    assert b.spent_usd == pytest.approx(0.12)
    assert b.calls == 1


def test_precheck_hard_stops_when_the_worst_case_would_cross_the_cap():
    b = rb.OpenAIRunBudget(cap_usd=0.10, clock=FakeClock())
    b.record(100_000, 0)  # 0.075 spent
    with pytest.raises(rb.BudgetExceeded) as exc:
        b.precheck(100_000, 0)  # +0.075 → 0.15 > 0.10
    assert "cap=$0.10" in str(exc.value)
    # Control: a call that fits still passes.
    b.precheck(10_000, 0)  # +0.0075 → 0.0825 ≤ 0.10


def test_a_price_of_zero_is_junk_not_free_and_falls_back(monkeypatch):
    # Gate 7 on #4355: 0 would price every call at $0 and silently remove the cap.
    monkeypatch.setenv("OPENAI_PRICE_PER_MTOK_IN", "0")
    monkeypatch.setenv("OPENAI_PRICE_PER_MTOK_OUT", "0.0")
    b = rb.OpenAIRunBudget(clock=FakeClock())
    assert b.estimate_usd(1_000_000, 1_000_000) == pytest.approx(
        rb.DEFAULT_PRICE_PER_MTOK_IN + rb.DEFAULT_PRICE_PER_MTOK_OUT
    )
    # Control: the cap keeps 0 as a legal "spend nothing" instruction.
    monkeypatch.setenv("OPENAI_RUN_BUDGET_USD", "0")
    assert rb.OpenAIRunBudget(clock=FakeClock()).cap_usd == 0.0


# ── reserve / settle / release — the hold that stops concurrent overshoot ────


def test_reserve_holds_the_worst_case_so_a_second_caller_is_refused():
    b = rb.OpenAIRunBudget(cap_usd=0.10, clock=FakeClock())
    first = b.reserve(100_000, 0)  # holds 0.075; nothing spent yet
    assert b.spent_usd == 0.0
    assert b.held_usd == pytest.approx(0.075)
    with pytest.raises(rb.BudgetExceeded) as exc:
        b.reserve(100_000, 0)  # 0 spent + 0.075 held + 0.075 = 0.15 > 0.10
    assert "held=$0.0750" in str(exc.value)
    # precheck sees the hold too (the serialized callers share the same cap).
    with pytest.raises(rb.BudgetExceeded):
        b.precheck(100_000, 0)
    first.settle(10_000, 0)  # actual 0.0075 replaces the 0.075 hold
    assert b.held_usd == 0.0
    assert b.spent_usd == pytest.approx(0.0075)
    assert b.calls == 1
    b.reserve(100_000, 0)  # control: fits again once the hold is settled


def test_release_drops_the_hold_without_counting_a_call_and_both_are_idempotent():
    b = rb.OpenAIRunBudget(cap_usd=0.10, clock=FakeClock())
    r = b.reserve(100_000, 0)
    r.release()
    assert b.held_usd == 0.0 and b.spent_usd == 0.0 and b.calls == 0
    assert r.settle(100_000, 0) == 0.0  # already decided: a later settle books nothing
    assert b.spent_usd == 0.0 and b.calls == 0
    r2 = b.reserve(100_000, 0)
    assert r2.settle(50_000, 0) == pytest.approx(0.0375)
    r2.release()  # no-op after settle
    r2.settle(100_000, 0)
    assert b.spent_usd == pytest.approx(0.0375) and b.calls == 1 and b.held_usd == 0.0


async def test_concurrent_callers_cannot_overshoot_the_cap():
    # The exact race Gate 7 reproduced against precheck/record: three callers
    # each checking the same unspent balance across an await. With the hold
    # exactly one of three $0.075 requests fits a $0.10 cap.
    import asyncio

    b = rb.OpenAIRunBudget(cap_usd=0.10, clock=FakeClock())
    outcomes: list[str] = []

    async def caller():
        try:
            r = b.reserve(100_000, 0)
        except rb.BudgetExceeded:
            outcomes.append("refused")
            return
        await asyncio.sleep(0)  # the network round-trip
        r.settle(100_000, 0)
        outcomes.append("served")

    await asyncio.gather(caller(), caller(), caller())
    assert sorted(outcomes) == ["refused", "refused", "served"]
    assert b.spent_usd == pytest.approx(0.075)
    assert b.spent_usd <= b.cap_usd
    assert b.held_usd == 0.0


def test_bound_input_tokens_is_never_below_the_average_estimate():
    dense = [{"role": "user", "content": "0.1 0.2 0.3 " * 200}]
    cjk = [{"role": "user", "content": "电机过载跳闸" * 50}]
    photo = [{"role": "user", "content": [{"type": "text", "text": "x"}, {"type": "image_url"}]}]
    for msgs in (dense, cjk, photo, [{"role": "user", "content": "hi"}]):
        assert rb.bound_input_tokens(msgs) >= rb.estimate_input_tokens(msgs)
    # Tokens cannot exceed bytes: the bound is at least the UTF-8 length.
    assert rb.bound_input_tokens(cjk) >= len(("电机过载跳闸" * 50).encode("utf-8"))


def test_the_window_rolls_and_spend_resets():
    clock = FakeClock(0.0)
    b = rb.OpenAIRunBudget(cap_usd=0.10, window_s=100.0, clock=clock)
    b.record(100_000, 0)
    with pytest.raises(rb.BudgetExceeded):
        b.precheck(100_000, 0)
    clock.t = 99.0
    with pytest.raises(rb.BudgetExceeded):
        b.precheck(100_000, 0)  # still inside the window
    clock.t = 100.0
    b.precheck(100_000, 0)  # new window → allowed
    assert b.spent_usd == 0.0
    assert b.calls == 0


def test_estimate_input_tokens_counts_text_and_images():
    msgs = [
        {"role": "system", "content": "x" * 400},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "y" * 40},
                {"type": "image_url", "image_url": {"url": "data:"}},
            ],
        },
    ]
    assert rb.estimate_input_tokens(msgs) == 100 + 10 + 1500


def test_shared_budget_is_one_per_process_and_rebuilds_from_env_after_reset(monkeypatch):
    monkeypatch.setenv("OPENAI_RUN_BUDGET_USD", "3")
    a = rb.get_openai_run_budget()
    assert a is rb.get_openai_run_budget()
    assert a.cap_usd == 3.0
    rb.reset_openai_run_budget()
    monkeypatch.setenv("OPENAI_RUN_BUDGET_USD", "4")
    assert rb.get_openai_run_budget().cap_usd == 4.0


# ── router wiring ─────────────────────────────────────────────────────────────


def _fake_client(responses: dict[str, dict]):
    """httpx.AsyncClient stand-in: answers by URL host, records calls."""
    calls: list[str] = []

    class _Resp:
        def __init__(self, data):
            self._data = data

        def raise_for_status(self):
            return None

        def json(self):
            return self._data

    async def post(url, headers=None, json=None):
        calls.append(url)
        for host, data in responses.items():
            if host in url:
                return _Resp(data)
        raise AssertionError(f"unexpected url {url}")

    client = MagicMock()
    client.post = AsyncMock(side_effect=post)
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=client)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm, calls


def _chat_response(text: str, inp: int, out: int) -> dict:
    return {
        "choices": [{"message": {"content": text}}],
        "usage": {"prompt_tokens": inp, "completion_tokens": out},
    }


async def test_router_records_openai_usage_after_a_served_call(monkeypatch):
    monkeypatch.setenv("INFERENCE_BACKEND", "cloud")
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("GROQ_API_KEY", "k")
    assert [p.name for p in _build_providers()][:2] == ["openai", "groq"]
    cm, calls = _fake_client({"api.openai.com": _chat_response("answer", 1000, 200)})
    with patch("shared.inference.router.httpx.AsyncClient", return_value=cm):
        r = InferenceRouter()
        r.write_api_usage = MagicMock()
        content, usage = await r.complete([{"role": "user", "content": "hi"}], max_tokens=50)
    assert content == "answer"
    assert usage["provider"] == "openai"
    assert calls == ["https://api.openai.com/v1/chat/completions"]
    b = rb.get_openai_run_budget()
    assert b.calls == 1
    assert b.spent_usd == pytest.approx(b.estimate_usd(1000, 200))
    assert b.held_usd == 0.0  # the hold was replaced by the actual usage


async def test_router_books_the_worst_case_when_the_openai_call_times_out(monkeypatch):
    # A timeout after the request left may still have been billed: the hold is
    # settled at the worst case (the finally path), never freed.
    monkeypatch.setenv("INFERENCE_BACKEND", "cloud")
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("GROQ_API_KEY", "k")

    groq_cm, _ = _fake_client({"api.groq.com": _chat_response("from groq", 10, 5)})

    async def post(url, headers=None, json=None):
        if "api.openai.com" in url:
            raise httpx.ReadTimeout("slow")
        return await groq_cm.__aenter__.return_value.post(url, headers=headers, json=json)

    client = MagicMock()
    client.post = AsyncMock(side_effect=post)
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=client)
    cm.__aexit__ = AsyncMock(return_value=False)
    messages = [{"role": "user", "content": "hi"}]
    with patch("shared.inference.router.httpx.AsyncClient", return_value=cm):
        r = InferenceRouter()
        r.write_api_usage = MagicMock()
        content, usage = await r.complete(messages, max_tokens=50)
    assert content == "from groq"
    b = rb.get_openai_run_budget()
    assert b.held_usd == 0.0
    assert b.calls == 1
    assert b.spent_usd == pytest.approx(b.estimate_usd(rb.bound_input_tokens(messages), 50))


async def test_router_releases_the_hold_when_openai_rejects_the_request(monkeypatch):
    # A non-2xx answer ran nothing billable: the hold is dropped, nothing is booked.
    monkeypatch.setenv("INFERENCE_BACKEND", "cloud")
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("GROQ_API_KEY", "k")

    class _Rejected:
        def raise_for_status(self):
            req = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
            raise httpx.HTTPStatusError(
                "500", request=req, response=httpx.Response(500, request=req, text="boom")
            )

    groq_cm, _ = _fake_client({"api.groq.com": _chat_response("from groq", 10, 5)})

    async def post(url, headers=None, json=None):
        if "api.openai.com" in url:
            return _Rejected()
        return await groq_cm.__aenter__.return_value.post(url, headers=headers, json=json)

    client = MagicMock()
    client.post = AsyncMock(side_effect=post)
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=client)
    cm.__aexit__ = AsyncMock(return_value=False)
    with patch("shared.inference.router.httpx.AsyncClient", return_value=cm):
        r = InferenceRouter()
        r.write_api_usage = MagicMock()
        content, _ = await r.complete([{"role": "user", "content": "hi"}], max_tokens=50)
    assert content == "from groq"
    b = rb.get_openai_run_budget()
    assert b.held_usd == 0.0 and b.spent_usd == 0.0 and b.calls == 0


async def test_router_skips_openai_once_the_window_is_exhausted_and_falls_through(
    monkeypatch, caplog
):
    monkeypatch.setenv("INFERENCE_BACKEND", "cloud")
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setenv("OPENAI_RUN_BUDGET_USD", "0.001")  # tiny cap
    rb.get_openai_run_budget().record(2_000, 0)  # 0.0015 > cap → exhausted
    cm, calls = _fake_client({"api.groq.com": _chat_response("from groq", 10, 5)})
    with (
        patch("shared.inference.router.httpx.AsyncClient", return_value=cm),
        caplog.at_level("WARNING"),
    ):
        r = InferenceRouter()
        r.write_api_usage = MagicMock()
        content, usage = await r.complete([{"role": "user", "content": "hi"}], max_tokens=50)
    assert content == "from groq"
    assert usage["provider"] == "groq"
    # OpenAI was never called — the hard stop fired BEFORE the request.
    assert calls == ["https://api.groq.com/openai/v1/chat/completions"]
    assert any("OPENAI_BUDGET_EXHAUSTED" in rec.message for rec in caplog.records)


async def test_control_groq_is_never_budgeted(monkeypatch):
    monkeypatch.setenv("INFERENCE_BACKEND", "cloud")
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setenv("OPENAI_RUN_BUDGET_USD", "0")  # would stop OpenAI; Groq is free-tier
    cm, calls = _fake_client({"api.groq.com": _chat_response("from groq", 10, 5)})
    with patch("shared.inference.router.httpx.AsyncClient", return_value=cm):
        r = InferenceRouter()
        r.write_api_usage = MagicMock()
        content, _ = await r.complete([{"role": "user", "content": "hi"}], max_tokens=50)
    assert content == "from groq"
    assert rb.get_openai_run_budget().calls == 0


# ── Codex r1 on #4355: every metered attempt holds; unknown usage is not free ──

MSGS = [{"role": "user", "content": "hi"}]
OPENAI_MODEL = "gpt-5.4-mini"


def _served(content: str, usage: dict | None) -> dict:
    data: dict = {"choices": [{"message": {"content": content}}]}
    if usage is not None:
        data["usage"] = usage
    return data


def _scripted_client(script: list):
    """httpx.AsyncClient stand-in. Each OpenAI post consumes the next scripted
    step — a dict (a 200 JSON body), an int (that HTTP status), or an exception
    (raised). Groq always answers. Records (host, completion cap) per post."""
    sent: list[tuple[str, object]] = []

    class _Resp:
        def __init__(self, url: str, data: dict, status: int = 200):
            self._url, self._data, self._status = url, data, status

        def raise_for_status(self):
            if self._status >= 400:
                req = httpx.Request("POST", self._url)
                raise httpx.HTTPStatusError(
                    str(self._status),
                    request=req,
                    response=httpx.Response(
                        self._status, request=req, text="x", headers={"retry-after": "0"}
                    ),
                )

        def json(self):
            return self._data

    async def post(url, headers=None, json=None):
        body = json or {}
        cap = body.get("max_completion_tokens", body.get("max_tokens"))
        host = "openai" if "api.openai.com" in url else "groq"
        sent.append((host, cap))
        if host == "openai":
            step = script.pop(0)
            if isinstance(step, BaseException):
                raise step
            if isinstance(step, int):
                return _Resp(url, {}, status=step)
            return _Resp(url, step)
        return _Resp(url, _chat_response("from groq", 10, 5))

    client = MagicMock()
    client.post = AsyncMock(side_effect=post)
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=client)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm, sent


def _cloud(monkeypatch, cap: str | None = None):
    monkeypatch.setenv("INFERENCE_BACKEND", "cloud")
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setenv("LLM_REASONING_RETRY_MAX_TOKENS", "8192")
    if cap is not None:
        monkeypatch.setenv("OPENAI_RUN_BUDGET_USD", cap)


async def _complete(cm, max_tokens: int):
    with patch("shared.inference.router.httpx.AsyncClient", return_value=cm):
        r = InferenceRouter()
        r.write_api_usage = MagicMock()
        return await r.complete(MSGS, max_tokens=max_tokens)


def _openai_caps(sent) -> list:
    return [cap for host, cap in sent if host == "openai"]


async def test_reasoning_burn_retry_is_never_sent_when_it_no_longer_fits_the_cap(
    monkeypatch, caplog
):
    # First attempt fits (200-token cap); it burns its whole allowance with no
    # visible content, so the router wants an 8192-token retry worth ~USD 0.037
    # against a USD 0.005 cap. That retry must not leave the building.
    _cloud(monkeypatch, cap="0.005")
    cm, sent = _scripted_client([_served("", {"prompt_tokens": 10, "completion_tokens": 200})])
    with caplog.at_level("WARNING"):
        content, usage = await _complete(cm, max_tokens=200)
    assert _openai_caps(sent) == [200]
    assert content == "from groq"
    b = rb.get_openai_run_budget()
    assert b.spent_usd <= b.cap_usd
    assert b.held_usd == 0.0
    assert any("not sending the retry" in rec.message for rec in caplog.records)


async def test_control_reasoning_burn_retry_is_sent_and_booked_when_it_fits(monkeypatch):
    _cloud(monkeypatch)  # default USD 10 cap
    cm, sent = _scripted_client(
        [
            _served("", {"prompt_tokens": 10, "completion_tokens": 200}),
            _served("answer", {"prompt_tokens": 10, "completion_tokens": 300}),
        ]
    )
    content, _ = await _complete(cm, max_tokens=200)
    assert _openai_caps(sent) == [200, 8192]
    assert content == "answer"
    b = rb.get_openai_run_budget()
    assert b.calls == 2
    assert b.spent_usd == pytest.approx(b.estimate_usd(10, 200) + b.estimate_usd(10, 300))
    assert b.held_usd == 0.0


async def test_a_served_response_with_no_usage_books_the_bound_and_the_cap(monkeypatch):
    _cloud(monkeypatch)
    cm, _ = _scripted_client([_served("answer", None)])
    content, _ = await _complete(cm, max_tokens=50)
    assert content == "answer"
    b = rb.get_openai_run_budget()
    assert b.spent_usd == pytest.approx(
        b.estimate_usd(rb.bound_input_tokens(MSGS, model=OPENAI_MODEL), 50)
    )
    assert b.spent_usd > 0


async def test_a_missing_completion_count_books_the_cap_and_keeps_the_known_input(monkeypatch):
    _cloud(monkeypatch)
    cm, _ = _scripted_client([_served("answer", {"prompt_tokens": 7})])
    await _complete(cm, max_tokens=50)
    b = rb.get_openai_run_budget()
    assert b.spent_usd == pytest.approx(b.estimate_usd(7, 50))


async def test_usage_less_responses_exhaust_the_cap_instead_of_running_free(monkeypatch):
    # Room for two worst cases, not three: the third OpenAI call must be refused.
    worst = rb.OpenAIRunBudget(clock=FakeClock()).estimate_usd(
        rb.bound_input_tokens(MSGS, model=OPENAI_MODEL), 50
    )
    _cloud(monkeypatch, cap=repr(worst * 2.5))
    cm, sent = _scripted_client([_served("a", None), _served("b", None), _served("c", None)])
    replies = [(await _complete(cm, max_tokens=50))[0] for _ in range(3)]
    assert replies == ["a", "b", "from groq"]
    assert len(_openai_caps(sent)) == 2


async def test_rate_limit_retry_reserves_after_the_wait_and_is_not_sent_once_the_balance_is_gone(
    monkeypatch,
):
    # The 429 releases the first hold (nothing billable ran). While the router
    # waits, another caller spends the balance; the retry must re-check and stay home.
    _cloud(monkeypatch, cap="0.01")
    cm, sent = _scripted_client(
        [429, _served("answer", {"prompt_tokens": 10, "completion_tokens": 5})]
    )

    async def other_caller_spends(_seconds):
        rb.get_openai_run_budget().record(13_000, 0)  # ~USD 0.00975 of the USD 0.01

    with patch("shared.inference.router.asyncio.sleep", other_caller_spends):
        content, _ = await _complete(cm, max_tokens=50)
    assert _openai_caps(sent) == [50]
    assert content == "from groq"
    assert rb.get_openai_run_budget().held_usd == 0.0


async def test_control_rate_limit_retry_is_sent_and_booked_when_it_fits(monkeypatch):
    _cloud(monkeypatch)
    cm, sent = _scripted_client(
        [429, _served("answer", {"prompt_tokens": 10, "completion_tokens": 5})]
    )

    async def no_wait(_seconds):
        return None

    with patch("shared.inference.router.asyncio.sleep", no_wait):
        content, _ = await _complete(cm, max_tokens=50)
    assert _openai_caps(sent) == [50, 50]
    assert content == "answer"
    b = rb.get_openai_run_budget()
    assert b.calls == 1  # the 429 booked nothing; only the served retry did
    assert b.spent_usd == pytest.approx(b.estimate_usd(10, 5))


async def test_a_rate_limit_retry_that_times_out_books_its_own_worst_case(monkeypatch):
    _cloud(monkeypatch)
    cm, sent = _scripted_client([429, httpx.ReadTimeout("slow")])

    async def no_wait(_seconds):
        return None

    with patch("shared.inference.router.asyncio.sleep", no_wait):
        content, _ = await _complete(cm, max_tokens=50)
    assert _openai_caps(sent) == [50, 50]
    assert content == "from groq"
    b = rb.get_openai_run_budget()
    assert b.held_usd == 0.0
    assert b.calls == 1
    assert b.spent_usd == pytest.approx(
        b.estimate_usd(rb.bound_input_tokens(MSGS, model=OPENAI_MODEL), 50)
    )


def test_images_are_bounded_by_the_model_table_not_by_their_base64_bytes():
    photo = "data:image/jpeg;base64," + "A" * 400_000
    with_image = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "read this nameplate"},
                {"type": "image_url", "image_url": {"url": photo}},
            ],
        }
    ]
    text_only = [{"role": "user", "content": [{"type": "text", "text": "read this nameplate"}]}]
    base = rb.bound_input_tokens(text_only)
    assert rb.bound_input_tokens(with_image, model="gpt-5.4-mini") == base + 3_000
    # A model not in the table fails closed to the large ceiling.
    assert rb.bound_input_tokens(with_image, model="some-new-vision-model") == base + 20_000
    assert rb.bound_input_tokens(with_image, model=None) == base + 20_000
    # The 400 KB data URL is not counted as text.
    assert rb.bound_input_tokens(with_image, model="gpt-5.4-mini") < 10_000


def test_billable_tokens_treats_missing_and_malformed_counts_as_unknown_not_zero():
    assert rb.billable_tokens({"prompt_tokens": 3, "completion_tokens": 4}, 100, 50) == (3, 4)
    assert rb.billable_tokens({"prompt_tokens": 0, "completion_tokens": 0}, 100, 50) == (0, 0)
    assert rb.billable_tokens({}, 100, 50) == (100, 50)
    assert rb.billable_tokens(None, 100, 50) == (100, 50)
    bad = {"prompt_tokens": None, "completion_tokens": "12"}
    assert rb.billable_tokens(bad, 100, 50) == (100, 50)
    assert rb.billable_tokens({"prompt_tokens": -1, "completion_tokens": True}, 100, 50) == (
        100,
        50,
    )
