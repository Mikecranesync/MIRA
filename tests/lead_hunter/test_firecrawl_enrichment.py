"""Unit tests for Firecrawl contact enrichment in hunt.py."""
from __future__ import annotations

import sys
from pathlib import Path

# Make tools/lead-hunter importable
REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "tools" / "lead-hunter"))

import pytest  # noqa: E402

import hunt  # noqa: E402


class TestIsRealName:
    """_is_real_name filters out generic / non-person values."""

    @pytest.mark.parametrize("value", [
        "", "   ", None,
        "info", "Info", "INFO",
        "contact", "Contact Us",
        "team", "Team", "Our Team",
        "staff", "Support", "sales",
        "admin", "webmaster",
        "john",  # single word, no surname
        "JOHN SMITH",  # all caps suggests heading not name
    ])
    def test_rejects_generic(self, value):
        assert hunt._is_real_name(value) is False

    @pytest.mark.parametrize("value", [
        "Bob Smith",
        "Mary Ann Lee",
        "Jean-Luc Picard",
        "Robert Jr Jones",
        "María González",
    ])
    def test_accepts_real_names(self, value):
        assert hunt._is_real_name(value) is True
