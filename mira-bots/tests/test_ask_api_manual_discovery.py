"""Tests for the manual-discovery HTTP endpoint.

These tests construct a minimal FastAPI app with ONLY the manual_discovery
router — never importing ask_api.app (which builds the heavy Supervisor
engine at import time). search_manual is monkeypatched at the ask_api.
manual_discovery module reference (where the router looks it up) so no live
Serper/network call is ever made.
"""

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from ask_api.manual_discovery import is_oem_host, router as manual_discovery_router


_KEY = "test-manual-discovery-key"


@pytest.fixture(autouse=True)
def _discovery_key(monkeypatch):
    """The endpoint fails closed without its key (#4160 S2), so every test
    runs with one configured unless it deliberately removes it."""
    monkeypatch.setenv("MANUAL_DISCOVERY_API_KEY", _KEY)
    monkeypatch.delenv("ASK_API_KEY", raising=False)


_TENANT = "test-tenant"
_USER = "test-user"


def _client(
    key: str | None = _KEY,
    *,
    tenant: str | None = _TENANT,
    user: str | None = _USER,
) -> TestClient:
    """Create a minimal app with only the manual_discovery router.

    Avoids importing ask_api.app, which constructs the Supervisor engine.
    Sends the configured key AND a default tenant/user identity (#4160 S4)
    by default; pass ``key=None``/``tenant=None``/``user=None`` to omit one.
    """
    app = FastAPI()
    app.include_router(manual_discovery_router)
    headers: dict[str, str] = {}
    if key is not None:
        headers["X-Mira-Key"] = key
    if tenant is not None:
        headers["X-Mira-Tenant"] = tenant
    if user is not None:
        headers["X-Mira-User"] = user
    return TestClient(app, headers=headers)


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
    """Required shared-secret authentication (#4160 S2, PRD R13).

    The endpoint spends paid provider queries, so it fails closed: with no
    key configured it answers 503, never an open search. It uses its own
    key, MANUAL_DISCOVERY_API_KEY, not the shared ASK_API_KEY: the Ignition
    kiosk posts an empty X-Mira-Key to /ask, so turning ASK_API_KEY on
    globally would break it.
    """

    def _fake_search(self, monkeypatch, calls):
        async def fake_search_manual(make, model):
            calls.append((make, model))
            return None

        monkeypatch.setattr("ask_api.manual_discovery.search_manual", fake_search_manual)

    def test_key_unset_returns_503_and_never_searches(self, monkeypatch):
        monkeypatch.delenv("MANUAL_DISCOVERY_API_KEY", raising=False)
        calls = []
        self._fake_search(monkeypatch, calls)
        resp = _client(key=None).post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        assert resp.status_code == 503
        assert calls == []

    def test_key_blank_is_treated_as_unset(self, monkeypatch):
        monkeypatch.setenv("MANUAL_DISCOVERY_API_KEY", "   ")
        calls = []
        self._fake_search(monkeypatch, calls)
        resp = _client(key="   ").post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        assert resp.status_code == 503
        assert calls == []

    def test_shared_ask_api_key_is_not_a_substitute(self, monkeypatch):
        monkeypatch.delenv("MANUAL_DISCOVERY_API_KEY", raising=False)
        monkeypatch.setenv("ASK_API_KEY", "kiosk-key")
        calls = []
        self._fake_search(monkeypatch, calls)
        resp = _client(key="kiosk-key").post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        assert resp.status_code == 503
        assert calls == []

    def test_missing_header_returns_401_and_never_searches(self, monkeypatch):
        calls = []
        self._fake_search(monkeypatch, calls)
        resp = _client(key=None).post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        assert resp.status_code == 401
        assert calls == []

    def test_wrong_key_returns_401_and_never_searches(self, monkeypatch):
        calls = []
        self._fake_search(monkeypatch, calls)
        resp = _client(key="wrong").post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        assert resp.status_code == 401
        assert calls == []

    def test_empty_header_returns_401(self, monkeypatch):
        calls = []
        self._fake_search(monkeypatch, calls)
        resp = _client(key="").post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        assert resp.status_code == 401
        assert calls == []

    def test_correct_key_searches(self, monkeypatch):
        calls = []
        self._fake_search(monkeypatch, calls)
        resp = _client().post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        assert resp.status_code == 200
        assert calls == [("Rockwell Automation", "525")]

    def test_comparison_is_constant_time(self, monkeypatch):
        import ask_api.manual_discovery as md

        seen = []
        real = md.hmac.compare_digest

        def spy(a, b):
            seen.append((a, b))
            return real(a, b)

        monkeypatch.setattr(md.hmac, "compare_digest", spy)
        self._fake_search(monkeypatch, [])
        _client(key="wrong").post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        assert seen, "key check must use hmac.compare_digest"

    def test_auth_runs_before_request_validation_side_effects(self, monkeypatch):
        """An unauthenticated caller learns nothing from the body: 401, not invalid_query."""
        calls = []
        self._fake_search(monkeypatch, calls)
        resp = _client(key=None).post(
            "/manual-discovery/search",
            json={"manufacturer": "   ", "model": "525"},
        )
        assert resp.status_code == 401


