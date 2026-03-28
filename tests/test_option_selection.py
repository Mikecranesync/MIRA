"""Unit tests for numbered option selection resolution.

Covers resolve_option_selection() in guardrails.py — the fix for users
replying "1" or "1." to numbered menus and getting the greeting instead
of continuing the diagnostic flow.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Add mira-bots to path for imports
REPO_ROOT = Path(__file__).parent.parent
MIRA_BOTS = REPO_ROOT / "mira-bots"
if str(MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(MIRA_BOTS))

from shared.guardrails import classify_intent, resolve_option_selection

OPTIONS = ["Setting up Modbus communication on a PF525",
           "Configuring a digital output on a PF525",
           "Using a digital output to signal Modbus status",
           "Something else entirely"]


class TestResolveOptionSelection:
    """Test resolve_option_selection() parsing and bounds."""

    def test_single_digit(self):
        assert resolve_option_selection("1", OPTIONS) == OPTIONS[0]

    def test_digit_with_period(self):
        assert resolve_option_selection("1.", OPTIONS) == OPTIONS[0]

    def test_digit_with_whitespace(self):
        assert resolve_option_selection("  2  ", OPTIONS) == OPTIONS[1]

    def test_digit_period_whitespace(self):
        assert resolve_option_selection(" 3. ", OPTIONS) == OPTIONS[2]

    def test_fourth_option(self):
        assert resolve_option_selection("4", OPTIONS) == OPTIONS[3]

    def test_out_of_range_high(self):
        assert resolve_option_selection("5", OPTIONS) is None

    def test_zero_not_valid(self):
        assert resolve_option_selection("0", OPTIONS) is None

    def test_text_not_selection(self):
        assert resolve_option_selection("hello", OPTIONS) is None

    def test_empty_message(self):
        assert resolve_option_selection("", OPTIONS) is None

    def test_empty_options(self):
        assert resolve_option_selection("1", []) is None

    def test_multi_digit(self):
        many = [f"Option {i}" for i in range(1, 12)]
        assert resolve_option_selection("10", many) == "Option 10"

    def test_sentence_not_selection(self):
        assert resolve_option_selection("1 is my choice", OPTIONS) is None

    def test_negative_number(self):
        assert resolve_option_selection("-1", OPTIONS) is None


class TestSelectionBypassesGreeting:
    """Verify that expanded option text classifies as 'industrial', not 'greeting'."""

    def test_expanded_modbus_is_industrial(self):
        expanded = resolve_option_selection("1", OPTIONS)
        assert expanded is not None
        intent = classify_intent(expanded)
        assert intent == "industrial"

    def test_raw_1_is_greeting(self):
        """Confirm the original bug: '1' alone classifies as greeting."""
        assert classify_intent("1") == "greeting"
        assert classify_intent("1.") == "greeting"

    def test_expanded_wiring_is_industrial(self):
        wiring_options = [
            "Physical wiring of the Modbus connection",
            "Which parameters to configure",
            "Getting the drive to show up on the network",
            "Troubleshooting an existing Modbus setup",
        ]
        expanded = resolve_option_selection("1", wiring_options)
        assert expanded is not None
        intent = classify_intent(expanded)
        assert intent == "industrial"
