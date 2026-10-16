"""Review finding 6: temporal current versus electrical current."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shared import guardrails  # noqa: E402


@pytest.mark.parametrize(
    "reply",
    [
        "Check current temperature.",
        "Check current speed.",
        "Check current position.",
        "Check the current temperature and speed.",
    ],
)
def test_current_describing_an_operating_quantity_is_not_electrical_current(reply):
    assert guardrails.ensure_action_safety_prerequisites(reply) == reply


@pytest.mark.parametrize(
    "reply",
    [
        "Measure motor current.",
        "Check current at the motor terminals.",
        "Test current with a clamp meter.",
        "Check current temperature and measure motor current.",
        "Check current speed and voltage at the motor terminals.",
        "Check current position. Measure current at the motor terminals.",
    ],
)
def test_operating_quantity_words_do_not_hide_actual_electrical_measurement(reply):
    output = guardrails.ensure_action_safety_prerequisites(reply)
    assert "qualified person" in output
    assert reply in output
