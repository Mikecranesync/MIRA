"""Tests for the auto-scorer rubric (pure functions — no provider, no DB)."""

from __future__ import annotations

import json

from shared.eval_score_rubric import (
    CRITERIA,
    build_messages,
    parse_score,
)


def _full_payload(**overrides):
    payload = {
        "answered_question": 5,
        "no_hallucination": 4,
        "no_redundant_questions": 5,
        "cited_sources_when_claimed": 3,
        "appropriate_tone": 4,
        "overall": 4,
        "reasoning": "Answered directly with a supportable claim.",
    }
    payload.update(overrides)
    return json.dumps(payload)


def test_build_messages_shape():
    msgs = build_messages(
        user_message="powerflex 525 f004",
        bot_response="F004 is an undervoltage fault; check the DC bus.",
        intent="industrial",
        has_citations=True,
    )
    assert [m["role"] for m in msgs] == ["system", "user"]
    assert "strict json" in msgs[0]["content"].lower()
    # The turn text is carried into the user message.
    assert "powerflex 525 f004" in msgs[1]["content"]
    assert "F004 is an undervoltage fault" in msgs[1]["content"]
    assert "bot_claimed_citations: true" in msgs[1]["content"]


def test_parse_full_payload():
    result = parse_score(_full_payload())
    assert result is not None
    assert result["overall"] == 4
    assert result["breakdown"] == {
        "answered_question": 5,
        "no_hallucination": 4,
        "no_redundant_questions": 5,
        "cited_sources_when_claimed": 3,
        "appropriate_tone": 4,
    }
    assert "supportable" in result["reasoning"]
    assert set(result["breakdown"]).issubset(set(CRITERIA))


def test_parse_strips_markdown_fences():
    raw = "```json\n" + _full_payload() + "\n```"
    result = parse_score(raw)
    assert result is not None
    assert result["overall"] == 4


def test_parse_extracts_json_from_surrounding_prose():
    raw = "Here is my evaluation:\n" + _full_payload(overall=2) + "\nHope that helps!"
    result = parse_score(raw)
    assert result is not None
    assert result["overall"] == 2


def test_parse_clamps_out_of_range_scores():
    result = parse_score(_full_payload(answered_question=9, no_hallucination=0, overall=7))
    assert result is not None
    assert result["breakdown"]["answered_question"] == 5  # clamped down
    assert result["breakdown"]["no_hallucination"] == 1  # clamped up
    assert result["overall"] == 5  # clamped down


def test_parse_derives_overall_from_mean_when_missing():
    payload = json.dumps(
        {
            "answered_question": 4,
            "no_hallucination": 4,
            "no_redundant_questions": 5,
            "cited_sources_when_claimed": 3,
            "appropriate_tone": 4,
            "reasoning": "no overall provided",
        }
    )
    result = parse_score(payload)
    assert result is not None
    # mean(4,4,5,3,4) = 4.0 -> 4
    assert result["overall"] == 4


def test_parse_omits_missing_criteria_rather_than_defaulting():
    payload = json.dumps({"answered_question": 5, "overall": 5, "reasoning": "partial"})
    result = parse_score(payload)
    assert result is not None
    assert result["breakdown"] == {"answered_question": 5}
    assert result["overall"] == 5


def test_parse_returns_none_on_garbage():
    assert parse_score("not json at all") is None
    assert parse_score("") is None
    assert parse_score("```\nstill not json\n```") is None


def test_parse_returns_none_when_no_usable_scores():
    # Valid JSON object but no criteria and no overall.
    assert parse_score(json.dumps({"reasoning": "hi", "note": "n/a"})) is None
