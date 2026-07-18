"""UNSEEN-5 corpus tests — frozen digest, tamper detection, grading contract.

Hermetic. The lane's law (never used for calibration/prompts/fixtures/tuning)
is enforced mechanically by the guard in test_deterministic_qa.py; here we pin
the corpus's own integrity + that every case grades cleanly."""

from __future__ import annotations

from printsense.benchmarks.single_photo_grader import grade_answer
from printsense.benchmarks.unseen_lane import cases as u


def test_expectations_digest_is_frozen():
    assert u.expectations_frozen_ok(), (
        "unseen_lane.sha256 does not match — truth edits must be a loud two-file diff"
    )


def test_tampering_is_detected():
    tampered = [dict(c, question=c["question"] + " (edited)") for c in u.UNSEEN_CASES]
    assert u.expectations_digest(tampered) != u.expectations_digest()


def test_corpus_shape():
    assert len(u.UNSEEN_CASES) == 10
    assert len(set(u.case_ids())) == 10
    for case in u.UNSEEN_CASES:
        for key in ("case_id", "question", "expect"):
            assert key in case, case.get("case_id")
        assert case["expect"]["claimed"] is True  # every unseen case expects a claim


def test_truth_token_pool_covers_page():
    for token in ("-27/K44", "-W7301", "18.4", "-X7:3", "Versorgung 24VDC"):
        assert token in u.PAGE_TRUTH_TOKENS


def test_render_uses_shared_renderer():
    png = u.render_unseen_png()
    assert png[:8] == b"\x89PNG\r\n\x1a\n" and len(png) > 5000


def test_cases_grade_cleanly_with_honest_answers():
    honest = {
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
    for case in u.UNSEEN_CASES:
        result = grade_answer(case, True, honest[case["case_id"]], latency_s=1.0, usage=None)
        assert result["status"] == "pass", (case["case_id"], result["hard_failures"])
