"""Tests for the manual-discovery HTTP endpoint.

These tests construct a minimal FastAPI app with ONLY the manual_discovery
router — never importing ask_api.app (which builds the heavy Supervisor
engine at import time). search_manual is monkeypatched at the ask_api.
manual_discovery module reference (where the router looks it up) so no live
Serper/network call is ever made.
"""

import asyncio

from fastapi import FastAPI
from fastapi.testclient import TestClient

from ask_api.manual_discovery import is_oem_host, router as manual_discovery_router


def _client() -> TestClient:
    """Create a minimal app with only the manual_discovery router.

    Avoids importing ask_api.app, which constructs the Supervisor engine.
    """
    app = FastAPI()
    app.include_router(manual_discovery_router)
    return TestClient(app)


_VALIDATED_CANDIDATE = {
    "url": "https://literature.rockwellautomation.com/idc/groups/literature/documents/um/525-um001.pdf",
    "title": "PowerFlex 525 Adjustable Frequency AC Drive User Manual",
    "host": "literature.rockwellautomation.com",
    "score": 145,
    "doc_type": "user_manual",
    "is_direct_pdf": True,
    "validated": True,
}

_UNVALIDATED_CANDIDATE = {
    "url": "https://example-reseller.com/manuals/525.pdf",
    "title": "PowerFlex 525 manual",
    "host": "example-reseller.com",
    "score": 40,
    "doc_type": "installation_manual",
    "is_direct_pdf": True,
    "validated": False,
}


