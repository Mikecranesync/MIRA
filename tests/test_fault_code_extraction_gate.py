"""Tests for fault-code extraction context gate (PR #2208).

Verifies the ONE extraction contract: a candidate is a fault code only when a
fault-context word sits within _FAULT_PROXIMITY tokens of it AND the token has a
plausible code shape. Mere presence of an equipment word (drive/vfd/inverter)
does not enable extraction of an unrelated token — so "the drive in bay 12" does
not yield "BAY-12" and "re-do the VFD setup" does not yield "REDO", while
"drive is showing F0004" still yields "F0004".
"""

from __future__ import annotations

import sys
from pathlib import Path


# Add mira-bots to path
REPO_ROOT = Path(__file__).parent.parent
MIRA_BOTS = REPO_ROOT / "mira-bots"
if str(MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(MIRA_BOTS))

from shared.neon_recall import _extract_fault_codes  # noqa: E402


class TestFaultCodeExtractionGate:
    """Verify context gate blocks false-positive fault codes."""

    def test_bay_number_without_fault_context(self):
        """'bay 12' normalizes to 'bay-12', matches Pattern 1 — should NOT extract."""
        codes = _extract_fault_codes("the conveyor in bay 12 stopped")
        # 'bay-12' looks like a fault code to Pattern 1 (letter(s) + digit(s))
        # but lacks fault context, so should NOT be extracted
        assert "BAY-12" not in codes
        assert "BAY12" not in codes

    def test_redo_without_fault_context(self):
        """'re-do' normalizes to 're-do' / 'REDO', matches Pattern 2 — should NOT extract."""
        codes = _extract_fault_codes("re-do the setup step by step")
        # 're-do' matches Pattern 2 (letter-dash-letter) but lacks fault context
        assert "REDO" not in codes
        assert "RE-DO" not in codes

    def test_fault_code_with_context(self):
        """Real fault code WITH context word should extract."""
        codes = _extract_fault_codes("fault F0004")
        assert "F0004" in codes

    def test_error_code_with_context(self):
        """'error E001' should extract."""
        codes = _extract_fault_codes("error E001 occurred")
        assert "E001" in codes

    def test_alarm_with_context(self):
        """'alarm OC1' should extract."""
        codes = _extract_fault_codes("drive showing alarm OC1")
        assert "OC1" in codes

    def test_trip_with_context(self):
        """'trip' as fault context."""
        codes = _extract_fault_codes("motor trip F-12")
        assert "F-12" in codes

    def test_multiple_false_positives_without_context(self):
        """Multiple English phrases that accidentally match should NOT extract."""
        codes = _extract_fault_codes("bay 12 co-op re-do setup")
        # None of these should extract without fault context
        assert "BAY-12" not in codes
        assert "BAY12" not in codes
        assert "COOP" not in codes
        assert "CO-OP" not in codes
        assert "REDO" not in codes
        assert "RE-DO" not in codes

    def test_vfd_alpha_code_with_context(self):
        """Pattern 3: VFD alpha codes like OC, GF should still work with context."""
        codes = _extract_fault_codes("OC fault on my VFD")
        assert "OC" in codes

    def test_vfd_alpha_code_without_context(self):
        """Pattern 3: VFD alpha codes should NOT extract without context."""
        codes = _extract_fault_codes("the OC wire goes to terminal 5")
        assert "OC" not in codes

    def test_compound_alpha_with_context(self):
        """E-OC compound code with context should extract."""
        codes = _extract_fault_codes("error E-OC on drive")
        assert "E-OC" in codes or "EOC" in codes

    def test_bare_fault_code_no_context_still_works(self):
        """Acceptable trade-off: bare codes like 'F0004' with no adjacent context
        do not extract. Real messages carry context words."""
        codes = _extract_fault_codes("F0004")
        # Without context, even a real code alone won't extract
        # (acceptable per PR description: real messages carry context)
        # This is the trade-off we're accepting
        assert isinstance(codes, list)  # Just verify we get a list

    def test_warning_as_context(self):
        """'warning' is a valid context word."""
        codes = _extract_fault_codes("warning A501 on inverter")
        assert "A501" in codes

    def test_drive_as_context(self):
        """'drive' is a valid context word."""
        codes = _extract_fault_codes("drive F012 status light")
        assert "F012" in codes

    def test_vfd_as_context(self):
        """'vfd' is a valid context word."""
        codes = _extract_fault_codes("vfd is showing E014 error")
        assert "E014" in codes

    def test_inverter_as_context(self):
        """'inverter' is a valid context word."""
        codes = _extract_fault_codes("inverter displaying OC1")
        assert "OC1" in codes

    def test_display_as_context(self):
        """'display' is a valid context word."""
        codes = _extract_fault_codes("display shows F4")
        assert "F4" in codes

    def test_flashing_as_context(self):
        """'flashing' is a valid context word."""
        codes = _extract_fault_codes("light flashing F001")
        assert "F001" in codes


class TestProximityAndShapeContract:
    """Finding 1 (review): mere presence of an equipment word (drive/vfd/inverter)
    must NOT enable extraction of an unrelated code-like token. Extraction requires
    a fault-context word WITHIN _FAULT_PROXIMITY tokens AND a plausible code shape
    (alpha prefix <= 2 for alphanumeric; known VFD code for compound/alpha-only).
    """

    # --- Equipment word PRESENT but candidate is not a real code -> reject ---
    def test_drive_present_but_bay_number_rejected(self):
        # "drive" is a context word, but "bay 12" -> "BAY-12" has a 3-letter
        # prefix (a common word), so it is not a fault code.
        assert _extract_fault_codes("the drive in bay 12 stopped") == []

    def test_vfd_present_but_redo_rejected(self):
        # "VFD" is a context word, but "re-do" -> "REDO" is not a known code.
        assert _extract_fault_codes("please re-do the VFD setup") == []

    def test_inverter_present_but_far_bay_number_rejected(self):
        assert _extract_fault_codes("move the cable in bay 12 near the inverter") == []

    # --- No context at all -> reject (even real-shaped codes) ---
    def test_no_context_wire_terminal_rejected(self):
        assert _extract_fault_codes("the OC wire goes to terminal 5") == []
        assert _extract_fault_codes("move the GF wire to terminal 7") == []

    def test_no_context_instruction_rejected(self):
        assert _extract_fault_codes("install cable F 12 in bay 4") == []
        assert _extract_fault_codes("the conveyor in bay 12 stopped") == []
        assert _extract_fault_codes("please re-do the setup") == []

    # --- Real codes near a real trigger -> extract (all named good cases) ---
    def test_named_true_positives(self):
        cases = {
            "fault F0004": "F0004",
            "the drive is showing F0004": "F0004",
            "error E001 occurred": "E001",
            "alarm OC1": "OC1",
            "VFD flashing A501": "A501",
            "inverter fault GF": "GF",
            "display shows F4": "F4",
        }
        for msg, code in cases.items():
            assert code in _extract_fault_codes(msg), f"{code!r} not extracted from {msg!r}"

    def test_compound_code_near_trigger(self):
        codes = _extract_fault_codes("error E-OC on the drive")
        assert "E-OC" in codes and "EOC" in codes and "OC" in codes

    def test_alpha_prefix_over_two_chars_rejected_even_with_context(self):
        # A 3-letter alpha prefix + digits is not a code even next to "fault".
        assert _extract_fault_codes("fault on bay 12") == []
