"""Pins the grader's refusal rule (PREREGISTRATION.md §4). Run: python3 -m pytest grade_test.py."""

import pytest

from grade import is_refusal

REFUSE = [
    "The warranty period is not stated in the loaded GS10 maintenance excerpts.",
    "The loaded GS10 excerpts do not state any warranty period.",
    "The manual does not specify the IP rating for this enclosure.",
    "I couldn't find that in the selected sources.",
    "There is no mention of a UL listing in the provided excerpts.",
    "That isn't covered by the loaded manual.",
    "This is not in the loaded excerpts.",
]
ANSWER = [
    "ocA means over-current during acceleration. Do not reset until the cause is removed [1].",
    "Set P00.02 to 9 to reset. The drive does not restart automatically after a fault [2].",
    "Terminal R1A is the relay common; no jumper is needed for 2-wire control [3].",
]


@pytest.mark.parametrize("text", REFUSE)
def test_refusals_are_detected(text):
    assert is_refusal({"answer": text, "status": {"status": "answered"}})


@pytest.mark.parametrize("text", ANSWER)
def test_real_answers_are_not_refusals(text):
    assert not is_refusal({"answer": text, "status": {"status": "answered"}})


def test_insufficient_evidence_status_is_a_refusal_whatever_the_text():
    assert is_refusal({"answer": "ocA means over-current.", "status": {"status": "insufficient_evidence"}})


def test_long_answers_are_not_refusals_even_with_a_refusal_phrase():
    assert not is_refusal({"answer": "The manual does not state X. " + "Step. " * 200, "status": {"status": "answered"}})
