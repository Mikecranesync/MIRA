"""Unit tests for Firecrawl contact enrichment in hunt.py."""
from __future__ import annotations

import hunt
import pytest


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
