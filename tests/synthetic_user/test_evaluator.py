"""Tests for evaluator.py — deterministic weakness classifier.

All tests are offline — no network calls, no LLM, no running services.
Data is constructed inline; no fixtures load files from disk.
"""

from __future__ import annotations

import pytest

from tests.synthetic_user.evaluator import (
    EvaluatedResult,
    QuestionResult,
    WeaknessCategory,
    evaluate,
    evaluate_batch,
    keyword_match_score,
)

# ---------------------------------------------------------------------------
# Helper: build a QuestionResult with sensible defaults
# ---------------------------------------------------------------------------


def _make_result(
    reply: str = (
        "Check the motor bearings for wear. Replace if vibration exceeds 0.5 in/s."
    ),
    confidence: str = "high",
    next_state: str | None = "DIAGNOSIS",
    path: str = "bot",
    sources: list[dict] | None = None,
    error: str | None = None,
    adversarial_category: str | None = None,
    expected_intent: str = "industrial",
    expected_weakness: str | None = None,
    ground_truth: dict | None = None,
    vendor: str = "Allen-Bradley",
    **kwargs,
) -> QuestionResult:
    """Return a QuestionResult with all required fields populated."""
    return QuestionResult(
        question_id=kwargs.get("question_id", "q-test-001"),
        question_text=kwargs.get("question_text", "How do I fix the motor?"),
        persona_id=kwargs.get("persona_id", "senior_tech"),
        topic_category=kwargs.get("topic_category", "troubleshooting"),
        adversarial_category=adversarial_category,
        equipment_type=kwargs.get("equipment_type", "motor"),
        vendor=vendor,
        expected_intent=expected_intent,
        expected_weakness=expected_weakness,
        ground_truth=ground_truth,
        path=path,
        reply=reply,
        confidence=confidence,
        next_state=next_state,
        sources=sources,
        latency_ms=kwargs.get("latency_ms", 120),
        error=error,
    )


# ---------------------------------------------------------------------------
# 1. Pass on good response
# ---------------------------------------------------------------------------


def test_pass_on_good_response() -> None:
    """A substantive, confident reply with no issues evaluates to PASS."""
    result = _make_result()
    ev = evaluate(result)
    assert ev.weakness == WeaknessCategory.PASS


# ---------------------------------------------------------------------------
# 2. Empty response detected
# ---------------------------------------------------------------------------


def test_empty_response_detected() -> None:
    """Empty reply string classifies as EMPTY_RESPONSE."""
    result = _make_result(reply="")
    ev = evaluate(result)
    assert ev.weakness == WeaknessCategory.EMPTY_RESPONSE


def test_short_response_detected() -> None:
    """Reply under 20 characters classifies as EMPTY_RESPONSE."""
    result = _make_result(reply="Check wiring.")  # 14 chars
    ev = evaluate(result)
    assert ev.weakness == WeaknessCategory.EMPTY_RESPONSE


# ---------------------------------------------------------------------------
# 3. Error detected
# ---------------------------------------------------------------------------


def test_error_detected() -> None:
    """A non-None error field classifies as EMPTY_RESPONSE."""
    result = _make_result(reply="", error="timeout")
    ev = evaluate(result)
    assert ev.weakness == WeaknessCategory.EMPTY_RESPONSE


# ---------------------------------------------------------------------------
# 4. Intent guard block
# ---------------------------------------------------------------------------


def test_intent_guard_block_detected() -> None:
    """IDLE state + canned MIRA greeting + expected_intent industrial → INTENT_GUARD_BLOCK."""
    canned = (
        "Hey -- I'm MIRA, your industrial maintenance assistant. "
        "I help maintenance technicians diagnose equipment problems. "
        "How can I help with your equipment today?"
    )
    result = _make_result(
        reply=canned,
        next_state="IDLE",
        expected_intent="industrial",
        path="bot",
    )
    ev = evaluate(result)
    assert ev.weakness == WeaknessCategory.INTENT_GUARD_BLOCK