class TestManualDiscoverySearchBasic:
    """Core discovery functionality."""

    def test_validated_oem_result(self, monkeypatch):
        """A validated OEM candidate reports found/validated/is_direct_pdf/oem_host all True."""

        async def fake_search_manual(make, model):
            assert make == "Rockwell Automation"
            assert model == "525"
            return dict(_VALIDATED_CANDIDATE)

        monkeypatch.setattr("ask_api.manual_discovery.search_manual", fake_search_manual)
        client = _client()
        resp = client.post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["found"] is True
        assert body["validated"] is True
        assert body["is_direct_pdf"] is True
        assert body["oem_host"] is True
        assert body["reason"] == "ok"
        assert body["candidate"]["url"] == _VALIDATED_CANDIDATE["url"]

    def test_unvalidated_candidate_signals_no_auto_import(self, monkeypatch):
        """An unvalidated candidate is still returned (found=True) but validated=False —
        the caller must be able to tell it must NOT auto-import this link."""

        async def fake_search_manual(make, model):
            return dict(_UNVALIDATED_CANDIDATE)

        monkeypatch.setattr("ask_api.manual_discovery.search_manual", fake_search_manual)
        client = _client()
        resp = client.post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["found"] is True
        assert body["validated"] is False

    def test_no_result_returns_honest_miss(self, monkeypatch):
        """search_manual returning None -> found=False, candidate=None, reason=no_result."""

        async def fake_search_manual(make, model):
            return None

        monkeypatch.setattr("ask_api.manual_discovery.search_manual", fake_search_manual)
        client = _client()
        resp = client.post(
            "/manual-discovery/search",
            json={"manufacturer": "AcmeCo", "model": "Blender9000"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["found"] is False
        assert body["candidate"] is None
        assert body["reason"] == "no_result"

    def test_never_fabricates_url_on_no_candidate(self, monkeypatch):
        """No candidate anywhere in the response when search_manual returns None."""

        async def fake_search_manual(make, model):
            return None

        monkeypatch.setattr("ask_api.manual_discovery.search_manual", fake_search_manual)
        client = _client()
        resp = client.post(
            "/manual-discovery/search",
            json={"manufacturer": "AcmeCo", "model": "Blender9000"},
        )
        body = resp.json()
        assert body["candidate"] is None


class TestManualDiscoverySearchValidation:
    """Request validation."""

    def test_missing_required_fields_returns_422(self):
        client = _client()
        resp = client.post("/manual-discovery/search", json={"manufacturer": "Rockwell"})
        assert resp.status_code == 422

    def test_oversized_field_returns_422(self):
        client = _client()
        resp = client.post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell", "model": "x" * 500},
        )
        assert resp.status_code == 422

    def test_blank_manufacturer_returns_422_or_invalid_query(self):
        client = _client()
        resp = client.post(
            "/manual-discovery/search",
            json={"manufacturer": "", "model": "525"},
        )
        # Pydantic min_length=1 rejects the empty string at the schema layer.
        assert resp.status_code == 422

    def test_whitespace_only_manufacturer_returns_invalid_query(self, monkeypatch):
        """Whitespace-only strings pass Pydantic's min_length but are blank after
        strip() — the handler must catch this itself and refuse to search."""

        async def fake_search_manual(make, model):
            raise AssertionError("search_manual must not be called for a blank query")

        monkeypatch.setattr("ask_api.manual_discovery.search_manual", fake_search_manual)
        client = _client()
        resp = client.post(
            "/manual-discovery/search",
            json={"manufacturer": "   ", "model": "525"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["found"] is False
        assert body["reason"] == "invalid_query"


class TestManualDiscoverySearchAuth:
    """Optional shared-secret authentication."""

    def test_auth_off_request_without_header_succeeds(self, monkeypatch):
        monkeypatch.delenv("ASK_API_KEY", raising=False)

        async def fake_search_manual(make, model):
            return None

        monkeypatch.setattr("ask_api.manual_discovery.search_manual", fake_search_manual)
        client = _client()
        resp = client.post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        assert resp.status_code == 200

    def test_auth_on_request_without_header_fails(self, monkeypatch):
        monkeypatch.setenv("ASK_API_KEY", "sekret")
        client = _client()
        resp = client.post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        assert resp.status_code == 401

    def test_auth_on_request_with_wrong_key_fails(self, monkeypatch):
        monkeypatch.setenv("ASK_API_KEY", "sekret")
        client = _client()
        resp = client.post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
            headers={"X-Mira-Key": "wrong"},
        )
        assert resp.status_code == 401

    def test_auth_on_request_with_correct_key_succeeds(self, monkeypatch):
        monkeypatch.setenv("ASK_API_KEY", "sekret")

        async def fake_search_manual(make, model):
            return None

        monkeypatch.setattr("ask_api.manual_discovery.search_manual", fake_search_manual)
        client = _client()
        resp = client.post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
            headers={"X-Mira-Key": "sekret"},
        )
        assert resp.status_code == 200


class TestManualDiscoverySearchErrorHandling:
    """Graceful error handling — never 500."""

    def test_search_manual_exception_returns_200_search_unavailable(self, monkeypatch):
        async def fake_search_manual(make, model):
            raise RuntimeError("SERPER_API_KEY is not configured")

        monkeypatch.setattr("ask_api.manual_discovery.search_manual", fake_search_manual)
        client = _client()
        resp = client.post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["found"] is False
        assert body["reason"] == "search_unavailable"

    def test_timeout_returns_search_unavailable(self, monkeypatch):
        monkeypatch.setenv("MANUAL_DISCOVERY_TIMEOUT", "0.05")

        async def slow_search_manual(make, model):
            await asyncio.sleep(1.0)
            return dict(_VALIDATED_CANDIDATE)

        monkeypatch.setattr("ask_api.manual_discovery.search_manual", slow_search_manual)
        client = _client()
        resp = client.post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["found"] is False
        assert body["reason"] == "search_unavailable"


class TestManualDiscoveryCatalogPriority:
    """Query identifier priority: catalog_number over model when present."""

    def test_catalog_number_used_when_supplied(self, monkeypatch):
        received = {}

        async def fake_search_manual(make, model):
            received["make"] = make
            received["model"] = model
            return None

        monkeypatch.setattr("ask_api.manual_discovery.search_manual", fake_search_manual)
        client = _client()
        resp = client.post(
            "/manual-discovery/search",
            json={
                "manufacturer": "Rockwell Automation",
                "model": "PowerFlex 525",
                "catalog_number": "25B-D2P3N104",
            },
        )
        assert resp.status_code == 200
        assert received["model"] == "25B-D2P3N104"

    def test_model_used_when_no_catalog_number(self, monkeypatch):
        received = {}

        async def fake_search_manual(make, model):
            received["make"] = make
            received["model"] = model
            return None

        monkeypatch.setattr("ask_api.manual_discovery.search_manual", fake_search_manual)
        client = _client()
        resp = client.post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "PowerFlex 525"},
        )
        assert resp.status_code == 200
        assert received["model"] == "PowerFlex 525"


