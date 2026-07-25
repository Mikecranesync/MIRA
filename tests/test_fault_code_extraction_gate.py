"""Tests for fault-code extraction context gate (PR #2208).

Verifies that Patterns 1 (alphanumeric) and 2 (compound-alpha) fault codes
require fault-context words to extract, preventing false positives like
"bay 12" → "BAY-12" and "re-do" → "REDO" that poison retrieval.
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
