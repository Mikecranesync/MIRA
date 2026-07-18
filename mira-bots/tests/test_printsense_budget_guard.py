"""ZTA spend-law guards (v3.156.0): paid-lane cost meter + dollar budget.

Hermetic — no network, no SDKs. Fake rungs simulate the paid interpreter
recording usage; the meter math and hard-stop behavior are exercised through
the REAL testkit lanes (run_phase2 / run_phase3 / run_phase4)."""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")
os.environ.setdefault("VISION_MODEL", "qwen2.5vl:7b")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_test.db")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))

import pytest  # noqa: E402

pytest.importorskip("PIL")
pytest.importorskip("pydantic")

import printsense_testkit as tk  # noqa: E402

from printsense import interpret  # noqa: E402
from printsense.benchmarks import robustness_grader as rg  # noqa: E402
from printsense.benchmarks import session_cases as sc  # noqa: E402
from printsense.benchmarks import single_photo_cases as spc  # noqa: E402
from printsense.benchmarks import single_photo_grader as spg  # noqa: E402


class _FakeUsage:
    def __init__(self, tin, tout):
        self.input_tokens = tin
        self.output_tokens = tout


def _ctx():
    context = MagicMock()
    context.bot.send_document = AsyncMock()
    return context


# ── the budget knob ──────────────────────────────────────────────────────────


def test_bench_budget_env_override(monkeypatch):
    monkeypatch.delenv("PRINT_BENCH_BUDGET_USD", raising=False)
    assert tk.bench_budget_usd() == tk.BENCH_BUDGET_DEFAULT_USD
    monkeypatch.setenv("PRINT_BENCH_BUDGET_USD", "0.25")
    assert tk.bench_budget_usd() == 0.25
    monkeypatch.setenv("PRINT_BENCH_BUDGET_USD", "")  # compose ${VAR:-} shape
    assert tk.bench_budget_usd() == tk.BENCH_BUDGET_DEFAULT_USD
    monkeypatch.setenv("PRINT_BENCH_BUDGET_USD", "not-a-number")
    assert tk.bench_budget_usd() == tk.BENCH_BUDGET_DEFAULT_USD


def test_openai_cost_row_math():
    usage = {"provider": "openai", "input_tokens": 1_000_000, "output_tokens": 1_000_000}
    assert spg.estimate_cost_usd(usage) == 35.0  # $5/M in + $30/M out
    usage = {"provider": "openai", "input_tokens": 6_000, "output_tokens": 4_000}
    assert spg.estimate_cost_usd(usage) == round((6_000 * 5 + 4_000 * 30) / 1e6, 6)


# ── phase 2 ──────────────────────────────────────────────────────────────────


async def test_phase2_budget_zero_stops_before_any_call(monkeypatch):
    monkeypatch.setenv("PRINT_BENCH_BUDGET_USD", "0")
    calls: list[int] = []

    async def rung(*args, **kwargs):
        calls.append(1)
        return True

    env = await tk.run_phase2(rung, _ctx(), 999, mode="hermetic", cases=spc.CASES[:2])
    assert not calls  # the paid rung never ran
    assert [r["status"] for r in env["results"]] == ["budget_stop", "budget_stop"]
    assert env["budget"]["budget_stopped"] is True
    assert env["budget"]["spent_usd"] == 0.0


async def test_phase2_meter_prefers_interpreter_usage_and_stops(monkeypatch):
    monkeypatch.delenv("PRINT_BENCH_BUDGET_USD", raising=False)

    async def rung(png, raw, question, capture, context):
        # Simulate the paid interpreter (which bypasses the router spy).
        interpret._record_usage("openai", "gpt-5.5", _FakeUsage(1_000_000, 100_000))
        await capture.message.reply_text("scripted answer")
        return True

    env = await tk.run_phase2(rung, _ctx(), 999, mode="hermetic", cases=spc.CASES[:2])
    first, second = env["results"]
    assert first["provider"] == "openai"
    assert first["estimated_cost_usd"] == 8.0  # 1M in ($5) + 100k out ($3)
    assert second["status"] == "budget_stop"  # 8.0 >= the 1.50 default budget
    assert env["budget"]["budget_stopped"] is True
    assert env["budget"]["spent_usd"] == 8.0


def test_phone_summary_shows_budget_line():
    env = spg.build_envelope([], mode="hermetic")
    assert "budget:" not in spg.phone_summary(env)
    env["budget"] = {"budget_usd": 1.5, "spent_usd": 0.37, "budget_stopped": False}
    assert "budget: $0.37 spent of $1.50" in spg.phone_summary(env)
    env["budget"]["budget_stopped"] = True
    assert "BUDGET STOP" in spg.phone_summary(env)


# ── phase 3 ──────────────────────────────────────────────────────────────────


async def test_phase3_budget_zero_stops_before_first_turn(monkeypatch):
    monkeypatch.setenv("PRINT_BENCH_BUDGET_USD", "0")
    album = AsyncMock()
    env = await tk.run_phase3(album, mode="hermetic", sessions=sc.SESSIONS[:1])
    album.assert_not_awaited()  # no paid package call happened
    assert env["budget"]["budget_stopped"] is True
    # only the durability probe (queue-level, $0) contributes results
    assert [s["session_id"] for s in env["sessions"]] == ["s7_durability"]


# ── phase 4 ──────────────────────────────────────────────────────────────────


async def test_phase4_budget_zero_skips_paid_lane(monkeypatch):
    monkeypatch.setenv("PRINT_BENCH_BUDGET_USD", "0")

    async def vision(photo_b64, question):
        return {"classification": "ELECTRICAL_PRINT"}

    boom = AsyncMock(side_effect=AssertionError("paid rung must not run"))
    condition = next(iter(rg.CONDITIONS))
    env = await tk.run_phase4(
        vision_process=vision,
        single_rung=boom,
        context=_ctx(),
        mode="hermetic",
        answer_conditions=(condition,),
    )
    boom.assert_not_awaited()
    row = next(r for r in env["rows"] if r["condition"] == condition)
    assert row.get("budget_stopped") is True
    assert row.get("routed") is True  # the free Lane R still ran
    assert env["budget"]["budget_stopped"] is True
