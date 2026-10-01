"""Hermetic tests for photo_diagnosis.grading. No network — FakeProvider only."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

TOOLS_QA = Path(__file__).resolve().parents[2] / "tools" / "qa"
if str(TOOLS_QA) not in sys.path:
    sys.path.insert(0, str(TOOLS_QA))

from photo_diagnosis import grading  # noqa: E402
from photo_diagnosis.providers import FakeProvider  # noqa: E402

CASE = {
    "id": "grade-case-1",
    "hypotheses": [
        {"id": "a", "text": "a welded contactor nobody has mentioned yet", "status": "true_cause"},
        {
            "id": "b",
            "text": "an open feedback wire, acceptable alt",
            "status": "acceptable_alternative",
        },
        {"id": "c", "text": "a ruled-out generic program fault", "status": "ruled_out"},
    ],
    "unproven": ["whether the weld predates last week's overcurrent event"],
}
REVEALED_FACT_TEXT = "Both channels make."
UNREVEALED_FACT_TEXT = "K1's armature looks pulled in with the relay off, confirming the weld."


# ---------------------------------------------------------------------------
# turn_grade — no-hindsight prompt discipline (the decoy-prompt lesson:
# assert on what the FakeProvider actually received, never on a return value)


def _full_turn_response(**overrides) -> str:
    data = {f: False for f in grading.TURN_FIELDS}
    data.update(overrides)
    data.setdefault("notes", "")
    return json.dumps(data)


def test_turn_grade_prompt_excludes_unrevealed_facts_and_hypothesis_statuses():
    fake = FakeProvider(responses=[_full_turn_response(H=True, D=True, S=True)])
    history = [
        {"role": "user", "content": "Guard door won't reset."},
        {"role": "assistant", "content": "Let's check the door switch continuity."},
    ]
    grading.turn_grade(
        fake, history, revealed_facts_so_far=[REVEALED_FACT_TEXT], visible_facts=["PNOZ X3 relay"]
    )

    assert fake.calls == 1
    sent = json.dumps(fake.received_messages[0])
    # the revealed fact DOES appear (positive control)
    assert REVEALED_FACT_TEXT in sent
    # none of the unrevealed hidden-fact text, hypothesis-status vocabulary,
    # or unproven text ever reached the provider
    assert UNREVEALED_FACT_TEXT not in sent
    assert "true_cause" not in sent
    assert "acceptable_alternative" not in sent
    assert "ruled_out" not in sent
    for unproven_text in CASE["unproven"]:
        assert unproven_text not in sent
    for hyp in CASE["hypotheses"]:
        assert hyp["text"] not in sent


def test_turn_grade_parses_all_seven_fields_and_notes():
    fake = FakeProvider(
        responses=[
            json.dumps(
                {
                    "H": True,
                    "D": False,
                    "S": True,
                    "R": False,
                    "U": True,
                    "X": False,
                    "N": False,
                    "notes": "ok",
                }
            )
        ]
    )
    result = grading.turn_grade(fake, [], [], [])
    for field in grading.TURN_FIELDS:
        assert field in result
    assert result["H"] is True
    assert result["U"] is True
    assert result["notes"] == "ok"


# ---------------------------------------------------------------------------
# outcome_grade — sees everything; validates the label


def test_outcome_grade_returns_valid_label():
    fake = FakeProvider(responses=[json.dumps({"outcome": "resolved_true", "notes": "n/a"})])
    label = grading.outcome_grade(fake, [{"role": "user", "content": "x"}], CASE)
    assert label == "resolved_true"
    assert label in grading.OUTCOME_LABELS


def test_outcome_grade_invalid_label_raises_grader_error():
    fake = FakeProvider(responses=[json.dumps({"outcome": "definitely_true_i_promise"})])
    with pytest.raises(grading.GraderError):
        grading.outcome_grade(fake, [], CASE)


# ---------------------------------------------------------------------------
# citation_support


def test_citation_support_valid_label():
    fake = FakeProvider(responses=[json.dumps({"label": "supported"})])
    label = grading.citation_support(
        fake, "the relay needs 24VDC", "Input voltage: 24 VDC", "PNOZ X3"
    )
    assert label == "supported"


def test_citation_support_invalid_label_raises():
    fake = FakeProvider(responses=["not json at all"])
    with pytest.raises(grading.GraderError):
        grading.citation_support(fake, "claim", "chunk", "model")


# ---------------------------------------------------------------------------
# Judge failure -> ungraded, NEVER a fallback provider


def test_judge_failure_raises_grader_error_and_second_provider_untouched():
    failing = FakeProvider(raise_on_call=RuntimeError("judge is down"))
    fallback_never_called = FakeProvider(responses=[json.dumps({"outcome": "resolved_true"})])

    with pytest.raises(grading.GraderError):
        grading.outcome_grade(failing, [], CASE)

    assert failing.calls == 1
    assert fallback_never_called.calls == 0  # grading.py has no fallback path to find it through


def test_garbage_json_raises_grader_error_not_silent_default():
    fake = FakeProvider(responses=["<html>not json</html>"])
    with pytest.raises(grading.GraderError):
        grading.turn_grade(fake, [], [], [])


# ---------------------------------------------------------------------------
# F8 — strict grade validation: every TURN_FIELDS key must be present and an
# actual JSON bool, or it's ungraded (GraderError), never silently coerced.


def test_turn_grade_empty_object_raises_grader_error():
    fake = FakeProvider(responses=["{}"])
    with pytest.raises(grading.GraderError):
        grading.turn_grade(fake, [], [], [])


def test_turn_grade_null_field_raises_grader_error():
    data = {f: False for f in grading.TURN_FIELDS}
    data["X"] = None
    fake = FakeProvider(responses=[json.dumps(data)])
    with pytest.raises(grading.GraderError):
        grading.turn_grade(fake, [], [], [])


def test_turn_grade_numeric_field_raises_grader_error():
    data = {f: False for f in grading.TURN_FIELDS}
    data["H"] = 1
    fake = FakeProvider(responses=[json.dumps(data)])
    with pytest.raises(grading.GraderError):
        grading.turn_grade(fake, [], [], [])


def test_turn_grade_string_bool_raises_grader_error():
    data = {f: False for f in grading.TURN_FIELDS}
    data["U"] = "false"
    fake = FakeProvider(responses=[json.dumps(data)])
    with pytest.raises(grading.GraderError):
        grading.turn_grade(fake, [], [], [])


def test_turn_grade_full_valid_object_succeeds():
    fake = FakeProvider(responses=[_full_turn_response(H=True)])
    result = grading.turn_grade(fake, [], [], [])
    assert result["H"] is True
    for field in grading.TURN_FIELDS:
        assert isinstance(result[field], bool)


def test_outcome_grade_missing_outcome_raises_grader_error():
    fake = FakeProvider(responses=[json.dumps({"notes": "n/a"})])
    with pytest.raises(grading.GraderError):
        grading.outcome_grade(fake, [], CASE)


def test_outcome_grade_null_outcome_raises_grader_error():
    fake = FakeProvider(responses=[json.dumps({"outcome": None})])
    with pytest.raises(grading.GraderError):
        grading.outcome_grade(fake, [], CASE)


def test_outcome_grade_numeric_outcome_raises_grader_error():
    fake = FakeProvider(responses=[json.dumps({"outcome": 1})])
    with pytest.raises(grading.GraderError):
        grading.outcome_grade(fake, [], CASE)


# ---------------------------------------------------------------------------
# qa_grade — deterministic exact-match / must_not, word-boundary discipline


def _question(**overrides) -> dict:
    base = {
        "q": "What is the control voltage?",
        "answer_key": {"value": "24 V", "source": "nameplate"},
        "acceptable": ["24VDC"],
        "requires_citation": False,
        "honest_unknown_ok": False,
        "must_not": ["120 V"],
    }
    base.update(overrides)
    return base


def test_qa_grade_exact_match_true():
    result = grading.qa_grade("The nameplate reads 24 V control voltage.", _question())
    assert result["exact_match"] is True
    assert result["must_not_hit"] == []


def test_qa_grade_exact_match_false_when_value_absent():
    result = grading.qa_grade("I'm not sure what the control voltage is.", _question())
    assert result["exact_match"] is False


def test_qa_grade_must_not_hit_detected():
    result = grading.qa_grade("Looks like 120 V to me.", _question())
    assert "120 V" in result["must_not_hit"]


def test_qa_grade_word_boundary_true_direction():
    # "24 V" must match inside "...is 24 V supply." (word boundaries on both sides)
    result = grading.qa_grade("The relay coil is 24 V supply.", _question())
    assert result["exact_match"] is True


def test_qa_grade_word_boundary_false_direction():
    # "24 V" must NOT match "124 V" — this is the D1/D4/E1-class defect this
    # repo's word-boundary rule exists to catch.
    q = _question(answer_key={"value": "24 V", "source": "nameplate"}, acceptable=[], must_not=[])
    result = grading.qa_grade("Nameplate actually reads 124 V, not what you'd expect.", q)
    assert result["exact_match"] is False


def test_qa_grade_unneeded_refusal_when_answerable():
    q = _question(honest_unknown_ok=False)
    result = grading.qa_grade("I don't know, that's not in the documents I have.", q)
    assert result["unneeded_refusal"] is True


def test_qa_grade_refusal_tolerated_when_honestly_unknown():
    q = _question(honest_unknown_ok=True)
    result = grading.qa_grade("I don't know, that's not in the documents I have.", q)
    assert result["unneeded_refusal"] is False


def test_qa_grade_llm_part_optional_and_only_called_when_provider_given():
    q = _question()
    no_provider_result = grading.qa_grade("24 V control voltage.", q)
    assert no_provider_result["unsupported_claim"] is None

    fake = FakeProvider(responses=[json.dumps({"unsupported_claim": True})])
    with_provider_result = grading.qa_grade("24 V control voltage.", q, provider=fake)
    assert fake.calls == 1
    assert with_provider_result["unsupported_claim"] is True


# ---------------------------------------------------------------------------
# F8 — qa_grade's optional LLM part is strictly validated too


def test_qa_grade_llm_part_empty_object_raises_grader_error():
    q = _question()
    fake = FakeProvider(responses=["{}"])
    with pytest.raises(grading.GraderError):
        grading.qa_grade("24 V control voltage.", q, provider=fake)


def test_qa_grade_llm_part_null_raises_grader_error():
    q = _question()
    fake = FakeProvider(responses=[json.dumps({"unsupported_claim": None})])
    with pytest.raises(grading.GraderError):
        grading.qa_grade("24 V control voltage.", q, provider=fake)


def test_qa_grade_llm_part_numeric_raises_grader_error():
    q = _question()
    fake = FakeProvider(responses=[json.dumps({"unsupported_claim": 1})])
    with pytest.raises(grading.GraderError):
        grading.qa_grade("24 V control voltage.", q, provider=fake)


def test_qa_grade_llm_part_string_bool_raises_grader_error():
    q = _question()
    fake = FakeProvider(responses=[json.dumps({"unsupported_claim": "false"})])
    with pytest.raises(grading.GraderError):
        grading.qa_grade("24 V control voltage.", q, provider=fake)
