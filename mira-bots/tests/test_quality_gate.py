"""Unit tests for shared/quality_gate.py — heuristics + judge wrapper.

Pure functions and async wrappers. No network. The judge tests use
the existing mock_router fixture from conftest.py.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from shared import quality_gate
from shared.quality_gate import (
    GRACEFUL_FALLBACK,
    GateResult,
    _has_repeated_ngram,
    _has_repeated_substring,
    _is_mostly_ascii,
    evaluate,
    heuristic_check,
    is_known_fallback,
    llm_judge,
)


# ---------------------------------------------------------------------------
# heuristic_check — happy paths
# ---------------------------------------------------------------------------

class TestHeuristicHappyPath:
    def test_normal_diagnostic_reply_passes(self):
        text = (
            "Allen-Bradley PowerFlex 525 trip on F005 (UnderVoltage). "
            "Check the incoming line voltage with a meter and verify the "
            "DC bus capacitors are healthy. Reset the fault from the HIM "
            "after correcting the source."
        )
        passed, reasons = heuristic_check(text)
        assert passed is True
        assert reasons == []

    def test_short_acknowledgement_passes(self):
        passed, reasons = heuristic_check("Yes, that's correct.")
        assert passed is True
        assert reasons == []

    def test_reply_with_tab_and_newline_is_fine(self):
        text = "Steps:\n1. De-energize\n\t2. Lock out\n3. Verify zero energy"
        passed, reasons = heuristic_check(text)
        assert passed is True, reasons


# ---------------------------------------------------------------------------
# heuristic_check — failure modes
# ---------------------------------------------------------------------------

class TestHeuristicFailures:
    def test_empty_string_fails(self):
        passed, reasons = heuristic_check("")
        assert passed is False
        assert "empty_reply" in reasons

    def test_whitespace_only_fails(self):
        passed, reasons = heuristic_check("   \n\t   ")
        assert passed is False
        assert "empty_reply" in reasons

    def test_none_fails(self):
        passed, reasons = heuristic_check(None)  # type: ignore[arg-type]
        assert passed is False
        assert "empty_reply" in reasons

    def test_replacement_char_fails(self):
        passed, reasons = heuristic_check("This reply has a � replacement char in it.")
        assert passed is False
        assert "replacement_char" in reasons

    def test_repeated_ngram_fails(self):
        # Same 5-gram repeated 4 times — classic cascade-loop tell
        loop = "the motor is tripping again "
        text = loop * 4
        passed, reasons = heuristic_check(text)
        assert passed is False
        assert "repeated_ngram" in reasons

    def test_repeated_substring_fails(self):
        # Same 30-char substring repeated 4x
        chunk = "abcdefghij1234567890ABCDEFGHIJ"  # 30 chars
        text = chunk * 4
        passed, reasons = heuristic_check(text)
        assert passed is False
        assert "repeated_substring" in reasons

    def test_raw_json_leak_fails(self):
        text = '{"reply": "fix the motor", "next_state": "DIAGNOSIS"}'
        passed, reasons = heuristic_check(text)
        assert passed is False
        assert "raw_json_leak" in reasons

    def test_unbalanced_code_fence_fails(self):
        text = "Run this command:\n```bash\necho hello"
        passed, reasons = heuristic_check(text)
        assert passed is False
        assert "unbalanced_code_fence" in reasons

    def test_balanced_code_fence_passes(self):
        text = "Run this:\n```bash\necho hello\n```\nThen reset."
        passed, reasons = heuristic_check(text)
        assert passed is True, reasons

    def test_too_long_fails(self):
        text = "x" * (quality_gate.MAX_REPLY_CHARS + 100)
        passed, reasons = heuristic_check(text)
        assert passed is False
        assert any(r.startswith("too_long_") for r in reasons)

    def test_control_char_garble_fails(self):
        # A run of NUL bytes is the most common garble signature
        text = "Hello" + "\x00" * 50 + "world"
        passed, reasons = heuristic_check(text)
        assert passed is False
        assert "control_char_ratio" in reasons

    def test_non_ascii_majority_fails_for_long_replies(self):
        # 60 chars, mostly box-drawing — looks corrupted
        text = "█" * 60
        passed, reasons = heuristic_check(text)
        assert passed is False
        assert "non_ascii_majority" in reasons

    def test_short_non_ascii_passes_under_cutoff(self):
        # Below the 50-char cutoff we don't apply the ASCII check
        text = "█████"  # only 5 chars
        _, reasons = heuristic_check(text)
        # short non-ASCII shouldn't trip the language check
        assert "non_ascii_majority" not in reasons


# ---------------------------------------------------------------------------
# Helper internals — guard against accidental rule loosening
# ---------------------------------------------------------------------------

class TestInternals:
    def test_repeated_ngram_threshold_is_strict(self):
        # 3 repeats == at threshold, must NOT fail
        loop = "alpha beta gamma delta epsilon "
        assert _has_repeated_ngram(loop * 3) is False
        # 4 repeats trips it
        assert _has_repeated_ngram(loop * 4) is True

    def test_repeated_substring_threshold_is_strict(self):
        chunk = "0123456789abcdefghij0123456789"  # 30 chars
        assert _has_repeated_substring(chunk * 3) is False
        assert _has_repeated_substring(chunk * 4) is True

    def test_is_mostly_ascii_with_unit_symbols(self):
        # ° and µ should not trip ASCII detection on a normal English sentence
        text = "Bearing temperature is 78°C and motor draws 12.4µA at idle."
        assert _is_mostly_ascii(text) is True

    def test_is_mostly_ascii_with_garbled_text(self):
        text = "█▓▒░ ▓▒░█ ▒░█▓ ░█▓▒ ▒░█▓"
        assert _is_mostly_ascii(text) is False


# ---------------------------------------------------------------------------
# is_known_fallback — bypass for trusted strings
# ---------------------------------------------------------------------------

class TestKnownFallback:
    def test_exact_match_bypasses(self):
        skip = {"Generic engine error message."}
        assert is_known_fallback("Generic engine error message.", skip) is True

    def test_with_surrounding_whitespace_bypasses(self):
        skip = {"Generic engine error message."}
        assert is_known_fallback("  Generic engine error message.  ", skip) is True

    def test_unrelated_text_does_not_bypass(self):
        skip = {"Generic engine error message."}
        assert is_known_fallback("Different reply", skip) is False


# ---------------------------------------------------------------------------
# evaluate() — async public API
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestEvaluate:
    async def test_clean_reply_returns_pass(self):
        result = await evaluate("This is a perfectly fine diagnostic reply.")
        assert isinstance(result, GateResult)
        assert result.verdict == "pass"
        assert result.reasons == []
        assert result.elapsed_ms >= 0.0

    async def test_garbled_reply_returns_fail(self):
        result = await evaluate("hello \x00\x00\x00\x00\x00\x00\x00\x00\x00\x00 world")
        assert result.verdict == "fail"
        assert "control_char_ratio" in result.reasons

    async def test_skip_strings_bypass_gate(self):
        # Even a "fail" string is allowed through if it's in the trusted set
        result = await evaluate(
            "{\"reply\": \"this would normally leak\"}",
            skip_strings={"{\"reply\": \"this would normally leak\"}"},
        )
        assert result.verdict == "pass"
        assert "skip_known_fallback" in result.reasons

    async def test_judge_disabled_by_default(self, mock_router):
        # use_judge=False should NOT call the router
        mock_router.complete = AsyncMock(return_value=("", {}))
        result = await evaluate(
            "A normal reply.",
            user_message="hello",
            router=mock_router,
            use_judge=False,
        )
        assert result.verdict == "pass"
        assert result.judge_score is None
        assert mock_router.complete.await_count == 0

    async def test_judge_low_score_fails(self, mock_router):
        mock_router.complete = AsyncMock(
            return_value=('{"score": 0.1, "reason": "off topic"}', {}),
        )
        result = await evaluate(
            "A long enough reply that triggers the judge call.",
            user_message="my motor tripped",
            router=mock_router,
            use_judge=True,
        )
        assert result.verdict == "fail"
        assert result.judge_score == 0.1
        assert result.judge_reason == "off topic"

    async def test_judge_high_score_passes(self, mock_router):
        mock_router.complete = AsyncMock(
            return_value=('{"score": 0.9, "reason": "good"}', {}),
        )
        result = await evaluate(
            "A long enough reply that triggers the judge call.",
            user_message="my motor tripped",
            router=mock_router,
            use_judge=True,
        )
        assert result.verdict == "pass"
        assert result.judge_score == 0.9

    async def test_judge_garbled_response_does_not_block(self, mock_router):
        # Judge returns junk → gate must not fail-close
        mock_router.complete = AsyncMock(return_value=("not json at all", {}))
        result = await evaluate(
            "A normal reply.",
            user_message="hello",
            router=mock_router,
            use_judge=True,
        )
        assert result.verdict == "pass"
        assert result.judge_score is None

    async def test_judge_router_disabled_skips_judge(self, mock_router_disabled):
        result = await evaluate(
            "A normal reply.",
            user_message="hello",
            router=mock_router_disabled,
            use_judge=True,
        )
        assert result.verdict == "pass"
        assert result.judge_score is None

    async def test_judge_router_none_skips_judge(self):
        result = await evaluate(
            "A normal reply.",
            user_message="hello",
            router=None,
            use_judge=True,
        )
        assert result.verdict == "pass"
        assert result.judge_score is None


# ---------------------------------------------------------------------------
# llm_judge() — direct
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestLLMJudge:
    async def test_parses_clean_json(self, mock_router):
        mock_router.complete = AsyncMock(
            return_value=('{"score": 0.85, "reason": "ok"}', {}),
        )
        score, reason = await llm_judge("hi", "reply", mock_router)
        assert score == 0.85
        assert reason == "ok"

    async def test_extracts_json_from_chatty_response(self, mock_router):
        mock_router.complete = AsyncMock(
            return_value=(
                'Here is my verdict: {"score": 0.7, "reason": "fine"} thanks',
                {},
            ),
        )
        score, reason = await llm_judge("hi", "reply", mock_router)
        assert score == 0.7
        assert reason == "fine"

    async def test_clamps_out_of_range_score(self, mock_router):
        mock_router.complete = AsyncMock(
            return_value=('{"score": 1.5, "reason": "x"}', {}),
        )
        score, _ = await llm_judge("hi", "reply", mock_router)
        assert score == 1.0

    async def test_returns_none_on_router_exception(self, mock_router):
        mock_router.complete = AsyncMock(side_effect=RuntimeError("boom"))
        score, reason = await llm_judge("hi", "reply", mock_router)
        assert score is None
        assert reason is None


# ---------------------------------------------------------------------------
# Constants surface — guard against accidental breaking changes
# ---------------------------------------------------------------------------

def test_graceful_fallback_is_user_facing_text():
    # Sanity: fallback is non-empty plain text, no JSON / template artifacts
    assert isinstance(GRACEFUL_FALLBACK, str)
    assert len(GRACEFUL_FALLBACK) > 30
    assert "{" not in GRACEFUL_FALLBACK
    assert "}" not in GRACEFUL_FALLBACK


def test_is_enabled_default_is_on(monkeypatch):
    monkeypatch.delenv("QUALITY_GATE_ENABLED", raising=False)
    assert quality_gate.is_enabled() is True


def test_is_enabled_off_when_set_to_zero(monkeypatch):
    monkeypatch.setenv("QUALITY_GATE_ENABLED", "0")
    assert quality_gate.is_enabled() is False
