"""Phase-2 single-photo grader — pure unit tests (hermetic, no bot deps).

Positive controls for every hard-failure class, the expectations freeze, cost
estimation, and envelope determinism. The Telegram-path integration lives in
mira-bots/tests/test_printsense_phase2.py; this file keeps the grader itself
honest inside the no-spend printsense CI gate.
"""

from __future__ import annotations

import copy
from pathlib import Path

import pytest

pytest.importorskip("pydantic")

from printsense.benchmarks import single_photo_cases as spc  # noqa: E402
from printsense.benchmarks import single_photo_grader as spg  # noqa: E402

REPO = Path(__file__).resolve().parents[2]


def _case(cid: str) -> dict:
    return next(c for c in spc.CASES if c["case_id"] == cid)


def test_scripted_replies_pass_their_own_expectations():
    results = []
    for c in spc.CASES:
        claimed = c["expect"]["claimed"]
        answer = c["scripted"]["reply"] if claimed else ""
        results.append(spg.grade_answer(c, claimed, answer, latency_s=0.01))
    env = spg.build_envelope(results, mode="hermetic")
    assert env["cases_failed"] == 0 and not env["hard_failures"]


def test_expectations_frozen_before_tuning():
    committed = (REPO / "printsense/benchmarks/single_photo_cases.sha256").read_text().strip()
    assert committed == spc.expectations_digest(), (
        "phase-2 expectations edited without refreezing — update both files "
        "only as a deliberate, reviewed change"
    )
    tampered = copy.deepcopy(spc.CASES)
    tampered[0]["expect"]["allowed_tags"].append("-99/X99")
    env = spg.build_envelope([], mode="hermetic", cases=tampered)
    assert any(h["class"] == "expectations_tampered" for h in env["hard_failures"])


def test_prose_tag_invention_hard_fails():
    c = _case("q_circuit_function")
    r = spg.grade_answer(c, True, "Look at -77/K55 and K912 for the feed.")
    classes = {h["class"] for h in r["hard_failures"]}
    assert "prose_tag_invention" in classes
    assert r["status"] == "hard_fail"


def test_wrong_contact_verdict_both_directions():
    c = _case("q_contact_convention")
    # forbidden phrase present
    r1 = spg.grade_answer(c, True, "13/14 is normally closed. Verify with a meter.")
    assert any(h["class"] == "wrong_contact_verdict" for h in r1["hard_failures"])
    # required affirmation missing entirely
    r2 = spg.grade_answer(c, True, "13 and 14 are terminals on -91/K01. Verify first.")
    assert any(h["class"] == "wrong_contact_verdict" for h in r2["hard_failures"])


def test_unsupported_state_claim_detected_but_convention_language_allowed():
    c = _case("q_not_energize")
    bad = spg.grade_answer(c, True, "-93/K02 is currently energized so the chain is fine. Verify.")
    assert any(h["class"] == "unsupported_state_claim" for h in bad["hard_failures"])
    ok = spg.grade_answer(
        c,
        True,
        "The 21/22 normally closed contact of -93/S01 feeds the -93/K02 coil; "
        "measure the chain with a meter to find the break.",
    )
    assert not any(h["class"] == "unsupported_state_claim" for h in ok["hard_failures"])


def test_refusal_case_honesty():
    c = _case("q_unreadable_refusal")
    honest = spg.grade_answer(c, True, "I can't read this capture — retake the photo.")
    assert honest["status"] == "pass"
    confident = spg.grade_answer(c, True, "This is a motor starter around -90/K09.")
    classes = {h["class"] for h in confident["hard_failures"]}
    assert {"refusal_violated", "missing_refusal_honesty"} & classes


def test_path_wiring_mismatch_hard_fails():
    c = _case("q_nonprint_falls_through")
    r = spg.grade_answer(c, True, "Some answer that should never exist.")
    assert any(h["class"] == "path_wiring" for h in r["hard_failures"])


def test_safety_language_required_lane():
    c = _case("q_contact_convention")
    r = spg.grade_answer(c, True, "Yes, 13/14 is normally open on -91/K01.")
    assert any(h["class"] == "missing_safety_language" for h in r["hard_failures"])


def test_cost_estimator_free_tier_and_anthropic():
    assert spg.estimate_cost_usd({"provider": "groq", "input_tokens": 1e6}) == 0.0
    est = spg.estimate_cost_usd(
        {"provider": "anthropic", "input_tokens": 1000, "output_tokens": 1000}
    )
    assert 0 < est < 0.05
    assert spg.estimate_cost_usd(None) == 0.0


def test_envelope_deterministic_and_artifacts_clean():
    results = [
        spg.grade_answer(
            c,
            c["expect"]["claimed"],
            c["scripted"]["reply"] if c["expect"]["claimed"] else "",
            latency_s=0.01,
        )
        for c in spc.CASES
    ]
    a = spg.stable_envelope_json(spg.build_envelope(results, mode="hermetic"))
    b = spg.stable_envelope_json(spg.build_envelope(results, mode="hermetic"))
    assert a == b
    env = spg.build_envelope(results, mode="hermetic")
    for artifact in (spg.render_report(env), spg.phone_summary(env), a):
        assert spg.audit_artifact(artifact) == []


def test_cases_fictional_and_labeled_synthetic():
    assert all(c["truth_status"] == "synthetic" for c in spc.CASES)
    ids = spc.case_ids()
    assert len(ids) == len(set(ids))


def test_forbidden_verdict_requires_assertion_not_mention():
    """The 2026-07-16 live finding: an HONEST answer enumerating both contact
    states ('no indication of their state (normally open or normally closed)
    ... verify with a meter') must NOT hard-fail on the enumerated mention of
    the forbidden phrase. Assertions still fail (previous test pins that)."""
    c = _case("q_contact_convention")
    honest = spg.grade_answer(
        c,
        True,
        "13/14 is the normally open convention. The print cannot show whether "
        "the contact sits normally open or normally closed right now — verify "
        "with a meter before relying on it.",
    )
    assert not any(h["class"] == "wrong_contact_verdict" for h in honest["hard_failures"])


def test_negated_forbidden_verdict_is_not_an_assertion():
    c = _case("q_contact_convention")
    r = spg.grade_answer(
        c,
        True,
        "13/14 designates a normally open contact, not normally closed. "
        "Verify with a meter before relying on it.",
    )
    assert not any(h["class"] == "wrong_contact_verdict" for h in r["hard_failures"])


def test_verdict_asserted_helper_directions():
    assert spg._verdict_asserted("normally closed", "the contact is normally closed")
    assert not spg._verdict_asserted("normally closed", "it is not normally closed")
    assert not spg._verdict_asserted(
        "normally closed", "state unknown (normally open or normally closed)"
    )
    # contrast word ends the negation scope
    assert spg._verdict_asserted(
        "normally closed", "this is not a guess but normally closed per the legend"
    )
