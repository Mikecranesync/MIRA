"""Unit tests for MIRA LLM-as-judge (tests/eval/judge.py).

These tests are OFFLINE — all LLM API calls are mocked.
They verify routing logic, JSON parsing, score validation, and the
judge's ability to correctly report scores fed back from mock providers.

Run:
    pytest tests/eval/test_judge.py -v

Red-team test: a keyword-stuffed gibberish response (passes cp_keyword_match
because it contains the right words) should score ≤2 on groundedness and
helpfulness when the judge model rates it honestly.

Pass case: a real helpful grounded response should score ≥4 across all four
dimensions.

Pilz miss case: a response that ignores "find a manual" and returns a
diagnostic question instead should score ≤2 on instruction_following.
"""

from __future__ import annotations

import json
import os
from unittest.mock import patch

import pytest

from tests.eval.judge import DIMENSIONS, Judge, JudgeResult

# ── Helpers ───────────────────────────────────────────────────────────────────


def _mock_json_response(scores: dict[str, int], notes: dict[str, str] | None = None) -> str:
    """Build a valid judge JSON string from score + note dicts."""
    notes = notes or {d: f"Test note for {d}" for d in DIMENSIONS}
    payload = {dim: {"score": scores[dim], "note": notes[dim]} for dim in DIMENSIONS}
    return json.dumps(payload)


def _make_judge_with_keys(env_overrides: dict | None = None) -> tuple[Judge, dict]:
    """Instantiate a Judge with test API keys injected via env."""
    env = {
        "EVAL_DISABLE_JUDGE": "0",
        "GROQ_API_KEY": "test-groq-key",
        "ANTHROPIC_API_KEY": "test-claude-key",
        "GROQ_MODEL": "llama-3.3-70b-versatile",
        "CLAUDE_MODEL": "claude-sonnet-4-6",
    }
    if env_overrides:
        env.update(env_overrides)
    with patch.dict(os.environ, env, clear=False):
        judge = Judge()
    return judge, env


# ── Disabled mode ─────────────────────────────────────────────────────────────


def test_disabled_mode_returns_no_op():
    with patch.dict(os.environ, {"EVAL_DISABLE_JUDGE": "1"}, clear=False):
        judge = Judge()

    result = judge.grade(
        response="some response",
        rag_context="",
        user_question="what is the fault?",
        generated_by="groq",
        scenario_id="test_disabled",
    )

    assert result.error == "EVAL_DISABLE_JUDGE=1"
    assert result.scores == {}
    assert result.judge_provider == "(disabled)"
    assert not result.succeeded


# ── Provider routing ──────────────────────────────────────────────────────────


def test_routing_claude_generated_picks_groq():
    judge, _ = _make_judge_with_keys()
    provider = judge._pick_judge_provider("claude")
    assert provider == "groq", "Claude-generated response must be judged by Groq"


def test_routing_groq_generated_picks_claude():
    judge, _ = _make_judge_with_keys()
    provider = judge._pick_judge_provider("groq")
    assert provider == "claude", "Groq-generated response must be judged by Claude"


def test_routing_cerebras_generated_picks_claude():
    judge, _ = _make_judge_with_keys()
    provider = judge._pick_judge_provider("cerebras")
    assert provider == "claude"


def test_routing_unknown_picks_claude_first():
    judge, _ = _make_judge_with_keys()
    provider = judge._pick_judge_provider("unknown")
    assert provider == "claude", "Unknown origin should default to Claude (highest-quality judge)"


def test_routing_no_claude_key_unknown_falls_back_to_groq():
    judge, _ = _make_judge_with_keys({"ANTHROPIC_API_KEY": ""})
    provider = judge._pick_judge_provider("unknown")
    assert provider == "groq"


def test_routing_no_keys_returns_none():
    judge, _ = _make_judge_with_keys({"GROQ_API_KEY": "", "ANTHROPIC_API_KEY": ""})
    provider = judge._pick_judge_provider("unknown")
    assert provider is None


# ── JSON parsing ──────────────────────────────────────────────────────────────


def test_parse_clean_json():
    judge, _ = _make_judge_with_keys()
    raw = _mock_json_response({d: 4 for d in DIMENSIONS})
    data = judge._parse_json(raw)
    scores, notes = judge._validate_result(data)
    assert all(scores[d] == 4 for d in DIMENSIONS)


def test_parse_json_with_markdown_fences():
    judge, _ = _make_judge_with_keys()
    raw = "```json\n" + _mock_json_response({d: 3 for d in DIMENSIONS}) + "\n```"
    data = judge._parse_json(raw)
    scores, _ = judge._validate_result(data)
    assert all(scores[d] == 3 for d in DIMENSIONS)


