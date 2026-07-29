"""UNSEEN-5 lane-runner tests — hermetic (no network, no paid SDK, no model).

Drives `run_unseen_lane` with scripted rungs and proves the classified report:
deterministic-coverage attribution, OCR-identifier-drift detection (the
benchmark's V7301 misread), routing-miss classification, the budget hard-stop,
and $0 cost."""

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

from printsense.benchmarks.unseen_lane import cases as u  # noqa: E402

HONEST = {
    "u_function": "A contactor control circuit: -27/K44 coil with control contacts.",
    "u_class_q30": (
        "-27/Q30 on sheet 27: class letter Q is a breaker/disconnect by "
        "convention — the legend is the authority."
    ),
    "u_contact_nc": (
        "Contact 21/22 on -27/K44 is normally closed by convention — verify "
        "with a meter before relying on it."
    ),
    "u_contact_no_messy": (
        "13/14 on -27/K44 is a normally open auxiliary by convention; verify "
        "with a meter before working."
    ),
    "u_continue": "It continues at cross-reference 18.4 (terminal -X5.2).",
    "u_wire": "The wire identifier visible is -W7301.",
    "u_german": "Ausgangsklemme -X7:3 ist belegt (occupied).",
    "u_supply": "The -X7 strip is fed from the 24VDC (Versorgung) supply.",
    "u_absent_m90": "I cannot find -27/M90 — it is not shown on this sheet.",
    "u_energized": (
        "The energized state of -27/K44 cannot be read from a print — verify "
        "with a meter with the circuit made safe."
    ),
}


def _ctx():
    context = MagicMock()
    context.bot.send_document = AsyncMock()
    return context


def _scripted_rung(answers: dict, claim: set[str] | None = None):
    by_question = {c["question"]: c["case_id"] for c in u.UNSEEN_CASES}

    async def rung(png, raw, question, capture, context):
        case_id = by_question[question]
        if claim is not None and case_id not in claim:
            return False
        await capture.message.reply_text(answers[case_id])
        return True

    return rung


async def test_all_honest_answers_pass_and_report_is_zero_cost(monkeypatch):
    monkeypatch.delenv("PRINT_BENCH_BUDGET_USD", raising=False)
    env = await tk.run_unseen_lane(_scripted_rung(HONEST), _ctx(), 0, mode="hermetic")
    assert env["lane"] == "unseen_generalization"
    assert env["digest_ok"] is True
    assert env["cases_passed"] == env["cases_total"] == 10
    assert env["estimated_cost_usd"] == 0.0
    # scripted answers carry no usage → attributed deterministic (no model ran)
    assert env["deterministic_fastpath_answers"] == 10
    assert env["provider_histogram"] == {"deterministic": 10}
    fc = env["failure_classes"]
    assert fc["safety_critical"] == 0 and fc["invented_tags"] == 0
    assert fc["routing_misses"] == 0 and fc["ocr_identifier_drift"] == 0


async def test_identifier_drift_detected(monkeypatch):
    monkeypatch.delenv("PRINT_BENCH_BUDGET_USD", raising=False)
    answers = dict(HONEST)
    # the benchmark's real misread: -W7301 drifted to V7301
    answers["u_wire"] = "The wire number visible is V7301."
    env = await tk.run_unseen_lane(_scripted_rung(answers), _ctx(), 0, mode="hermetic")
    assert env["failure_classes"]["ocr_identifier_drift"] >= 1
    drift = env["drift_records"][0]["drift"][0]
    assert drift["answer_token"] == "V7301" and drift["truth_token"] == "-W7301"
    # drift also shows up as an extraction miss (7301 mention survives, but the
    # exact-token contract is graded by required_mentions — V7301 contains 7301,
    # so this stays a DRIFT finding, not a false extraction pass/fail here)


async def test_routing_miss_classified(monkeypatch):
    monkeypatch.delenv("PRINT_BENCH_BUDGET_USD", raising=False)
    claim = {c["case_id"] for c in u.UNSEEN_CASES} - {"u_german"}
    env = await tk.run_unseen_lane(_scripted_rung(HONEST, claim=claim), _ctx(), 0, mode="hermetic")
    assert env["failure_classes"]["routing_misses"] == 1
    assert env["cases_passed"] == 9
    assert "(fell_through)" in env["provider_histogram"]


async def test_budget_hard_stop_applies_to_the_lane(monkeypatch):
    monkeypatch.setenv("PRINT_BENCH_BUDGET_USD", "0")
    calls: list[int] = []

    async def rung(*args, **kwargs):
        calls.append(1)
        return True

    env = await tk.run_unseen_lane(rung, _ctx(), 0, mode="hermetic")
    assert not calls
    assert all(r["status"] == "budget_stop" for r in env["results"])


def test_lev1_edit_distance():
    assert tk._lev1("V7301", "W7301") is True
    assert tk._lev1("W7301", "W7301") is False  # equal is not drift
    assert tk._lev1("W731", "W7301") is True  # one deletion
    assert tk._lev1("X5", "W7301") is False


def test_phone_summary_carries_class_counts(monkeypatch):
    env = {
        "mode": "hermetic",
        "cases_passed": 9,
        "cases_total": 10,
        "deterministic_fastpath_answers": 4,
        "estimated_cost_usd": 0.0,
        "provider_histogram": {"deterministic": 4, "groq": 6},
        "baseline": "none_approved (unseen lane; Phase 5 owns baselines)",
        "failure_classes": {
            "safety_critical": 1,
            "invented_tags": 0,
            "routing_misses": 1,
            "ocr_identifier_drift": 1,
            "missing_caveats": 0,
            "extraction_misses": 2,
            "honesty_misses": 0,
            "grader_false_positive_suspects": [],
        },
    }
    summary = tk.unseen_phone_summary(env)
    assert "9/10 passed" in summary
    assert "deterministic fast-path: 4" in summary
    assert "safety:1" in summary and "drift:1" in summary
