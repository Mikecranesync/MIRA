"""Hermetic proofs for the autoeval report, alerts and Mission Control block. No network.

Alerts fire on a transition: a key is announced when it becomes active, and an unchanged
second run announces nothing. Each "fires" assertion has a "does not fire" control.
"""

from __future__ import annotations

import copy
import json
import os
import sys
from pathlib import Path

import pytest

REPO = Path(os.environ.get("AUTOEVAL_REPO") or Path(__file__).resolve().parents[2])
SCRIPTS = Path(os.environ.get("AUTOEVAL_SCRIPTS") or REPO / "evals" / "scripts")
sys.path.insert(0, str(SCRIPTS))

import autoeval_report as rp  # noqa: E402

FIXTURE = REPO / "evals" / "results" / "f06922ac6-cov100"
SHA = "f" * 40


def make_run(
    *,
    run_id="r1",
    tested=SHA,
    dangerous=(),
    unscored=(),
    lane="pass",
    paid_required=0,
    crossings=(),
    runner_error=None,
    skipped=False,
):
    lanes = {"skipped": skipped, "results": []}
    if not skipped:
        lanes["results"] = [
            {
                "name": "safety",
                "status": lane,
                "reason": "always",
                "steps": [
                    {"runner": "pytest", "cwd": ".", "counts": {"passed": 3}, "status": lane}
                ],
            },
            {"name": "citation", "status": "pass", "reason": "trigger", "steps": []},
        ]
    counts = {"api": 0, "recall_hit": 40 - paid_required, "paid_required": paid_required}
    model = {
        "summary": {"technician_score": 47.7, "technician_gate": "FAIL"},
        "dangerous": list(dangerous),
        "unscored": list(unscored),
        "counts": counts,
        "gate": "TECHNICIAN GATE\nTechnician score: 47.7/100",
    }
    return {
        "run_id": run_id,
        "created_at": "2026-11-15T12:00:00Z",
        "mode": "dry",
        "tested_sha": tested,
        "runner_sha": "a" * 40,
        "models": ["claude-sonnet-4-6"],
        "lanes": lanes,
        "sets": [{"set": "f06922ac6-cov100", "models": {"claude-sonnet-4-6": model}}],
        "spend": {
            "today_usd": 0.0,
            "total_usd": 0.0,
            "daily_cap_usd": 1.0,
            "total_cap_usd": 5.0,
            "remaining_usd": 5.0,
            "paid_required_worst_usd": 0.1,
            "paid_calls": 0,
            "avg_usd_per_paid_call": None,
            "monthly_estimate_usd": None,
            "total_settled_usd": 0.0,
        },
        "calls": {"api": 0, "recall": 40 - paid_required, "paid_required": paid_required},
        "crossings": list(crossings),
        "runner_error": runner_error,
    }


def test_report_body_is_byte_identical_for_unchanged_inputs_with_different_ids_and_clock():
    a = make_run(run_id="run-A")
    b = copy.deepcopy(a)
    b["run_id"], b["created_at"] = "run-B", "2030-01-01T00:00:00Z"
    assert rp.render_report(a) == rp.render_report(b)


def test_control_a_changed_tested_sha_changes_the_body():
    a = make_run()
    b = make_run(tested="e" * 40)
    assert rp.render_report(a) != rp.render_report(b)


def test_report_states_mode_and_names_dry_run_limits():
    text = rp.render_report(make_run())
    assert "Mode: DRY" in text and "no paid call can be made" in text


def test_report_lists_spend_and_the_monthly_assumption():
    text = rp.render_report(make_run())
    assert "Monthly estimate: n/a" in text and "assumes this run repeats daily" in text


def test_report_blockers_name_a_failing_lane_and_control_is_none_when_clean():
    assert "- lane safety: fail" in rp.render_report(make_run(lane="fail"))
    assert "- none" in rp.render_report(make_run())


def test_gate_text_is_stable_and_has_no_wall_clock_footer():
    summary = json.loads((FIXTURE / "scores" / "_summary.json").read_text())
    first = rp.gate_text(FIXTURE, summary)
    second = rp.gate_text(FIXTURE, summary)
    assert first == second
    assert "(generated " not in first
    assert "Technician score:" in first


def test_a_delivery_marker_in_generated_text_is_refused():
    run = make_run()
    run["sets"][0]["models"]["claude-sonnet-4-6"]["gate"] = "x [DELIVERY-UPDATE: y"
    with pytest.raises(ValueError):
        rp.render_report(run)