def test_intent_guard_not_triggered_on_greeting() -> None:
    """Same canned MIRA greeting is PASS when expected_intent is 'greeting'."""
    canned = (
        "Hey -- I'm MIRA, your industrial maintenance assistant. "
        "I help maintenance technicians diagnose equipment problems. "
        "How can I help with your equipment today?"
    )
    result = _make_result(
        reply=canned,
        next_state="IDLE",
        expected_intent="greeting",
        path="bot",
    )
    ev = evaluate(result)
    # Not an industrial question, so the guard block check should NOT fire.
    # The reply is long enough to clear EMPTY_RESPONSE.
    assert ev.weakness != WeaknessCategory.INTENT_GUARD_BLOCK


# ---------------------------------------------------------------------------
# 5. Low confidence
# ---------------------------------------------------------------------------


def test_low_confidence_detected() -> None:
    """Reply with hedging language and no actionable terms → LOW_CONFIDENCE."""
    hedgy = (
        "It might be a bearing issue, but I'm not sure without more info. "
        "It could be possibly caused by vibration or misalignment. "
        "Hard to say exactly what the root cause is without inspection."
    )
    result = _make_result(reply=hedgy)
    ev = evaluate(result)
    assert ev.weakness == WeaknessCategory.LOW_CONFIDENCE


# ---------------------------------------------------------------------------
# 6. Hallucination
# ---------------------------------------------------------------------------


def test_hallucination_detected() -> None:
    """Ground truth provided, reply is long but has zero keyword overlap → HALLUCINATION."""
    gt = {
        "root_cause": "worn bearings",
        "fix": "replace bearings",
        "keywords": ["bearing", "vibration", "replace", "lubrication", "wear"],
    }
    # Fabricated-looking reply with none of the GT keywords
    fabricated = (
        "The primary concern here is voltage imbalance on the input supply. "
        "You should verify phase rotation with a meter and ensure the contactor "
        "coil resistance is within spec. The overload relay setpoint may need "
        "adjustment per the manufacturer's thermal curve documentation. "
        "Disconnect and re-energize the control cabinet after checking terminals."
    )
    result = _make_result(reply=fabricated, ground_truth=gt)
    ev = evaluate(result)
    assert ev.weakness == WeaknessCategory.HALLUCINATION


def test_hallucination_not_triggered_without_ground_truth() -> None:
    """Without ground_truth, a long reply with no keyword overlap is NOT hallucination."""
    fabricated = (
        "The primary concern here is voltage imbalance on the input supply. "
        "You should verify phase rotation with a meter and ensure the contactor "
        "coil resistance is within spec. The overload relay setpoint may need "
        "adjustment per the manufacturer's thermal curve documentation. "
        "Disconnect and re-energize the control cabinet after checking terminals."
    )
    result = _make_result(reply=fabricated, ground_truth=None)
    ev = evaluate(result)
    assert ev.weakness != WeaknessCategory.HALLUCINATION


# ---------------------------------------------------------------------------
# 7. Wrong manufacturer
# ---------------------------------------------------------------------------


def test_wrong_manufacturer_detected() -> None:
    """Sidecar path, AutomationDirect vendor, but source cites a PowerFlex manual → WRONG_MANUFACTURER."""
    sources = [
        {
            "file": "PowerFlex_525_Manual.pdf",
            "page": 42,
            "excerpt": "F004 fault code",
            "brain": "shared_oem",
        }
    ]
    result = _make_result(
        path="sidecar",
        vendor="AutomationDirect",
        sources=sources,
        reply=(
            "The fault code F004 indicates an overcurrent condition. "
            "Check the motor cable insulation and verify the drive current limit "
            "parameter is set correctly. De-energize before inspecting wiring."
        ),
    )
    ev = evaluate(result)
    assert ev.weakness == WeaknessCategory.WRONG_MANUFACTURER


def test_wrong_manufacturer_not_triggered_on_correct_sources() -> None:
    """Sources that match the question vendor do not trigger WRONG_MANUFACTURER."""
    sources = [
        {
            "file": "GS20_User_Manual.pdf",
            "page": 15,
            "excerpt": "OC fault",
            "brain": "shared_oem",
        }
    ]
    result = _make_result(
        path="sidecar",
        vendor="AutomationDirect",
        sources=sources,
        reply=(
            "The OC fault on the GS20 indicates an overcurrent condition. "
            "Check motor wiring, reduce acceleration rate, or increase the "
            "current limit parameter P3.05. De-energize before inspecting."
        ),
    )
    ev = evaluate(result)
    assert ev.weakness != WeaknessCategory.WRONG_MANUFACTURER


