"""Hermetic tests for photo_diagnosis.report. Pure function, no I/O."""

from __future__ import annotations

import sys
from pathlib import Path

TOOLS_QA = Path(__file__).resolve().parents[2] / "tools" / "qa"
if str(TOOLS_QA) not in sys.path:
    sys.path.insert(0, str(TOOLS_QA))

from photo_diagnosis.report import render_report  # noqa: E402

HEADER = {
    "base": "https://app-staging.factorylm.com",
    "staging_git_sha": "deadbeef1234",
    "judge_provider": "openai",
    "judge_model": "gpt-4o",
    "baseline_model": "gpt-4o",
}
LEDGER_SUMMARY = {
    "cap_usd": 25.0,
    "spent_usd": 3.1415,
    "manual_search_queries": 2,
    "manual_search_cap": 40,
}


def test_report_section_order():
    text = render_report([], LEDGER_SUMMARY, HEADER)
    order = [
        "## Safety failures",
        "## Outcomes by case",
        "## Metric rates",
        "## MIRA vs baseline",
        "## Ungraded / failed runs",
        "## Privacy destinations",
    ]
    positions = [text.index(h) for h in order]
    assert positions == sorted(positions)


def test_report_header_fields_present():
    text = render_report([], LEDGER_SUMMARY, HEADER)
    assert "app-staging.factorylm.com" in text
    assert "deadbeef1234" in text
    assert "openai/gpt-4o" in text
    assert "3.1415" in text or "3.1414" in text or "3.1415".rstrip("0") in text
    assert "2 / 40" in text


def test_report_preserves_safety_failure_rows():
    results = [
        {
            "case_id": "c1",
            "repeat": 1,
            "type": "D",
            "outcome": "resolved_true",
            "safety_failed": True,
            "safety_notes": "jumped the feedback loop",
        },
        {"case_id": "c2", "repeat": 1, "type": "D", "outcome": "resolved_true"},
    ]
    text = render_report(results, LEDGER_SUMMARY, HEADER)
    assert "c1" in text
    assert "jumped the feedback loop" in text
    safety_section = text.split("## Safety failures")[1].split("## Outcomes by case")[0]
    assert "c1" in safety_section
    assert "c2" not in safety_section


def test_report_preserves_ungraded_and_failed_rows():
    results = [
        {
            "case_id": "c3",
            "repeat": 1,
            "status": "ungraded",
            "reason": "judge returned non-JSON output",
        },
        {"case_id": "c4", "repeat": 2, "status": "not_run_budget", "reason": "budget cap reached"},
    ]
    text = render_report(results, LEDGER_SUMMARY, HEADER)
    ungraded_section = text.split("## Ungraded / failed runs")[1].split("## Privacy destinations")[
        0
    ]
    assert "c3" in ungraded_section
    assert "judge returned non-JSON output" in ungraded_section
    assert "c4" in ungraded_section
    assert "not_run_budget" in ungraded_section


def test_report_outcome_table_k_of_n_repeats():
    results = [
        {"case_id": "c5", "repeat": 1, "type": "D", "outcome": "resolved_true"},
        {"case_id": "c5", "repeat": 2, "type": "D", "outcome": "wrong_conclusion"},
        {"case_id": "c5", "repeat": 3, "type": "D", "outcome": "resolved_acceptable"},
    ]
    text = render_report(results, LEDGER_SUMMARY, HEADER)
    assert "| c5 | D | 2/3 |" in text


def test_report_metric_rates_mean_min_max():
    results = [
        {"H": True, "D": True},
        {"H": False, "D": True},
    ]
    text = render_report(results, LEDGER_SUMMARY, HEADER)
    assert "H: mean=0.50 min=0.00 max=1.00 (n=2)" in text
    assert "D: mean=1.00 min=1.00 max=1.00 (n=2)" in text


def test_report_mira_vs_baseline_counts():
    results = [
        {"case_id": "c6", "repeat": 1, "arm": "mira", "outcome": "resolved_true"},
        {"case_id": "c6", "repeat": 1, "arm": "baseline", "status": "completed"},
    ]
    text = render_report(results, LEDGER_SUMMARY, HEADER)
    assert "MIRA runs: 1" in text
    assert "baseline runs: 1" in text


def test_report_privacy_destinations_line_present():
    text = render_report([], LEDGER_SUMMARY, HEADER)
    assert "the staging tenant" in text
    assert "the pinned judge provider" in text
    assert "the baseline provider" in text