class TestManualDiscoverySearchIdentity:
    """Required X-Mira-Tenant / X-Mira-User identity (#4160 S4, PRD R13/R14).

    Every search is reserved against per-user/tenant/global Postgres caps, so
    the caller must identify itself. Checked AFTER the key check (a caller
    with no valid key learns nothing about the identity requirement either).
    """

    def _fake_search(self, monkeypatch, calls):
        async def fake_search_manual(make, model):
            calls.append((make, model))
            return None

        monkeypatch.setattr("ask_api.manual_discovery.search_manual", fake_search_manual)

    def test_missing_tenant_header_returns_400_and_never_searches(self, monkeypatch):
        calls = []
        self._fake_search(monkeypatch, calls)
        resp = _client(tenant=None).post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == "tenant and user required"
        assert calls == []

    def test_missing_user_header_returns_400_and_never_searches(self, monkeypatch):
        calls = []
        self._fake_search(monkeypatch, calls)
        resp = _client(user=None).post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == "tenant and user required"
        assert calls == []

    def test_blank_tenant_header_returns_400(self, monkeypatch):
        calls = []
        self._fake_search(monkeypatch, calls)
        resp = _client(tenant="   ").post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        assert resp.status_code == 400
        assert calls == []

    def test_blank_user_header_returns_400(self, monkeypatch):
        calls = []
        self._fake_search(monkeypatch, calls)
        resp = _client(user="   ").post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        assert resp.status_code == 400
        assert calls == []

    def test_wrong_key_with_missing_identity_still_returns_401_not_400(self, monkeypatch):
        """Auth runs BEFORE the identity check: a bad key never leaks whether
        the identity headers would have been accepted."""
        calls = []
        self._fake_search(monkeypatch, calls)
        resp = _client(key="wrong", tenant=None, user=None).post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        assert resp.status_code == 401
        assert calls == []

    def test_both_headers_present_searches_normally(self, monkeypatch):
        calls = []
        self._fake_search(monkeypatch, calls)
        resp = _client().post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        assert resp.status_code == 200
        assert calls == [("Rockwell Automation", "525")]


class TestManualDiscoveryQuota:
    """Quota-denial mapping (#4160 S4, PRD R5): a cap denial must never look
    like "no manual exists". The real _serper_search gate is not exercised
    here (search_manual is swapped, same boundary as the rest of this file);
    instead the fake search_manual sets budget.quota_denied exactly as the
    real gate would, so these tests pin the ENDPOINT's branching on it."""

    def _fake_search_setting_denial(self, monkeypatch, reason: str):
        import ask_api.manual_discovery as md
        from shared.manual_search import search as _search_mod

        async def fake_search_manual(make, model):
            # Set the SAME contextvar the real _serper_search gate would, so
            # this fake behaves exactly like a real denial for the purpose of
            # pinning the endpoint's branching on budget.quota_denied.
            budget = _search_mod._provider_budget.get()
            assert budget is not None, "the endpoint must open provider_query_budget()"
            budget.quota_denied = reason
            budget.refused += 1
            return None

        monkeypatch.setattr(md, "search_manual", fake_search_manual)

    def test_user_cap_denial_maps_to_quota_exceeded_with_scope_detail(self, monkeypatch):
        self._fake_search_setting_denial(monkeypatch, "user_cap")
        resp = _client().post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["found"] is False
        assert body["candidate"] is None
        assert body["reason"] == "quota_exceeded"
        assert "user" in body["reason_detail"].lower()
        assert "limit" in body["reason_detail"].lower()

    def test_tenant_cap_denial_maps_to_quota_exceeded_with_scope_detail(self, monkeypatch):
        self._fake_search_setting_denial(monkeypatch, "tenant_cap")
        resp = _client().post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        body = resp.json()
        assert body["reason"] == "quota_exceeded"
        assert "organization" in body["reason_detail"].lower()

    def test_global_cap_denial_maps_to_quota_exceeded_with_scope_detail(self, monkeypatch):
        self._fake_search_setting_denial(monkeypatch, "global_cap")
        resp = _client().post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        body = resp.json()
        assert body["reason"] == "quota_exceeded"
        assert "system-wide" in body["reason_detail"].lower()

    def test_global_cap_unconfigured_maps_to_search_unavailable_not_quota_exceeded(
        self, monkeypatch
    ):
        """Owner decision D4 (2026-09-30): the global monthly $ ceiling is not
        yet decided, so quota.py fails closed with "global_cap_unconfigured"
        rather than inventing a default. That is an infra/config miss, not a
        cap AT capacity — it must read as "search unavailable", never "limit
        reached" (which would wrongly imply the system is actually enforcing
        a real monthly number right now)."""
        self._fake_search_setting_denial(monkeypatch, "global_cap_unconfigured")
        resp = _client().post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        body = resp.json()
        assert body["reason"] == "search_unavailable"
        assert body["reason"] != "quota_exceeded"

    def test_quota_unavailable_maps_to_search_unavailable_not_quota_exceeded(self, monkeypatch):
        """quota_unavailable (DB/env problem) is an infra miss, not a cap
        denial — it must read as "search unavailable", never "limit reached"."""
        self._fake_search_setting_denial(monkeypatch, "quota_unavailable")
        resp = _client().post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        body = resp.json()
        assert body["reason"] == "search_unavailable"
        assert body["reason"] != "quota_exceeded"

    def test_no_identity_denial_maps_to_search_unavailable_never_a_blank_quota_exceeded(
        self, monkeypatch
    ):
        """Defense in depth (Codex review): "no_identity" should be
        structurally unreachable from THIS route (it always opens
        provider_query_quota() with a validated identity — see the real-wiring
        test below), but if a future regression ever removes that wrapper, the
        fallback must be the honest "search_unavailable" infra miss — never a
        "quota_exceeded" with an empty reason_detail (which the old `else`
        branch produced for ANY non-"quota_unavailable" denial, including
        this one)."""
        self._fake_search_setting_denial(monkeypatch, "no_identity")
        resp = _client().post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        body = resp.json()
        assert body["reason"] == "search_unavailable"
        assert body["reason"] != "quota_exceeded"

    def test_control_no_denial_is_a_plain_no_result_not_quota_exceeded(self, monkeypatch):
        """Negative control: a plain miss (budget.quota_denied stays None)
        must NOT be mapped to quota_exceeded."""

        async def fake_search_manual(make, model):
            return None

        monkeypatch.setattr("ask_api.manual_discovery.search_manual", fake_search_manual)
        resp = _client().post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        body = resp.json()
        assert body["reason"] == "no_result"


