"""Unit tests for numbered option selection resolution.

Covers resolve_option_selection() in guardrails.py — the fix for users
replying "2 again", "option 2", "2 - yes" and getting the greeting instead
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

from shared.guardrails import classify_intent, resolve_option_selection  # noqa: E402

OPTIONS = [
    "Setting up Modbus communication on a PF525",
    "Configuring a digital output on a PF525",
    "Using a digital output to signal Modbus status",
    "Something else entirely",
]


class TestResolveOptionSelection:
    """Test resolve_option_selection() parsing and bounds."""

    # --- Required spec cases ---

    def test_bare_number(self):
        """'2' with 3 options → returns option[1]"""
        assert resolve_option_selection("2", OPTIONS) == OPTIONS[1]

    def test_number_with_period(self):
        """'2.' → returns option[1]"""
        assert resolve_option_selection("2.", OPTIONS) == OPTIONS[1]

    def test_option_prefix(self):
        """'option 2' → returns option[1]"""
        assert resolve_option_selection("option 2", OPTIONS) == OPTIONS[1]

    def test_number_with_short_filler(self):
        """'2 again' → returns option[1] (the reported bug)"""
        assert resolve_option_selection("2 again", OPTIONS) == OPTIONS[1]

    def test_number_with_dash(self):
        """'2 - yes' → returns option[1]"""
        assert resolve_option_selection("2 - yes", OPTIONS) == OPTIONS[1]

    def test_number_with_elaboration(self):
        """'2 - yes the motor hums and vibrates when I press start' → concatenated"""
        msg = "2 - yes the motor hums and vibrates when I press start"
        result = resolve_option_selection(msg, OPTIONS)
        assert result is not None
        assert result.startswith(OPTIONS[1])
        assert "yes the motor hums and vibrates when I press start" in result

    def test_out_of_bounds(self):
        """'25' with 3 options → returns None"""
        assert resolve_option_selection("25", OPTIONS[:3]) is None

    def test_not_a_number(self):
        """'hello' → returns None"""
        assert resolve_option_selection("hello", OPTIONS) is None

    def test_zero_index(self):
        """'0' with 3 options → returns None (1-indexed)"""
        assert resolve_option_selection("0", OPTIONS[:3]) is None

    # --- Backward-compatible baseline cases ---

    def test_single_digit(self):
        assert resolve_option_selection("1", OPTIONS) == OPTIONS[0]

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

    def test_negative_number(self):
        assert resolve_option_selection("-1", OPTIONS) is None

    # --- Elaboration boundary ---

    def test_remainder_exactly_at_boundary(self):
        """Remainder of exactly 19 chars (< 20) → bare option returned."""
        # "2 " + 19-char suffix — "2 " is consumed by regex, remainder = 19 chars
        msg = "2 " + "x" * 19
        result = resolve_option_selection(msg, OPTIONS)
        assert result == OPTIONS[1]

    def test_remainder_at_boundary_long(self):
        """Remainder of exactly 20 chars → concatenated with option."""
        msg = "2 " + "x" * 20
        result = resolve_option_selection(msg, OPTIONS)
        assert result is not None
        assert result == f"{OPTIONS[1]} — {'x' * 20}"

    def test_option_prefix_case_insensitive(self):
        """'OPTION 2' (uppercase) → returns option[1]"""
        assert resolve_option_selection("OPTION 2", OPTIONS) == OPTIONS[1]

    def test_number_with_colon(self):
        """'2:' → returns option[1]"""
        assert resolve_option_selection("2:", OPTIONS) == OPTIONS[1]

    def test_number_with_paren(self):
        """'2)' → returns option[1]"""
        assert resolve_option_selection("2)", OPTIONS) == OPTIONS[1]


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

    def test_option_prefix_expands_to_industrial(self):
        """'option 1' prefix form also expands correctly."""
        expanded = resolve_option_selection("option 1", OPTIONS)
        assert expanded == OPTIONS[0]
        assert classify_intent(expanded) == "industrial"

    def test_short_filler_expands_to_industrial(self):
        """'2 again' expands and classifies as industrial (the reported bug)."""
        expanded = resolve_option_selection("2 again", OPTIONS)
        assert expanded == OPTIONS[1]
        assert classify_intent(expanded) == "industrial"
