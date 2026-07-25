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