class TestManualDiscoveryRealQuotaWiring:
    """Proves the END-TO-END wiring the rest of this file's mocking boundary
    cannot (search_manual is swapped everywhere else): X-Mira-Tenant/
    X-Mira-User headers -> QuotaIdentity -> the provider_query_quota()
    contextvar -> across the asyncio.wait_for task boundary -> the REAL
    _serper_search enforcement point. Only _serper_post (the actual network
    call) and reserve_provider_query (the actual DB round trip) are faked;
    search_manual itself runs for real.

    Mutation-proven (Codex review): deleting the route's
    `provider_query_quota(identity)` wrapper makes this go red — the
    identity never reaches _serper_search, every query is refused
    "no_identity", and nothing is ever sent.
    """

    def test_identity_headers_reach_the_real_quota_reservation(self, monkeypatch):
        import shared.manual_search.quota as quota_mod
        import shared.manual_search.search as search_mod

        monkeypatch.setenv("MANUAL_JUDGE_ENABLED", "0")
        monkeypatch.setattr(search_mod, "SERPER_API_KEY", "test-key")
        seen_identities = []
        sent_queries = []

        async def fake_reserve(identity, **kwargs):
            seen_identities.append(identity)
            return "ok"

        async def fake_post(query, num=10):
            sent_queries.append(query)
            return []

        monkeypatch.setattr(quota_mod, "reserve_provider_query", fake_reserve)
        monkeypatch.setattr(search_mod, "_serper_post", fake_post)

        resp = _client(tenant="hdr-tenant", user="hdr-user").post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        assert resp.status_code == 200
        assert sent_queries, "expected the real search_manual to attempt a provider query"
        assert seen_identities, "expected reserve_provider_query to be called with an identity"
        assert seen_identities[0].tenant_id == "hdr-tenant"
        assert seen_identities[0].user_id == "hdr-user"


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

    def test_smc_regional_documentation_hosts_are_oem(self):
        # 2026-09-29 staging probe: discovery found the real VQ(C)1000 instruction
        # manual at static.smc.eu, but with only smcusa.com listed it scored
        # oem_host=False and stopped at manual review.
        assert is_oem_host("SMC", "static.smc.eu") is True
        assert is_oem_host("smc", "content2.smcetech.com") is True
        assert is_oem_host("SMC Corporation", "www.smcworld.com") is True
        assert is_oem_host("SMC", "www.smcusa.com") is True

    def test_smc_does_not_match_lookalike_hosts(self):
        assert is_oem_host("SMC", "notsmc.eu") is False
        assert is_oem_host("SMC", "smc.eu.attacker.net") is False

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
    r = _client().post(
        "/manual-discovery/search", json={"manufacturer": "Harrington", "model": "UMS3-0335"}
    )
    d = r.json()
    assert d["found"] is False and d["candidate"] is None
    assert d["reason"] == "judged_not_applicable"
    assert d["judged_rejected"][0]["reason"] == "newspaper"
    assert d["oem_request_url"].endswith("/owners-manual-request")