def test_validate_rejects_score_out_of_range():
    judge, _ = _make_judge_with_keys()
    bad = {d: {"score": 5, "note": "ok"} for d in DIMENSIONS}
    bad["groundedness"]["score"] = 6  # out of range
    with pytest.raises(ValueError, match="out of range"):
        judge._validate_result(bad)


def test_validate_rejects_missing_dimension():
    judge, _ = _make_judge_with_keys()
    incomplete = {d: {"score": 4, "note": "ok"} for d in DIMENSIONS if d != "tone"}
    with pytest.raises(ValueError, match="Missing dimension"):
        judge._validate_result(incomplete)


# ── Red-team: keyword-stuffed gibberish ───────────────────────────────────────
#
# A response that contains all the right keywords (passes cp_keyword_match)
# but is incoherent/gibberish should receive LOW scores on groundedness and
# helpfulness from an honest judge.
#
# We mock the judge API to return what an honest judge WOULD return for such
# a response, then verify the JudgeResult reflects those low scores.


_KEYWORD_STUFFED_GIBBERISH = (
    "GS10 overcurrent parameter motor fault VFD acceleration ramp check "
    "disconnect de-energize overcurrent GS10 overcurrent parameter motor "
    "fault check overcurrent GS10 overcurrent parameter motor fault VFD "
    "acceleration ramp check disconnect de-energize overcurrent GS10 "
    "overcurrent parameter motor fault check overcurrent GS10 overcurrent "
    "parameter motor fault VFD acceleration ramp check disconnect de-energize "
    "overcurrent GS10 parameter fault."
)

_GIBBERISH_JUDGE_RESPONSE = _mock_json_response(
    scores={
        "groundedness": 1,
        "helpfulness": 1,
        "tone": 2,
        "instruction_following": 2,
    },
    notes={
        "groundedness": "Response is a keyword loop with no grounded facts from retrieved chunks.",
        "helpfulness": "Repeating the same terms provides no actionable guidance for the technician.",
        "tone": "Reads as machine-generated spam rather than professional guidance.",
        "instruction_following": "Did not address the user's question coherently.",
    },
)


def test_red_team_keyword_stuffed_gibberish_scores_low():
    """Keyword-stuffed response that passes cp_keyword_match must score ≤2 on
    groundedness and helpfulness when the judge evaluates it honestly."""
    judge, env = _make_judge_with_keys()

    # Mock the Groq call (unknown generated_by → Claude judge; but we set up
    # Claude-generated to route to Groq for this test)
    with patch.dict(os.environ, env, clear=False):
        with patch.object(judge, "_call_claude", return_value=_GIBBERISH_JUDGE_RESPONSE):
            result = judge.grade(
                response=_KEYWORD_STUFFED_GIBBERISH,
                rag_context="",
                user_question="GS10 VFD showing OC fault on startup",
                generated_by="groq",  # groq-generated → Claude judge
                scenario_id="red_team_gibberish",
            )

    assert result.succeeded, f"Judge call failed: {result.error}"
    assert result.scores["groundedness"] <= 2, (
        f"Keyword-stuffed gibberish should score ≤2 on groundedness, got {result.scores['groundedness']}"
    )
    assert result.scores["helpfulness"] <= 2, (
        f"Keyword-stuffed gibberish should score ≤2 on helpfulness, got {result.scores['helpfulness']}"
    )


# ── Pass case: real helpful grounded response ─────────────────────────────────

_HELPFUL_GROUNDED_RESPONSE = """
GS10 overcurrent (OC) faults on startup typically indicate one of three causes:

1. **Acceleration ramp too fast** — Check parameter P2.00 (Acceleration Time). For a 5HP 460V
   motor, try 5–10 seconds. Factory default is often 2s which can cause OC on inductive loads.

2. **Current limit set too low** — Verify P3.16 (Motor Rated Current). Set to nameplate FLA
   (typically 7–8A for 5HP 460V). If set below actual inrush, you'll trip on OC every time.

3. **Output phase short or damaged motor** — Measure resistance phase-to-phase at the motor
   terminals. Should be balanced within 5%.

Next step: Check P2.00 first — longest acceleration that still meets your cycle time.
Do you know your current P2.00 setting?
""".strip()

_HELPFUL_JUDGE_RESPONSE = _mock_json_response(
    scores={
        "groundedness": 5,
        "helpfulness": 5,
        "tone": 4,
        "instruction_following": 4,
    },
    notes={
        "groundedness": "Response cites specific parameter numbers consistent with GS10 documentation.",
        "helpfulness": "Provides three concrete diagnostic steps with specific parameter references.",
        "tone": "Concise and professional; treats technician as competent.",
        "instruction_following": "Addresses OC fault on startup directly with actionable steps.",
    },
)


