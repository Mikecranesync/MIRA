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

    def test_part_number_only_search_does_not_claim_an_oem(self, monkeypatch):
        received = {}

        async def fake_search_manual(make, model):
            received["make"] = make
            received["model"] = model
            return dict(_UNVALIDATED_CANDIDATE)

        monkeypatch.setattr("ask_api.manual_discovery.search_manual", fake_search_manual)
        client = _client()
        resp = client.post(
            "/manual-discovery/search",
            json={"model": "NI8U-S12-AP6"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert received == {"make": "", "model": "NI8U-S12-AP6"}
        assert body["found"] is True
        assert body["oem_host"] is False
        assert body["oem_request_url"] is None

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

    def test_missing_model_and_catalog_is_honest_invalid_query(self):
        client = _client()
        resp = client.post("/manual-discovery/search", json={"manufacturer": "Rockwell"})
        assert resp.status_code == 200
        assert resp.json()["reason"] == "invalid_query"

    def test_oversized_field_returns_422(self):
        client = _client()
        resp = client.post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell", "model": "x" * 500},
        )
        assert resp.status_code == 422

    def test_blank_manufacturer_is_allowed_for_part_lookup(self, monkeypatch):
        received = {}

        async def fake_search_manual(make, model):
            received["make"] = make
            received["model"] = model
            return None

        client = _client()
        monkeypatch.setattr("ask_api.manual_discovery.search_manual", fake_search_manual)
        resp = client.post(
            "/manual-discovery/search",
            json={"manufacturer": "", "model": "NI8U-S12-AP6"},
        )
        assert resp.status_code == 200
        assert received == {"make": "", "model": "NI8U-S12-AP6"}

    def test_whitespace_only_manufacturer_can_still_use_part_number(self, monkeypatch):
        """A blank maker is safe for a part-only search; it never qualifies an OEM."""
        called = []

        async def fake_search_manual(make, model):
            called.append((make, model))
            return None

        monkeypatch.setattr("ask_api.manual_discovery.search_manual", fake_search_manual)
        client = _client()
        resp = client.post(
            "/manual-discovery/search",
            json={"manufacturer": "   ", "model": "NI8U-S12-AP6"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["found"] is False
        assert called == [("", "NI8U-S12-AP6")]

    def test_missing_model_and_catalog_number_is_rejected(self):
        resp = _client().post("/manual-discovery/search", json={"manufacturer": "Rockwell"})
        assert resp.status_code == 200
        assert resp.json()["reason"] == "invalid_query"


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
        """Defense in depth (code-review follow-up): "no_identity" should be
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

    Mutation-proven (this file): deleting the route's
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


class TestQuotaDenialInterruptsJudgedSearch:
    """#4168 Codex r1 F2: a cap denial that stopped the search part-way must
    not be reported as a completed miss. If the judge rejected what WAS
    collected, the honest answer is "limit reached" (retryable), not
    judged_not_applicable (terminal no_manual_found in the Hub)."""

    def _fake(self, monkeypatch, candidate, denial):
        import ask_api.manual_discovery as md
        from shared.manual_search import search as _search_mod

        async def fake_search_manual(make, model):
            budget = _search_mod._provider_budget.get()
            assert budget is not None
            if denial:
                budget.quota_denied = denial
                budget.refused += 1
            return candidate

        monkeypatch.setattr(md, "search_manual", fake_search_manual)

    _REJECTED = {
        "url": "https://linpub.example/news.pdf",
        "title": "Newspaper",
        "host": "linpub.example",
        "validated": False,
        "is_direct_pdf": True,
        "reason": "judged_not_applicable",
        "reason_detail": "Read the PDF: a newspaper article.",
        "judged_rejected": [{"url": "https://linpub.example/news.pdf", "reason": "newspaper"}],
    }

    def test_judged_rejection_after_a_cap_denial_reports_quota_exceeded(self, monkeypatch):
        self._fake(monkeypatch, dict(self._REJECTED), "user_cap")
        body = (
            _client()
            .post(
                "/manual-discovery/search",
                json={"manufacturer": "Rockwell Automation", "model": "525"},
            )
            .json()
        )
        assert body["found"] is False
        assert body["reason"] == "quota_exceeded"
        assert "user" in body["reason_detail"].lower()

    def test_judged_rejection_after_quota_unavailable_reports_search_unavailable(self, monkeypatch):
        self._fake(monkeypatch, dict(self._REJECTED), "quota_unavailable")
        body = (
            _client()
            .post(
                "/manual-discovery/search",
                json={"manufacturer": "Rockwell Automation", "model": "525"},
            )
            .json()
        )
        assert body["found"] is False
        assert body["reason"] == "search_unavailable"

    def test_control_judged_rejection_without_denial_stays_judged_not_applicable(self, monkeypatch):
        self._fake(monkeypatch, dict(self._REJECTED), None)
        body = (
            _client()
            .post(
                "/manual-discovery/search",
                json={"manufacturer": "Rockwell Automation", "model": "525"},
            )
            .json()
        )
        assert body["reason"] == "judged_not_applicable"

    def test_control_usable_candidate_survives_a_later_denial(self, monkeypatch):
        self._fake(monkeypatch, dict(_VALIDATED_CANDIDATE), "user_cap")
        body = (
            _client()
            .post(
                "/manual-discovery/search",
                json={"manufacturer": "Rockwell Automation", "model": "525"},
            )
            .json()
        )
        assert body["found"] is True
        assert body["validated"] is True


class TestManualDiscoverySearchErrorHandling:
    """Graceful error handling — never 500."""

    def test_every_serper_pass_failing_is_search_unavailable_not_a_miss(self, monkeypatch):
        # #4150 F3: through the REAL search_manual, all passes failing must
        # surface as search_unavailable, never as an honest "no_result" miss.
        import shared.manual_search.search as search_mod

        async def failing_serper(query, num=10):
            raise RuntimeError("serper down")

        monkeypatch.setattr(search_mod, "_serper_search", failing_serper)
        client = _client()
        resp = client.post(
            "/manual-discovery/search",
            json={"manufacturer": "", "catalog_number": "6ES7214-1AG40-0XB0"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["found"] is False
        assert body["reason"] == "search_unavailable"

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


class TestManualDiscoverySearchStats:
    """search_stats (#4160 gate R15, PRD v1.7.1 R15): additive block on EVERY
    response — provider_queries, refused_queries, quota_denied, candidates.
    No identity strings/URLs/serials in it; existing fields unchanged."""

    def _fake_with_budget(
        self,
        monkeypatch,
        *,
        used: int = 0,
        refused: int = 0,
        quota_denied: str | None = None,
        candidate: dict | None = None,
        examined: tuple[str, ...] = (),
    ):
        """A fake search_manual that spends the SAME contextvar budget the
        real _serper_search gate would, mirroring the established pattern in
        TestManualDiscoveryQuota above."""
        from shared.manual_search import search as _search_mod

        async def fake_search_manual(make, model):
            budget = _search_mod._provider_budget.get()
            assert budget is not None, "the endpoint must open provider_query_budget()"
            budget.used += used
            budget.refused += refused
            if quota_denied:
                budget.quota_denied = quota_denied
            # search_manual records what it examined on the same budget (F4)
            budget.examined.update(examined)
            return candidate

        monkeypatch.setattr("ask_api.manual_discovery.search_manual", fake_search_manual)

    def test_found_path_reports_provider_queries_and_one_candidate(self, monkeypatch):
        self._fake_with_budget(
            monkeypatch,
            used=2,
            candidate=dict(_VALIDATED_CANDIDATE),
            examined=(_VALIDATED_CANDIDATE["url"],),
        )
        resp = _client().post(
            "/manual-discovery/search",
            json={"manufacturer": "Rockwell Automation", "model": "525"},
        )
        body = resp.json()
        assert body["found"] is True
        assert body["search_stats"] == {
            "provider_queries": 2,
            "refused_queries": 0,
            "quota_denied": None,
            "candidates": 1,
        }

    def test_found_path_counts_judged_rejected_siblings_alongside_the_match(self, monkeypatch):
        cand = dict(_VALIDATED_CANDIDATE)
        cand["judged_rejected"] = [{"url": "https://x.example/a.pdf", "reason": "wrong model"}]
        self._fake_with_budget(
            monkeypatch,
            used=3,
            candidate=cand,
            examined=(_VALIDATED_CANDIDATE["url"], "https://x.example/a.pdf"),
        )
        body = (
            _client()
            .post(
                "/manual-discovery/search",
                json={"manufacturer": "Rockwell Automation", "model": "525"},
            )
            .json()
        )
        # The match itself + the one sibling the judge read and rejected.
        assert body["search_stats"]["candidates"] == 2
        assert body["search_stats"]["provider_queries"] == 3

    def test_no_result_path_reports_zero_candidates(self, monkeypatch):
        self._fake_with_budget(monkeypatch, used=4, refused=1, candidate=None)
        body = (
            _client()
            .post(
                "/manual-discovery/search",
                json={"manufacturer": "AcmeCo", "model": "Blender9000"},
            )
            .json()
        )
        assert body["found"] is False
        assert body["reason"] == "no_result"
        assert body["search_stats"] == {
            "provider_queries": 4,
            "refused_queries": 1,
            "quota_denied": None,
            "candidates": 0,
        }

    def test_judged_not_applicable_path_counts_the_rejected_candidate_once(self, monkeypatch):
        """Owner canary rejection path (#4160 R15): the judge read and
        rejected everything, found=False — candidates must still read 1 (the
        one document considered and rejected), never 0 (nothing examined) or
        2 (double-counted with itself)."""
        import ask_api.manual_discovery as md
        from shared.manual_search import search as _search_mod

        async def fake_search(make, model):
            _search_mod._note_examined(["https://linpub.example/news.pdf"])
            return {
                "url": "https://linpub.example/news.pdf",
                "title": "Car show",
                "host": "linpub.example",
                "score": 30,
                "is_direct_pdf": True,
                "validated": False,
                "reason": "judged_not_applicable",
                "reason_detail": "Read the PDF: a newspaper article.",
                "judged_rejected": [
                    {"url": "https://linpub.example/news.pdf", "reason": "newspaper"}
                ],
            }

        monkeypatch.setattr(md, "search_manual", fake_search)
        body = (
            _client()
            .post(
                "/manual-discovery/search",
                json={"manufacturer": "Harrington", "model": "UMS3-0335"},
            )
            .json()
        )
        assert body["found"] is False
        assert body["reason"] == "judged_not_applicable"
        assert body["search_stats"]["candidates"] == 1

    def test_quota_denied_path_reports_quota_denied_scope_and_zero_candidates(self, monkeypatch):
        self._fake_with_budget(
            monkeypatch, used=1, refused=1, quota_denied="user_cap", candidate=None
        )
        body = (
            _client()
            .post(
                "/manual-discovery/search",
                json={"manufacturer": "Rockwell Automation", "model": "525"},
            )
            .json()
        )
        assert body["reason"] == "quota_exceeded"
        assert body["search_stats"] == {
            "provider_queries": 1,
            "refused_queries": 1,
            "quota_denied": "user_cap",
            "candidates": 0,
        }

    def test_search_unavailable_path_reports_search_stats_from_the_spent_budget(self, monkeypatch):
        from shared.manual_search import search as _search_mod

        async def fake_search_manual(make, model):
            budget = _search_mod._provider_budget.get()
            assert budget is not None
            budget.used += 2
            budget.refused += 1
            raise RuntimeError("boom")

        monkeypatch.setattr("ask_api.manual_discovery.search_manual", fake_search_manual)
        body = (
            _client()
            .post(
                "/manual-discovery/search",
                json={"manufacturer": "Rockwell Automation", "model": "525"},
            )
            .json()
        )
        assert body["reason"] == "search_unavailable"
        assert body["search_stats"] == {
            "provider_queries": 2,
            "refused_queries": 1,
            "quota_denied": None,
            "candidates": 0,
        }

    def test_invalid_query_path_reports_zero_search_stats_without_opening_a_budget(
        self, monkeypatch
    ):
        body = _client().post("/manual-discovery/search", json={"manufacturer": "Rockwell"}).json()
        assert body["reason"] == "invalid_query"
        assert body["search_stats"] == {
            "provider_queries": 0,
            "refused_queries": 0,
            "quota_denied": None,
            "candidates": 0,
        }

    def test_no_identity_strings_or_urls_leak_into_search_stats(self, monkeypatch):
        self._fake_with_budget(monkeypatch, used=1, candidate=dict(_VALIDATED_CANDIDATE))
        body = (
            _client()
            .post(
                "/manual-discovery/search",
                json={"manufacturer": "Rockwell Automation", "model": "525"},
            )
            .json()
        )
        assert set(body["search_stats"].keys()) == {
            "provider_queries",
            "refused_queries",
            "quota_denied",
            "candidates",
        }
        assert _VALIDATED_CANDIDATE["url"] not in body["search_stats"].values()
        assert _VALIDATED_CANDIDATE["host"] not in body["search_stats"].values()

    def test_existing_fields_unchanged_when_search_stats_is_added(self, monkeypatch):
        self._fake_with_budget(monkeypatch, candidate=dict(_VALIDATED_CANDIDATE))
        body = (
            _client()
            .post(
                "/manual-discovery/search",
                json={"manufacturer": "Rockwell Automation", "model": "525"},
            )
            .json()
        )
        assert body["validated"] is True
        assert body["is_direct_pdf"] is True
        assert body["oem_host"] is True
        assert body["candidate"]["url"] == _VALIDATED_CANDIDATE["url"]

    def test_real_search_counts_every_document_it_examined(self, monkeypatch):
        """Codex #4194 F4: the REAL search_manual HEAD-validates three
        candidates (two fail, the third confirms) — candidates is 3, the
        documents actually examined, not 1 (the one returned)."""
        from shared.manual_search import search as search_mod

        urls = [f"https://docs.rockwellautomation.com/750-um00{i}.pdf" for i in (1, 2, 3)]

        async def fake_serper(query: str, num: int = 10):
            return [
                {"link": u, "title": f"PowerFlex 750 User Manual {i}", "snippet": "PowerFlex 750"}
                for i, u in enumerate(urls)
            ]

        async def fake_validate(url: str) -> bool:
            return url == urls[2]

        monkeypatch.setattr(search_mod._judge, "judge_enabled", lambda: False)
        monkeypatch.setattr(search_mod, "_serper_search", fake_serper)
        monkeypatch.setattr(search_mod, "validate_pdf", fake_validate)
        body = (
            _client()
            .post(
                "/manual-discovery/search",
                json={"manufacturer": "Rockwell Automation", "model": "750"},
            )
            .json()
        )
        assert body["found"] is True
        assert body["search_stats"]["candidates"] == 3


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
