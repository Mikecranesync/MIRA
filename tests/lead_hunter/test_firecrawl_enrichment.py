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


class TestEnrichFacilitiesOrchestrator:
    """enrich_facilities calls Firecrawl first, then regex, then dedupes."""

    def test_dedupe_across_sources(self):
        """Same person found by Firecrawl AND regex appears once in contacts."""
        fac = hunt.Facility(
            name="Acme Widgets",
            city="Lake Wales",
            website="https://acme.com",
            icp_score=12,
        )
        firecrawl_contacts = [
            {"name": "Bob Smith", "title": "Maintenance Manager",
             "email": "bob@acme.com", "linkedin_url": "",
             "source": "https://acme.com", "confidence": "firecrawl-team-page"},
        ]
        regex_contacts_from_site = {
            "emails": ["info@acme.com"],
            "phones": ["555-0100"],
            "contacts": [
                {"name": "Bob Smith", "title": "Maintenance Manager",
                 "source": "https://acme.com/about"},
            ],
            "vfd_hit": False,
            "text": "",
        }

        with patch("hunt.enrich_via_firecrawl",
                   return_value=firecrawl_contacts), \
             patch("hunt.scrape_site",
                   return_value=regex_contacts_from_site):
            hunt.enrich_facilities(
                [fac], serper_key="", fc_key="fake-fc-key",
                budget=500, firecrawl_budget=50,
            )

        names = [c["name"] for c in fac.contacts]
        assert names.count("Bob Smith") == 1, (
            f"Bob Smith deduped incorrectly: {names}"
        )
        # info@ email should still be appended as a separate no-name contact
        emails = [c.get("email") for c in fac.contacts if c.get("email")]
        assert "info@acme.com" in emails


class TestHubSpotQualityGate:
    """push_to_hubspot skips contacts with generic / missing names."""

    def test_skips_generic_names(self, monkeypatch):
        """Contact with name='info' is skipped but company + deal still push."""
        fac = hunt.Facility(
            name="Widget Co", city="Lake Wales", website="https://widget.co",
            icp_score=12,
        )
        fac.contacts = [
            {"name": "Info", "email": "info@widget.co",
             "source": "", "confidence": "website-direct"},
            {"name": "Bob Smith", "title": "Maintenance Manager",
             "email": "bob@widget.co", "source": "",
             "confidence": "firecrawl-team-page"},
        ]

        calls: list[str] = []

        def fake_post(self, url, **_kw):
            calls.append(url)
            return httpx.Response(200, json={"id": "fake-id"})

        def fake_get(self, url, **_kw):
            return httpx.Response(404, json={})

        monkeypatch.setattr("hunt.httpx.Client.post", fake_post)
        monkeypatch.setattr("hunt.httpx.Client.get", fake_get)

        stats = hunt.push_to_hubspot([fac], "fake-token")

        # Exactly one contact should have been created (Bob Smith)
        assert stats["contacts_created"] == 1, stats
        # Still creates the company (generic email doesn't block that)
        assert stats["companies_created"] >= 1


class TestUnverifiedCsv:
    """write_unverified_csv writes only no-name contacts, without name column."""

    def test_writes_only_unverified_rows(self, tmp_path):
        fac = hunt.Facility(
            name="Acme", city="Lake Wales", website="https://acme.com",
            icp_score=12,
        )
        fac.contacts = [
            {"name": "Bob Smith", "email": "bob@acme.com",
             "source": "", "confidence": "firecrawl-team-page"},
            {"name": "", "email": "info@acme.com",
             "source": "https://acme.com", "confidence": "website-direct"},
            {"name": "Info", "email": "",
             "source": "", "confidence": "website-direct"},
        ]
        out = tmp_path / "unverified.csv"
        count = hunt.write_unverified_csv([fac], out)
        # Only row 2 (no-name with email) should be written.
        # Row 1 is skipped (Bob Smith is real name → passed real-name gate).
        # Row 3 is skipped (no email AND no phone → no contact details).
        assert count == 1
        content = out.read_text(encoding="utf-8")
        assert "Bob Smith" not in content  # real-name contacts excluded
        assert "info@acme.com" in content
        # Header should not contain a first/last name column
        header = content.splitlines()[0]
        assert "First Name" not in header
        assert "Last Name" not in header
