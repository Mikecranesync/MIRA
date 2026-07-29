"""Test multi-turn equipment context prepending in _call_with_correction.

Tests that equipment context resolved in an active diagnostic session
is prepended to text-only follow-up queries but not photo follow-ups,
preventing the 0-chunk drop on bare text turns.
"""

import os
import sys

# Add mira-bots to path so imports work
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.engine import _prepend_equipment_context
from shared.fsm import ACTIVE_DIAGNOSTIC_STATES


def test_active_session_with_manufacturer_and_model():
    """Active state + high confidence + model → returns enriched query."""
    state = {
        "state": "Q1",
        "context": {
            "uns_context": {
                "manufacturer": "Rockwell",
                "model": "PowerFlex 525",
                "confidence": 0.9,
            }
        },
    }
    message = "Haven't meggered it yet"
    result = _prepend_equipment_context(message, state)
    assert result == "Rockwell PowerFlex 525 Haven't meggered it yet", f"Got: {result}"


def test_fault_code_included_in_precedence_order():
    """mfr -> model -> fault code -> message (#2209 Finding 4)."""
    state = {
        "state": "Q1",
        "context": {
            "uns_context": {
                "manufacturer": "Rockwell",
                "model": "PowerFlex 525",
                "fault_code": "F004",
                "confidence": 0.9,
            }
        },
    }
    assert _prepend_equipment_context("haven't meggered it", state) == (
        "Rockwell PowerFlex 525 F004 haven't meggered it"
    )


def test_active_alarm_used_when_no_fault_code():
    """Falls back to session_context.active_alarm when uns_context has no fault_code."""
    state = {
        "state": "DIAGNOSIS",
        "context": {
            "uns_context": {"manufacturer": "ABB", "confidence": 0.8},
            "session_context": {"active_alarm": "OV2"},
        },
    }
    assert _prepend_equipment_context("next step?", state) == "ABB OV2 next step?"


def test_fault_category_used_as_last_resort():
    """Falls back to state.fault_category when neither fault_code nor active_alarm exist."""
    state = {
        "state": "DIAGNOSIS",
        "fault_category": "overcurrent",
        "context": {"uns_context": {"manufacturer": "Yaskawa", "confidence": 0.75}},
    }
    assert _prepend_equipment_context("what now", state) == "Yaskawa overcurrent what now"


def test_no_duplicate_context_when_token_already_in_message():
    """A token already present in the message is not repeated."""
    state = {
        "state": "Q1",
        "context": {
            "uns_context": {
                "manufacturer": "Rockwell",
                "model": "PowerFlex 525",
                "fault_code": "F004",
                "confidence": 0.9,
            }
        },
    }
    result = _prepend_equipment_context("is the F004 still latched?", state)
    # F004 appears once (from the message), not twice.
    assert result.count("F004") == 1
    assert result == "Rockwell PowerFlex 525 is the F004 still latched?"


def test_active_session_with_manufacturer_no_model():
    """Active state + high confidence, no model → returns enriched query."""
    state = {
        "state": "Q2",
        "context": {
            "uns_context": {
                "manufacturer": "Siemens",
                "model": None,
                "confidence": 0.9,
            }
        },
    }
    message = "Voltage at the MCC bus"
    result = _prepend_equipment_context(message, state)
    assert result == "Siemens Voltage at the MCC bus", f"Got: {result}"


def test_idle_state_returns_unchanged():
    """IDLE session (non-active) → returns message unchanged."""
    state = {
        "state": "IDLE",
        "context": {
            "uns_context": {
                "manufacturer": "ABB",
                "model": "ACS880",
                "confidence": 0.9,
            }
        },
    }
    message = "Follow-up question"
    result = _prepend_equipment_context(message, state)
    assert result == message, f"Expected unchanged, got: {result}"


def test_low_confidence_returns_unchanged():
    """Confidence < 0.7 → returns message unchanged."""
    state = {
        "state": "Q1",
        "context": {
            "uns_context": {
                "manufacturer": "Magnetek",
                "model": "Impulse",
                "confidence": 0.5,  # Low
            }
        },
    }
    message = "Follow-up"
    result = _prepend_equipment_context(message, state)
    assert result == message, f"Expected unchanged, got: {result}"


def test_no_uns_context_returns_unchanged():
    """No uns_context → returns message unchanged."""
    state = {
        "state": "Q1",
        "context": {},
    }
    message = "Some question"
    result = _prepend_equipment_context(message, state)
    assert result == message, f"Expected unchanged, got: {result}"


def test_no_manufacturer_returns_unchanged():
    """No manufacturer in uns_context → returns message unchanged."""
    state = {
        "state": "Q1",
        "context": {
            "uns_context": {
                "manufacturer": None,
                "model": "PowerFlex 525",
                "confidence": 0.9,
            }
        },
    }
    message = "Question"
    result = _prepend_equipment_context(message, state)
    assert result == message, f"Expected unchanged, got: {result}"


def test_all_active_states_supported():
    """All ACTIVE_DIAGNOSTIC_STATES should trigger enrichment."""
    message = "Test follow-up"
    for state_name in ACTIVE_DIAGNOSTIC_STATES:
        state = {
            "state": state_name,
            "context": {
                "uns_context": {
                    "manufacturer": "TestMfr",
                    "model": "Model123",
                    "confidence": 0.9,
                }
            },
        }
        result = _prepend_equipment_context(message, state)
        expected = "TestMfr Model123 Test follow-up"
        assert result == expected, f"State {state_name}: expected {expected!r}, got {result!r}"


def test_edge_case_empty_model_string():
    """Empty-string model → skip model, use manufacturer only."""
    state = {
        "state": "Q1",
        "context": {
            "uns_context": {
                "manufacturer": "Yaskawa",
                "model": "",
                "confidence": 0.9,
            }
        },
    }
    message = "Question"
    result = _prepend_equipment_context(message, state)
    # Empty model should be skipped (falsy check)
    assert result == "Yaskawa Question", f"Got: {result}"


if __name__ == "__main__":
    # Quick sanity run
    test_active_session_with_manufacturer_and_model()
    test_active_session_with_manufacturer_no_model()
    test_idle_state_returns_unchanged()
    test_low_confidence_returns_unchanged()
    test_no_uns_context_returns_unchanged()
    test_no_manufacturer_returns_unchanged()
    test_all_active_states_supported()
    test_edge_case_empty_model_string()
    print("All tests pass!")
