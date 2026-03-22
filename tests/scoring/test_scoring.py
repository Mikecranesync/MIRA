"""Unit tests for the scoring framework — deterministic, no network."""

import pytest

from tests.scoring.contains_check import (
    check_fault_cause,
    check_next_step,
    keyword_match_score,
    score_case,
)
from tests.scoring.composite import (
    CaseResult,
    RunResult,
    aggregate_run,
    build_case_result,
    compute_composite,
    evaluate_pass,
)
from tests.scoring.thresholds import (
    DEFAULT_THRESHOLD,
    FAST_THRESHOLD,
    compute_verdict,
    get_threshold,
)


# ── keyword_match_score ─────────────────────────────────────────────────────

class TestKeywordMatchScore:
    def test_all_keywords_present(self):
        score, matched, violated = keyword_match_score(
            "Allen-Bradley Micro820 PLC controller",
            ["Allen-Bradley", "Micro820", "PLC"],
        )
        assert score == 1.0
        assert len(matched) == 3
        assert violated == []

    def test_partial_match(self):
        score, matched, violated = keyword_match_score(
            "Allen-Bradley device",
            ["Allen-Bradley", "Micro820", "PLC"],
        )
        assert abs(score - 1 / 3) < 0.01
        assert matched == ["Allen-Bradley"]

    def test_no_match(self):
        score, matched, violated = keyword_match_score(
            "some random text",
            ["Allen-Bradley", "Micro820"],
        )
        assert score == 0.0
        assert matched == []

    def test_empty_must_contain(self):
        score, _, _ = keyword_match_score("any reply", [])
        assert score == 1.0

    def test_hallucination_detection(self):
        score, _, violated = keyword_match_score(
            "This is a Siemens PLC",
            ["Allen-Bradley"],
            must_not_contain=["Siemens"],
        )
        assert violated == ["Siemens"]

    def test_case_insensitive(self):
        score, matched, _ = keyword_match_score(
            "allen-bradley micro820",
            ["Allen-Bradley", "Micro820"],
        )
        assert score == 1.0

    def test_empty_reply(self):
        score, matched, violated = keyword_match_score("", ["test"])
        assert score == 0.0


# ── check_fault_cause / check_next_step ─────────────────────────────────────

class TestPatternChecks:
    def test_fault_cause_builtin(self):
        found, matched = check_fault_cause("Motor overheated due to bearing failure")
        assert found is True
        assert "overheated" in matched or "due to" in matched

    def test_fault_cause_extra_keywords(self):
        found, matched = check_fault_cause(
            "The F004 code appeared", extra_keywords=["F004"]
        )
        assert found is True

    def test_fault_cause_none(self):
        found, _ = check_fault_cause("Hello, how are you?")
        assert found is False

    def test_next_step_builtin(self):
        found, matched = check_next_step("Check the motor terminals and replace the fuse")
        assert found is True
        assert "check" in matched or "replace" in matched

    def test_next_step_none(self):
        found, _ = check_next_step("The sky is blue")
        assert found is False

    def test_empty_reply(self):
        found, _ = check_fault_cause("")
        assert found is False
        found, _ = check_next_step("")
        assert found is False


# ── score_case ──────────────────────────────────────────────────────────────

