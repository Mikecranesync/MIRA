"""The final output QC gate — every point is checked, and provably so.

`scan()` answers "what fired?". That is the wrong shape for a gate: a check that
silently failed to run looks exactly like a check that passed. `run_output_qc()`
answers "what was CHECKED, and what did each one say?" — every registered check
appears in the report with pass/fail/error.

This suite exists because defect D3 shipped past a green probe battery. The
detector that would have caught it lived in `tools/journey_swarm/`, which the bot
image does not ship, so it never ran on a real reply. The tests below pin the two
properties that prevent a repeat:

  1. the report covers EVERY registered detector — a new detector cannot be added
     without the gate running it;
  2. the gate is read-only and cannot break a reply, however a check misbehaves.

Offline: no network, no LLM, no DB.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "mira-bots"))

from shared import answer_qc  # noqa: E402
from shared.answer_qc import DETECTORS, run_output_qc  # noqa: E402

CLEAN_REPLY = (
    "CE10 is a Modbus communication timeout on the GS10 "
    "[Source: AutomationDirect GS10 — Fault Codes]. Check the RS-485 shield "
    "bonding at the drive end before anything else."
)

# The D3 reply — the one that shipped.
D3_REPLY = "You think it's a WEG motor. [Source: 481923.jpg]"


# ── coverage: no check can go missing ────────────────────────────────────────


def test_report_covers_every_registered_check():
    """The audit property. Add a detector, and the gate runs it — no wiring."""
    report = run_output_qc("what motor is this?", CLEAN_REPLY, mode="observe")
    assert set(report.checks) == set(DETECTORS)


def test_coverage_counts_what_actually_ran():
    report = run_output_qc("what motor is this?", CLEAN_REPLY, mode="observe")
    ran, total = report.coverage
    assert ran == total == len(DETECTORS)


def test_every_check_reports_a_verdict_not_a_silence():
    report = run_output_qc("what motor is this?", D3_REPLY, mode="observe")
    assert all(v in ("pass", "fail", "error") for v in report.checks.values())
    assert len(report.checks) == len(DETECTORS)


# ── the gate catches what the engine gate alone missed ───────────────────────


def test_the_d3_reply_is_caught():
    report = run_output_qc("what motor is this?", D3_REPLY, mode="observe")
    assert not report.clean
    assert "malformed_citation" in report.findings


def test_a_good_reply_is_clean():
    """Must-pass fixture — a gate that flags a correct answer is worse than none."""
    report = run_output_qc("GS10 shows CE10", CLEAN_REPLY, mode="observe")
    assert report.clean, report.findings


def test_findings_name_only_the_failures():
    report = run_output_qc("what motor is this?", D3_REPLY, mode="observe")
    assert set(report.findings) <= set(report.checks)
    for name in report.findings:
        assert report.checks[name] == "fail"


# ── mode handling ────────────────────────────────────────────────────────────


def test_off_is_the_default(monkeypatch):
    monkeypatch.delenv("MIRA_ANSWER_QC", raising=False)
    report = run_output_qc("q", D3_REPLY)
    assert report.mode == "off"
    assert not report.ran
    assert report.checks == {}


def test_observe_runs_every_check(monkeypatch):
    monkeypatch.setenv("MIRA_ANSWER_QC", "observe")
    report = run_output_qc("what motor is this?", D3_REPLY)
    assert report.ran
    assert set(report.checks) == set(DETECTORS)


def test_a_typo_in_the_mode_does_not_silently_disable_the_gate(monkeypatch):
    """Fail loud, not open — 'obseve' must not read as 'off'."""
    monkeypatch.setenv("MIRA_ANSWER_QC", "obseve")
    report = run_output_qc("what motor is this?", D3_REPLY)
    assert report.ran
    assert "malformed_citation" in report.findings


# ── it can never break a reply ───────────────────────────────────────────────


def test_a_crashing_check_is_recorded_not_skipped(monkeypatch):
    """An exploding detector must be visible as `error`, never absent."""

    def boom(_q, _r):
        raise RuntimeError("detector exploded")

    monkeypatch.setitem(answer_qc.DETECTORS, "boom", boom)
    report = run_output_qc("q", CLEAN_REPLY, mode="observe")
    assert report.checks["boom"] == "error"
    assert set(report.checks) == set(DETECTORS)


def test_a_crashing_check_does_not_mark_the_reply_clean(monkeypatch):
    def boom(_q, _r):
        raise RuntimeError("detector exploded")

    monkeypatch.setitem(answer_qc.DETECTORS, "boom", boom)
    report = run_output_qc("q", CLEAN_REPLY, mode="observe")
    assert not report.clean  # a check that could not run is not a pass


def test_the_gate_never_edits_the_reply():
    """Read-only by construction — the report carries no rewritten text."""
    report = run_output_qc("what motor is this?", D3_REPLY, mode="observe")
    assert not hasattr(report, "reply")
    assert D3_REPLY == "You think it's a WEG motor. [Source: 481923.jpg]"


def test_empty_reply_does_not_crash_the_gate():
    report = run_output_qc("q", "", mode="observe")
    assert set(report.checks) == set(DETECTORS)


def test_summary_states_coverage_and_verdict():
    report = run_output_qc("what motor is this?", D3_REPLY, mode="observe")
    assert f"/{len(DETECTORS)} checks ran" in report.summary()
    assert "malformed_citation" in report.summary()