# ---------------------------------------------------------------------------
# 8. Safety false positive
# ---------------------------------------------------------------------------


def test_safety_false_positive_detected() -> None:
    """FSM raised SAFETY_ALERT but expected_intent is industrial → SAFETY_FALSE_POSITIVE."""
    result = _make_result(
        path="bot",
        next_state="SAFETY_ALERT",
        expected_intent="industrial",
        reply=(
            "STOP — describe the hazard. De-energize the equipment first. "
            "Do not proceed until the area is safe. Identify all energy sources "
            "and apply LOTO before any maintenance activity."
        ),
    )
    ev = evaluate(result)
    assert ev.weakness == WeaknessCategory.SAFETY_FALSE_POSITIVE


# ---------------------------------------------------------------------------
# 9. Out-of-KB hallucination
# ---------------------------------------------------------------------------


def test_out_of_kb_hallucination_detected() -> None:
    """Out-of-KB adversarial question + long confident reply + no honesty signal → OUT_OF_KB_HALLUCINATION."""
    # Fabricated confident reply about a vendor not in the KB.
    confident_hallucination = (
        "The Yaskawa V1000 fault E7 is caused by a DC bus overvoltage condition. "
        "Check that the braking resistor is connected and sized correctly. "
        "Set parameter C6-01 to match the deceleration ramp time. "
        "If the fault persists after adjusting parameters, inspect the IGBT module "
        "for carbon tracking and replace the DC bus capacitors as a matched set."
    )
    result = _make_result(
        reply=confident_hallucination,
        adversarial_category="out_of_kb",
        vendor="Yaskawa",
    )
    ev = evaluate(result)
    assert ev.weakness == WeaknessCategory.OUT_OF_KB_HALLUCINATION


def test_out_of_kb_honest_response_passes() -> None:
    """Out-of-KB adversarial question + honesty signal → PASS (correct behavior)."""
    honest = (
        "I don't have information about Yaskawa drives in my knowledge base. "
        "My documentation covers Allen-Bradley, AutomationDirect, Siemens, ABB, "
        "and Eaton equipment. For Yaskawa-specific guidance, please consult the "
        "Yaskawa technical documentation or contact their support."
    )
    result = _make_result(
        reply=honest,
        adversarial_category="out_of_kb",
        vendor="Yaskawa",
    )
    ev = evaluate(result)
    assert ev.weakness == WeaknessCategory.PASS


# ---------------------------------------------------------------------------
# 10. keyword_match_score helper
# ---------------------------------------------------------------------------


def test_keyword_match_score() -> None:
    """Direct test of the scoring helper with known inputs."""
    reply = "Check the motor bearings for wear and replace if vibration is excessive."
    keywords = ["bearing", "vibration", "replace", "lubrication"]

    score, matched = keyword_match_score(reply, keywords)

    # "bearing" (→ bearings), "vibration", "replace" match; "lubrication" does not
    assert "bearing" in matched
    assert "vibration" in matched
    assert "replace" in matched
    assert "lubrication" not in matched
    assert score == pytest.approx(3 / 4)


def test_keyword_match_score_empty_keywords() -> None:
    """Empty keyword list returns score 0.0 and empty matches."""
    score, matched = keyword_match_score("Some reply text", [])
    assert score == 0.0
    assert matched == []


# ---------------------------------------------------------------------------
# 11. evaluate_batch
# ---------------------------------------------------------------------------


def test_evaluate_batch() -> None:
    """evaluate_batch over 5 results returns exactly 5 EvaluatedResult objects."""
    results = [
        _make_result(question_id=f"q-{i:03d}") for i in range(5)
    ]
    evaluated = evaluate_batch(results)
    assert len(evaluated) == 5
    assert all(isinstance(ev, EvaluatedResult) for ev in evaluated)
    # All baseline results should pass
    assert all(ev.weakness == WeaknessCategory.PASS for ev in evaluated)
