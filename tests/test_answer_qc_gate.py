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


# ── multi-turn grounding: the detectors came from a single-turn battery ──────


def test_a_vendor_established_earlier_in_the_session_is_not_unrelated():
    """The first synthetic run's false positive (2026-08-04), pinned.

    The technician named a PowerFlex 525 in turn 1 and asked "which is safer?"
    in turn 3. Grading turn 3 against its own message alone reported a correct
    Rockwell citation as an unrelated vendor. Callers must grade against what the
    technician established across the session — `established_context_text` in
    production, prior user turns in the synthetic loop.
    """
    reply = (
        "Power cycle is the default and safer option. [Source: Rockwell Automation PowerFlex 525]"
    )
    this_turn_only = "which one's safer? just give me the quickest way"
    established = "how do I reset a fault on a PowerFlex 525? " + this_turn_only

    assert "unrelated_vendor" in run_output_qc(this_turn_only, reply, mode="observe").findings
    assert "unrelated_vendor" not in run_output_qc(established, reply, mode="observe").findings


def test_a_genuinely_unrelated_vendor_still_fires():
    """Both directions — the fix must not blind the check that caught Demag."""
    reply = "Check the inverter's digital outputs [Source: Siemens — 5.5 Quick commissioning]"
    established = "the conveyor stopped again. did that fix it?"
    assert "unrelated_vendor" in run_output_qc(established, reply, mode="observe").findings


# ── detector calibration, from the first synthetic run (2026-08-04) ──────────


def test_a_generic_document_title_is_not_a_vendor():
    """`[Source: Serial Comms, p. 1]` was reported as a vendor named `serial`."""
    established = "GS10 drive keeps dropping comms"
    for label in ("Serial Comms, p. 1", "Img 0930 — motor", "Wiring Diagram, p. 4"):
        report = run_output_qc(established, f"Check the shield [Source: {label}]", mode="observe")
        assert "unrelated_vendor" not in report.findings, label


def test_the_demag_class_still_fires():
    """Both directions — the co-01 defect was an attribution to a brand that is
    deliberately NOT in `_VENDOR_MODELS`, so the fix must not require membership."""
    report = run_output_qc(
        "the conveyor stopped again",
        "Have you checked the brake gap [Source: Demag — BGV D06]?",
        mode="observe",
    )
    assert "unrelated_vendor" in report.findings


def test_a_reply_that_retracts_its_claim_is_not_a_contradiction():
    """H4's `Correction: … unverified` repair (#3121) is the fix, not the defect."""
    reply = (
        "I have the AutomationDirect GS10 manual indexed.\n\n"
        "Correction: I can't produce a citation for that, so treat the reference above as "
        "unverified — consult the asset nameplate or vendor manual. "
        "[KB-gap: I do not have that specific information in the knowledge base.]"
    )
    assert (
        "self_contradiction"
        not in run_output_qc("GS10 trip class?", reply, mode="observe").findings
    )


def test_the_dc02_flat_contradiction_still_fires():
    """Both directions — an unreconciled X-then-not-X must still be caught."""
    reply = (
        "I have the AutomationDirect GS10 manual indexed. "
        "I don't have specific documentation indexed for this."
    )
    assert "self_contradiction" in run_output_qc("GS10 trip class?", reply, mode="observe").findings


# ── block-form citations must reach the vendor gate (#3049) ─────────────────


def test_normalize_sources_block_is_idempotent():
    """It now runs twice — before the vendor gate and again in the H4 enforcer."""
    from shared.engine import _normalize_sources_block as norm

    block = (
        "What is the fault code?\n\n"
        "--- Sources ---\n"
        "[1] Yaskawa V1000 - Cause Possible Solution, p. 279\n"
        "[2] ABB ACH580, p. 117\n"
    )
    once = norm(block)
    assert once.count("[Source:") == 2
    assert norm(once).count("[Source:") == 2  # second pass adds nothing


def test_a_block_form_citation_is_visible_to_the_vendor_gate():
    """The #3049 mechanism: block-form citations bypassed the gate entirely.

    The gate matches inline tags only. Before normalization it saw nothing to
    strip; the H4 enforcer then materialized those same citations inline, after
    the gate had passed — so the attribution was never vendor-checked.
    """
    from shared.citation_compliance import evaluate_citation_relevance
    from shared.engine import _normalize_sources_block as norm

    established = "It stopped again. The drive faulted out and tripped the breaker."
    block = (
        "What is the fault code?\n\n"
        "--- Sources ---\n"
        "[1] Yaskawa V1000 - Cause Possible Solution, p. 279\n"
        "[2] ABB ACH580, p. 117\n"
    )
    assert evaluate_citation_relevance(block, None, established)["conflicting_tags"] == []
    after = evaluate_citation_relevance(norm(block), None, established)
    assert len(after["conflicting_tags"]) == 2
    assert after["reason"] == "unestablished"


def test_a_correct_vendor_block_survives_normalization():
    """Both directions — a block naming the established vendor is not stripped."""
    from shared.citation_compliance import evaluate_citation_relevance
    from shared.engine import _normalize_sources_block as norm

    established = "my AutomationDirect GS10 shows CE10"
    block = "CE10 is a comms fault.\n\n--- Sources ---\n[1] AutomationDirect GS10 - Fault Codes\n"
    assert evaluate_citation_relevance(norm(block), "AutomationDirect", established)["relevant"]
