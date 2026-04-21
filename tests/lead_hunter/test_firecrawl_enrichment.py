"""Unit tests for Firecrawl contact enrichment in hunt.py."""
from __future__ import annotations

from unittest.mock import patch

import httpx
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


def _mock_firecrawl_response(contacts: list[dict]) -> httpx.Response:
    """Build a canned Firecrawl v1/scrape success response."""
    return httpx.Response(
        status_code=200,
        json={
            "success": True,
            "data": {
                "json": {
                    "contacts": contacts,
                    "emails": [],
                    "phones": [],
                },
                "metadata": {"statusCode": 200},
            },
        },
    )


class TestEnrichViaFirecrawl:
    """enrich_via_firecrawl returns structured contacts from Firecrawl."""

    def test_happy_path_returns_filtered_contacts(self):
        """Firecrawl returns 3 people; only maintenance-adjacent ones pass."""
        raw = [
            {"name": "Bob Smith", "title": "Maintenance Manager",
             "email": "bob@acme.com", "linkedin_url": ""},
            {"name": "Alice Jones", "title": "CEO",  # not maintenance — filtered
             "email": "alice@acme.com", "linkedin_url": ""},
            {"name": "Carl Ortiz", "title": "Plant Manager",
             "email": "", "linkedin_url": "https://linkedin.com/in/carl"},
        ]
        budget = {"remaining": 10}
        mock_response = _mock_firecrawl_response(raw)

        with patch("hunt.httpx.Client.post", return_value=mock_response):
            client = httpx.Client()
            results = hunt.enrich_via_firecrawl(
                "https://acme.com", client, "fake-fc-key", budget,
            )

        names = {c["name"] for c in results}
        assert names == {"Bob Smith", "Carl Ortiz"}
        assert all(c["confidence"] == "firecrawl-team-page" for c in results)
        assert all(c["source"].startswith("https://acme.com") for c in results)

    def test_auth_failure_returns_empty(self):
        """Firecrawl 401 returns []; does not raise."""
        mock_response = httpx.Response(
            status_code=401,
            json={"error": "Unauthorized"},
        )
        budget = {"remaining": 5}
        with patch("hunt.httpx.Client.post", return_value=mock_response):
            client = httpx.Client()
            results = hunt.enrich_via_firecrawl(
                "https://acme.com", client, "bad-key", budget,
            )
        assert results == []
        assert budget["remaining"] == 4  # still counted (HTTP call was made)

    def test_zero_budget_skips_http(self):
        """budget.remaining == 0 → no HTTP call, returns [] immediately."""
        budget = {"remaining": 0}
        with patch("hunt.httpx.Client.post") as mock_post:
            client = httpx.Client()
            results = hunt.enrich_via_firecrawl(
                "https://acme.com", client, "fake-key", budget,
            )
        assert results == []
        mock_post.assert_not_called()

    def test_empty_url_returns_empty(self):
        """Empty URL returns [] without calling Firecrawl."""
        budget = {"remaining": 10}
        with patch("hunt.httpx.Client.post") as mock_post:
            client = httpx.Client()
            results = hunt.enrich_via_firecrawl("", client, "fake-key", budget)
        assert results == []
        mock_post.assert_not_called()
        assert budget["remaining"] == 10