def test_control_clean_gate_text_is_accepted():
    assert "Autoeval report" in rp.render_report(make_run())


def test_newly_dangerous_safety_case_fires_once_then_not_on_an_unchanged_run():
    fired1, st = rp.alerts(make_run(run_id="1", dangerous=["safety-03"]), {})
    keys = [a["key"] for a in fired1]
    assert "safety_regression:case:f06922ac6-cov100:claude-sonnet-4-6:safety-03" in keys
    fired2, _ = rp.alerts(make_run(run_id="2", dangerous=["safety-03"]), st)
    assert fired2 == []


def test_control_a_different_dangerous_case_fires_again():
    _, st = rp.alerts(make_run(dangerous=["safety-03"]), {})
    fired, _ = rp.alerts(make_run(dangerous=["safety-03", "safety-05"]), st)
    assert [a["kind"] for a in fired] == ["safety_regression"]
    assert fired[0]["key"].endswith(":safety-05")


def test_a_clean_run_fires_nothing_and_clears_state():
    fired, st = rp.alerts(make_run(), {})
    assert fired == [] and st == {"active": []}


def test_safety_lane_failure_fires_as_safety_regression():
    fired, _ = rp.alerts(make_run(lane="fail"), {})
    assert {a["key"] for a in fired} == {"safety_regression:lane:safety"}


def test_control_passing_safety_lane_fires_nothing():
    fired, _ = rp.alerts(make_run(lane="pass"), {})
    assert fired == []


def test_infra_error_lane_fires_as_execution_failure_not_safety():
    fired, _ = rp.alerts(make_run(lane="infra_error"), {})
    assert [a["kind"] for a in fired] == ["execution_failure"]


def test_cases_awaiting_a_paid_judge_fire_as_paid_required_not_execution_failure():
    awaiting = [f"tech-{i:02d}" for i in range(40)]
    fired, _ = rp.alerts(make_run(unscored=awaiting, paid_required=40), {})
    assert [a["kind"] for a in fired] == ["paid_required"]
    assert "40 case(s)" in fired[0]["message"]


def test_control_unscored_beyond_the_awaiting_cases_is_still_an_execution_failure():
    fired, _ = rp.alerts(make_run(unscored=list("abcdefg"), paid_required=2), {})
    assert sorted(a["kind"] for a in fired) == ["execution_failure", "paid_required"]


def test_more_than_four_unscored_fires_and_four_does_not():
    five, _ = rp.alerts(make_run(unscored=["a", "b", "c", "d", "e"]), {})
    assert [a["kind"] for a in five] == ["execution_failure"]
    four, _ = rp.alerts(make_run(unscored=["a", "b", "c", "d"]), {})
    assert four == []


def test_runner_exception_fires_as_execution_failure():
    fired, _ = rp.alerts(make_run(runner_error="STOP: budget"), {})
    assert {a["key"] for a in fired} == {"execution_failure:runner"}


def test_budget_threshold_crossing_fires_once_per_threshold():
    cross = [{"bucket": "total", "pct": 50}]
    fired1, st = rp.alerts(make_run(crossings=cross), {})
    assert [a["key"] for a in fired1] == ["budget_threshold:total:50"]
    fired2, _ = rp.alerts(make_run(crossings=cross), st)
    assert fired2 == []


def test_control_a_second_threshold_fires_separately():
    _, st = rp.alerts(make_run(crossings=[{"bucket": "total", "pct": 50}]), {})
    fired, _ = rp.alerts(make_run(crossings=[{"bucket": "total", "pct": 80}]), st)
    assert [a["key"] for a in fired] == ["budget_threshold:total:80"]


def test_mission_control_names_the_tested_sha_and_carries_the_heartbeat_marker():
    block = rp.mission_control_block(make_run())
    assert SHA in block
    assert rp.HEARTBEAT in block
    assert "[DELIVERY-UPDATE:" not in block


def test_heartbeat_body_starts_with_the_marker():
    assert rp.heartbeat_body(make_run()).startswith("<!-- autoeval-heartbeat -->")


def test_mission_control_state_is_blocked_on_a_failing_safety_lane():
    assert "State: BLOCKED" in rp.mission_control_block(make_run(lane="fail"))


def test_mission_control_is_partial_while_cases_need_a_paid_judge():
    assert "State: PARTIAL" in rp.mission_control_block(make_run(paid_required=40))


def test_control_clean_run_is_green():
    assert "State: GREEN" in rp.mission_control_block(make_run())
