"""Snippet-parser name-quality gate tests.

Covers `_is_real_name` and its interaction with `_TITLE_SNIPPET_RE` in
tools/lead-hunter/hunt.py. Origin incident: 2026-04-22 Central Florida
re-probe run captured 6 noise rows like "Apply to Utility Manager" and
"Pressure Washing Program GM" that looked like names because they happen
to be capitalized tokens followed by a maintenance-manager title.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_HUNT_PATH = Path(__file__).resolve().parents[2] / "tools" / "lead-hunter" / "hunt.py"
_spec = importlib.util.spec_from_file_location("hunt", _HUNT_PATH)
hunt = importlib.util.module_from_spec(_spec)
sys.modules["hunt"] = hunt
_spec.loader.exec_module(hunt)


class TestIsRealName:
    @pytest.mark.parametrize(
        "value",
        [
            "Carlos Quinones",
            "Brad Mincey",
            "Nils Goddard",
            "Eric Vogt",
            "Daniel Boynton",
            "Vernon Prevatt",
            "Warren Chandler CMRP",  # credentialed
            "Mary Jo Smith-Jones",  # multi-part
        ],
    )
    def test_accepts_real_names(self, value: str) -> None:
        assert hunt._is_real_name(value) is True

    @pytest.mark.parametrize(
        "value",
        [
            # Observed in 2026-04-22 run
            "Apply to Utility Manager",
            "from the Facility Manager",
            "Pressure Washing Program GM",
            "to Field Service Technician",
            # Single-token rejects
            "John",
            "Smith",
            # Generic tokens
            "Info",
            "Contact Us",
            "Our Team",
            # All-caps headings
            "CONTACT US",
            "JOHN SMITH",
            # Empty / whitespace
            "",
            "   ",
            None,
        ],
    )
    def test_rejects_noise(self, value: str | None) -> None:
        assert hunt._is_real_name(value) is False


class TestTitleSnippetInteraction:
    """End-to-end: regex parses snippet, _is_real_name filters noise."""

    def _extract(self, snippet: str) -> list[str]:
        """Mimic the search_contacts_via_serper loop's name extraction."""
        names: list[str] = []
        for m in hunt._TITLE_SNIPPET_RE.finditer(snippet):
            name = m.group(1).strip()
            if hunt._is_real_name(name):
                names.append(name)
        return names

    def test_real_contact_snippet_passes(self) -> None:
        # Typical LinkedIn-snippet shape
        snippet = "Carlos Quinones - Plant Manager at Toho Water Authority"
        assert self._extract(snippet) == ["Carlos Quinones"]

    def test_cta_snippet_filtered(self) -> None:
        snippet = "Apply to Maintenance Manager jobs at our Florida plant"
        assert self._extract(snippet) == []

    def test_prose_fragment_filtered(self) -> None:
        snippet = "...instructions from the Facility Manager in charge..."
        assert self._extract(snippet) == []

    def test_all_observed_noise_rejected(self) -> None:
        """The 6 exact noise strings from the 2026-04-22 run must all be filtered."""
        observed_noise = [
            "Apply to Utility Manager - Maintenance Manager",
            "from the Facility Manager - Maintenance Manager",
            "Pressure Washing Program GM - Maintenance Manager",
            "to Field Service Technician - Maintenance Manager",
        ]
        for snippet in observed_noise:
            assert self._extract(snippet) == [], (
                f"Noise leaked through filter: {snippet!r}"
            )
