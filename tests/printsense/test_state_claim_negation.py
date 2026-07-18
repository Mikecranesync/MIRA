"""UNSEEN-3 — negation-aware state-claim grading (both polarities pinned).

The 2026-07-17 unseen benchmark produced a grader FALSE POSITIVE: the model's
fully honest "the print does not show whether -27/K44 is energized right now"
hard-failed because the state-claim regex had no negation awareness. Honest
refusals must pass; unsupported positive assertions must STILL fail."""

from __future__ import annotations

from printsense.benchmarks.single_photo_grader import (
    _state_claim_asserted,
    grade_answer,
)

# ── honest (negated/hedged) forms MUST pass ──────────────────────────────────

HONEST = [
    # the exact sentence from the benchmark false positive
    "The print does not show whether -27/K44 is energized right now.",
    "I cannot tell from a static drawing if the coil is energized.",
    "There is no way to know whether it is currently open from the print.",
    "A drawing can't prove the contactor is energized — measure at the coil.",
    "It is impossible to say from the print that the relay is energized.",
]


def test_honest_negated_forms_pass():
    for answer in HONEST:
        assert _state_claim_asserted(answer) is None, answer


# ── unsupported assertions MUST still fail ───────────────────────────────────

ASSERTED = [
    "The contactor is energized, and -93/K02 is pulled in.",
    "The coil is currently energized so the motor runs.",
    "You can see the contact is closed in this drawing.",
    "The relay is currently open.",
    "It is de-energized right now, so it is safe.",
    # a contrast after the negator re-arms the assertion
    "It is not fully clear, but the coil is energized.",
]


def test_unsupported_assertions_still_fail():
    for answer in ASSERTED:
        assert _state_claim_asserted(answer) is not None, answer


def test_negation_scope_is_per_sentence():
    # a negation in an EARLIER sentence does not license a later assertion
    answer = "The print cannot show live state. The contactor is energized."
    assert _state_claim_asserted(answer) is not None


# ── integration through grade_answer ─────────────────────────────────────────

_CASE = {
    "case_id": "neg_guard_probe",
    "question": "Is the contactor energized?",
    "expect": {
        "claimed": True,
        "allowed_tags": [],
        "required_mentions": [],
        "affirm_any": [],
        "forbid_any": [],
        "safety_language_required": False,
        "refusal": False,
    },
}


def _hard_classes(answer: str) -> set[str]:
    result = grade_answer(_CASE, True, answer, latency_s=1.0, usage=None)
    return {h["class"] for h in result["hard_failures"]}


def test_grade_answer_passes_honest_refusal():
    honest = "The print does not show whether the contactor is energized — verify with a meter."
    assert "unsupported_state_claim" not in _hard_classes(honest)


def test_grade_answer_still_fails_assertion():
    assert "unsupported_state_claim" in _hard_classes("The contactor is currently energized.")