class TestIsOemHost:
    """Unit tests for the pure is_oem_host() helper."""

    def test_real_oem_host_for_manufacturer(self):
        assert is_oem_host("rockwell", "literature.rockwellautomation.com") is True

    def test_oem_host_subdomain_match(self):
        assert is_oem_host("rockwell automation", "sub.literature.rockwellautomation.com") is True

    def test_oriental_motor_is_a_recognized_oem(self):
        # Oriental Motor serves its operating manuals from its own domain. The
        # searcher already FOUND the right manual without this entry; the entry
        # is what lets an auto-import gate keyed on oem_host accept a genuine
        # first-party document instead of demanding manual review.
        assert is_oem_host("Oriental Motor", "www.orientalmotor.com") is True
        assert is_oem_host("orientalmotor", "orientalmotor.com") is True

    def test_oriental_motor_does_not_match_lookalike_hosts(self):
        # The dot-suffix rule must hold for a newly added OEM exactly as it does
        # for the originals — a bare suffix test would trust both of these.
        assert is_oem_host("Oriental Motor", "evil-orientalmotor.com") is False
        assert is_oem_host("Oriental Motor", "orientalmotor.com.attacker.net") is False

    def test_trusted_distributor_is_NOT_oem_host(self):
        # Codex P1 (2026-08-16): docs.rs-online.com is on the general trusted
        # list, but oem_host gates AUTO-verify — a distributor (or another
        # manufacturer's site) must never count as the confirmed
        # manufacturer's OEM host. Distributor trust is its own signal.
        from ask_api.manual_discovery import is_trusted_distributor_host

        assert is_oem_host("siemens", "docs.rs-online.com") is False
        assert is_trusted_distributor_host("docs.rs-online.com") is True

    def test_other_manufacturers_domain_is_not_oem_host(self):
        # Siemens' documentation host is Siemens' OEM host — and nobody else's.
        assert is_oem_host("siemens", "support.industry.siemens.com") is True
        assert is_oem_host("abb", "support.industry.siemens.com") is False

    def test_random_host_returns_false(self):
        assert is_oem_host("rockwell", "example-reseller.com") is False

    def test_deny_listed_style_host_returns_false(self):
        assert is_oem_host("rockwell", "scribd.com") is False

    def test_unknown_manufacturer_returns_false_for_non_trusted_host(self):
        assert is_oem_host("acmeco", "example-reseller.com") is False

    def test_blank_manufacturer_or_host_returns_false(self):
        assert is_oem_host("", "literature.rockwellautomation.com") is False
        assert is_oem_host("rockwell", "") is False


def test_all_rejected_disappears_as_no_manual_found(monkeypatch):
    """Owner canary rule 2026-08-26: when every read candidate was rejected the
    technician gets no_manual_found + reasons + the OEM request link — never a
    newspaper to 'review'."""
    import ask_api.manual_discovery as md

    async def fake_search(make, model):
        return {
            "url": "https://linpub.example/news.pdf",
            "title": "Car show",
            "host": "linpub.example",
            "score": 30,
            "is_direct_pdf": True,
            "validated": False,
            "reason": "judged_not_applicable",
            "reason_detail": "Read the PDF: a newspaper article.",
            "judged_rejected": [{"url": "https://linpub.example/news.pdf", "reason": "newspaper"}],
        }

    async def fake_link(make):
        return "https://www.harringtonhoists.com/owners-manual-request"

    monkeypatch.setattr(md, "search_manual", fake_search)
    monkeypatch.setattr(md, "oem_request_link", fake_link)
    monkeypatch.delenv("ASK_API_KEY", raising=False)
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(md.router)
    r = TestClient(app).post(
        "/manual-discovery/search", json={"manufacturer": "Harrington", "model": "UMS3-0335"}
    )
    d = r.json()
    assert d["found"] is False and d["candidate"] is None
    assert d["reason"] == "judged_not_applicable"
    assert d["judged_rejected"][0]["reason"] == "newspaper"
    assert d["oem_request_url"].endswith("/owners-manual-request")