def test_pass_case_helpful_grounded_response_scores_high():
    """A real helpful grounded response must score ≥4 across all dimensions."""
    judge, env = _make_judge_with_keys()

    with patch.dict(os.environ, env, clear=False):
        with patch.object(judge, "_call_claude", return_value=_HELPFUL_JUDGE_RESPONSE):
            result = judge.grade(
                response=_HELPFUL_GROUNDED_RESPONSE,
                rag_context="GS10 Quick Start Guide: P2.00 = Acceleration Time (default 2.0s). "
                            "P3.16 = Motor Rated Current.",
                user_question="GS10 VFD showing OC fault on startup",
                generated_by="groq",  # groq-generated → Claude judge
                scenario_id="pass_case_helpful",
            )

    assert result.succeeded, f"Judge call failed: {result.error}"
    for dim in DIMENSIONS:
        assert result.scores[dim] >= 4, (
            f"Helpful grounded response should score ≥4 on {dim}, got {result.scores[dim]}"
        )


# ── Pilz manual-miss: low instruction_following ───────────────────────────────
#
# Reconstructed from chat b500953b (2026-04-14 Pilz forensic):
# User says "Can you find a manual for this kind of distribution block"
# Old behavior (pre-v2.4.0): system returned another diagnostic FSM question
# instead of a vendor URL + doc reference.
#
# The judge should assign instruction_following ≤2 for this old response
# because it ignored the user's explicit documentation request.

_PILZ_MANUAL_MISS_RESPONSE = (
    "I understand you're having intermittent faults with the distribution block. "
    "To help me diagnose this further, can you tell me: what is the exact model number "
    "of your Pilz PNOZ unit, and how many times has the fault occurred in the last 24 hours?"
)

_PILZ_MISS_JUDGE_RESPONSE = _mock_json_response(
    scores={
        "groundedness": 3,
        "helpfulness": 2,
        "tone": 3,
        "instruction_following": 1,
    },
    notes={
        "groundedness": "Response asks for more information but does not invent facts.",
        "helpfulness": "A technician looking for a manual receives only another question, not docs.",
        "tone": "Professional but deflects rather than helps.",
        "instruction_following": (
            "User explicitly asked to 'find a manual' — response returned a diagnostic "
            "question instead of a vendor URL or documentation reference. Direct instruction miss."
        ),
    },
)


def test_pilz_manual_miss_scores_low_on_instruction_following():
    """Pre-v2.4.0 behavior: 'find a manual' returns a diagnostic question.
    Judge must score instruction_following ≤2 (ideally 1)."""
    judge, env = _make_judge_with_keys()

    with patch.dict(os.environ, env, clear=False):
        with patch.object(judge, "_call_claude", return_value=_PILZ_MISS_JUDGE_RESPONSE):
            result = judge.grade(
                response=_PILZ_MANUAL_MISS_RESPONSE,
                rag_context="",
                user_question="Can you find a manual for this kind of distribution block?",
                generated_by="groq",
                scenario_id="pilz_manual_miss_11",
            )

    assert result.succeeded, f"Judge call failed: {result.error}"
    assert result.scores["instruction_following"] <= 2, (
        f"Pilz manual-miss response should score ≤2 on instruction_following, "
        f"got {result.scores['instruction_following']}"
    )


# ── Error handling ─────────────────────────────────────────────────────────────


def test_grade_returns_error_on_bad_json():
    judge, env = _make_judge_with_keys()
    with patch.dict(os.environ, env, clear=False):
        with patch.object(judge, "_call_claude", return_value="this is not json {{{{"):
            result = judge.grade(
                response="some response",
                rag_context="",
                user_question="what?",
                generated_by="groq",
                scenario_id="bad_json_test",
            )
    assert result.error is not None
    assert not result.succeeded


def test_grade_returns_error_when_no_provider_available():
    judge, _ = _make_judge_with_keys({"GROQ_API_KEY": "", "ANTHROPIC_API_KEY": ""})
    result = judge.grade(
        response="response",
        rag_context="",
        user_question="question",
        scenario_id="no_provider_test",
    )
    assert result.error is not None
    assert "No judge provider available" in result.error


def test_judge_result_average():
    jr = JudgeResult(
        scenario_id="test",
        judge_model="test-model",
        judge_provider="test-provider",
        scores={"groundedness": 4, "helpfulness": 5, "tone": 3, "instruction_following": 4},
    )
    assert jr.average == pytest.approx(4.0)
    assert jr.total == 16
    assert jr.succeeded


def test_judge_result_to_dict_is_serialisable():
    jr = JudgeResult(
        scenario_id="test",
        judge_model="test-model",
        judge_provider="test-provider",
        scores={"groundedness": 4, "helpfulness": 4, "tone": 4, "instruction_following": 4},
        notes={"groundedness": "ok", "helpfulness": "ok", "tone": "ok", "instruction_following": "ok"},
    )
    data = jr.to_dict()
    # Must round-trip through JSON cleanly
    assert json.loads(json.dumps(data))["scores"]["groundedness"] == 4