class TestScoreCase:
    def test_passing_case(self):
        case = {
            "name": "test_pass",
            "must_contain": ["Allen-Bradley", "Micro820"],
            "must_not_contain": ["Siemens"],
            "fault_cause_keywords": [],
            "next_step_keywords": [],
            "max_words": 150,
        }
        reply = "This is an Allen-Bradley Micro820 PLC. Overheated due to loose connection. Check the terminals."
        result = score_case(case, reply)
        assert result["passed"] is True
        assert result["contains_score"] == 1.0
        assert result["failure_bucket"] is None

    def test_transport_failure(self):
        case = {"name": "test_transport"}
        result = score_case(case, None)
        assert result["passed"] is False
        assert result["failure_bucket"] == "TRANSPORT_FAILURE"
        assert result["contains_score"] == 0.0

    def test_hallucination_fails(self):
        case = {
            "name": "test_hallucination",
            "must_contain": ["Allen-Bradley"],
            "must_not_contain": ["Siemens"],
        }
        reply = "This Siemens Allen-Bradley device is overheated. Check terminals."
        result = score_case(case, reply)
        assert result["passed"] is False
        assert result["failure_bucket"] == "HALLUCINATION"

    def test_too_verbose(self):
        case = {"name": "test_verbose", "must_contain": [], "max_words": 10}
        reply = "This is a long response " * 20 + " check the motor bearing failure."
        result = score_case(case, reply)
        assert result["conditions"]["READABILITY"] is False

    def test_adversarial_partial(self):
        case = {
            "name": "test_adversarial",
            "must_contain": ["Allen-Bradley"],
            "adversarial": True,
        }
        reply = "Allen-Bradley device. Overheated due to bad bearing. Check terminals."
        result = score_case(case, reply)
        assert result["passed"] is True
        assert result["failure_bucket"] == "ADVERSARIAL_PARTIAL"


# ── composite scoring ───────────────────────────────────────────────────────

class TestComposite:
    def test_fast_mode(self):
        score = compute_composite(0.8, 4.0, fast=True)
        assert score == 0.8  # LLM score ignored

    def test_full_mode(self):
        score = compute_composite(0.8, 5.0)
        # 0.8 * 0.40 + (5.0/5.0) * 0.60 = 0.32 + 0.60 = 0.92
        assert abs(score - 0.92) < 0.01

    def test_zero_llm_falls_back(self):
        score = compute_composite(0.7, 0.0)
        assert score == 0.7  # Treated as fast mode

    def test_pass_evaluation(self):
        assert evaluate_pass(0.85, "regime1_telethon") is True
        assert evaluate_pass(0.75, "regime1_telethon") is False

    def test_fast_threshold(self):
        assert evaluate_pass(0.75, "regime1_telethon", fast=True) is True
        assert evaluate_pass(0.65, "regime1_telethon", fast=True) is False

    def test_threshold_override(self):
        assert evaluate_pass(0.5, "regime1_telethon", threshold_override=0.4) is True


class TestBuildCaseResult:
    def test_basic(self):
        result = build_case_result(
            case_id="test-001",
            regime="regime1_telethon",
            contains_score=0.9,
            llm_judge_score=4.5,
        )
        assert result.passed is True
        assert result.composite_score > 0

    def test_hallucination_override(self):
        result = build_case_result(
            case_id="test-002",
            regime="regime1_telethon",
            contains_score=1.0,
            llm_judge_score=5.0,
            failure_bucket="HALLUCINATION",
        )
        assert result.passed is False


class TestAggregateRun:
    def test_aggregate(self):
        results = [
            CaseResult(case_id="1", regime="r1", passed=True, composite_score=0.9, latency_ms=100),
            CaseResult(case_id="2", regime="r1", passed=True, composite_score=0.85, latency_ms=200),
            CaseResult(case_id="3", regime="r1", passed=False, composite_score=0.5, latency_ms=150, failure_bucket="OCR_FAILURE"),
        ]
        run = aggregate_run("run-1", "2026-03-22T12:00:00Z", "r1", results)
        assert run.total_cases == 3
        assert run.passed_cases == 2
        assert abs(run.pass_rate - 2 / 3) < 0.01
        assert run.avg_latency_ms == 150.0


# ── thresholds ──────────────────────────────────────────────────────────────

class TestThresholds:
    def test_defaults(self):
        assert DEFAULT_THRESHOLD == 0.80
        assert FAST_THRESHOLD == 0.70

    def test_regime_specific(self):
        assert get_threshold("regime3_nameplate") == 0.90

    def test_unknown_regime(self):
        assert get_threshold("unknown") == DEFAULT_THRESHOLD

    def test_verdict(self):
        assert compute_verdict(9.0) == "excellent"
        assert compute_verdict(7.5) == "good"
        assert compute_verdict(6.0) == "acceptable"
        assert compute_verdict(4.0) == "poor"
        assert compute_verdict(1.0) == "failed"
