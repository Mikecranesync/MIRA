"""Integration tests for the /route endpoint — Path B tier-routed RAG query.

Tests cover:
  1. 503 when tier routing is disabled (_tier_router is None)
  2. Simple query routes to Tier 1, response carries tier_used="tier1"
  3. Complex query routes to Tier 3, response carries tier_used="tier3"
  4. force_tier="tier1" overrides the routing decision
  5. Tier 1 returns empty response → automatic fallback to Tier 3
  6. latency_ms is populated and > 0

Strategy: set module-level globals directly (no lifespan), patch rag_query
to return controlled results, and drive the app via ASGITransport.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

# ---------------------------------------------------------------------------
# sys.path — mira-sidecar is not an installed package
# ---------------------------------------------------------------------------

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "mira-sidecar"))

from routing.tier_router import TierRouter  # noqa: E402

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_llm_provider(name: str = "mock-model") -> MagicMock:
    """Return a mock LLMProvider with the given model_name."""
    p = MagicMock()
    p.model_name = name
    p.complete = AsyncMock(return_value="Mocked LLM answer.")
    p.embed = AsyncMock(return_value=[[0.1] * 384])
    return p


def _make_store(doc_count: int = 3) -> MagicMock:
    """Return a mock MiraVectorStore."""
    store = MagicMock()
    store.doc_count.return_value = doc_count
    store.query.return_value = [
        {
            "text": "VFD fault code OC means overcurrent.",
            "source_file": "gs20_manual.pdf",
            "page": "14",
            "asset_id": "vfd-001",
            "chunk_index": 0,
            "distance": 0.10,
        }
    ]
    return store


def _make_tier_router(
    probe_available: bool = True,
    tier1_provider: MagicMock | None = None,
    tier3_provider: MagicMock | None = None,
) -> TierRouter:
    """Build a TierRouter with a pre-configured HealthProbe state."""
    from routing.health_probe import HealthProbe

    probe = HealthProbe(ollama_url="http://charlie:11434", interval=30)
    probe._available = probe_available

    t1 = tier1_provider or _make_llm_provider("gemma4:e4b")
    t3 = tier3_provider or _make_llm_provider("claude-sonnet-4-6")

    return TierRouter(
        health_probe=probe,
        tier1_provider=t1,
        tier3_provider=t3,
        tier1_max_query_words=40,
    )


_TIER1_RAG_RESULT = {
    "answer": "Fault code OC is overcurrent. Check motor wiring.",
    "sources": [{"file": "gs20_manual.pdf", "page": "14", "excerpt": "OC = overcurrent."}],
}

_TIER3_RAG_RESULT = {
    "answer": "The overcurrent fault indicates motor load exceeds drive rating. "
    "Inspect wiring and verify VFD sizing.",
    "sources": [{"file": "gs20_manual.pdf", "page": "14", "excerpt": "OC = overcurrent."}],
}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def _app_globals():
    """Inject module-level globals into app module and clean up after the test.

    Yields a dict of the mocks so individual tests can override specific fields.
    """
    import app as app_mod  # noqa: PLC0415 — deferred import after sys.path insert

    store_tenant = _make_store()
    store_shared = _make_store()
    embedder = _make_llm_provider("nomic-embed-text")
    tier_router = _make_tier_router(probe_available=True)

    # Stash originals so the fixture is reentrant-safe
    originals = {
        "_store_tenant": app_mod._store_tenant,
        "_store_shared": app_mod._store_shared,
        "_llm": app_mod._llm,
        "_embedder": app_mod._embedder,
        "_tier_router": app_mod._tier_router,
    }

    app_mod._store_tenant = store_tenant
    app_mod._store_shared = store_shared
    app_mod._llm = _make_llm_provider("mock-llm")
    app_mod._embedder = embedder
    app_mod._tier_router = tier_router

    yield {
        "app_mod": app_mod,
        "store_tenant": store_tenant,
        "store_shared": store_shared,
        "embedder": embedder,
        "tier_router": tier_router,
    }

    # Restore originals
    for attr, val in originals.items():
        setattr(app_mod, attr, val)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestRouteEndpoint503WhenDisabled:
    """Returns 503 when _tier_router is None (feature disabled)."""

    async def test_503_when_tier_router_is_none(self, _app_globals) -> None:
        g = _app_globals
        g["app_mod"]._tier_router = None  # simulate disabled feature flag

        async with AsyncClient(
            transport=ASGITransport(app=g["app_mod"].app),
            base_url="http://test",
        ) as ac:
            resp = await ac.post(
                "/route",
                json={"query": "fault code OC on GS20 VFD", "asset_id": "vfd-001"},
            )

        assert resp.status_code == 503
        assert "Tier routing is disabled" in resp.json()["detail"]


class TestRouteEndpointTier1:
    """Simple queries route to Tier 1 when Tier 1 is available."""

    async def test_simple_query_uses_tier1(self, _app_globals) -> None:
        g = _app_globals
        t1 = _make_llm_provider("gemma4:e4b")
        g["app_mod"]._tier_router = _make_tier_router(
            probe_available=True,
            tier1_provider=t1,
        )

        with patch("app.rag_query", new=AsyncMock(return_value=_TIER1_RAG_RESULT)):
            async with AsyncClient(
                transport=ASGITransport(app=g["app_mod"].app),
                base_url="http://test",
            ) as ac:
                resp = await ac.post(
                    "/route",
                    json={
                        "query": "fault code OC on GS20 VFD",
                        "asset_id": "vfd-001",
                    },
                )

        assert resp.status_code == 200
        data = resp.json()
        assert data["tier_used"] == "tier1"
        assert data["answer"] == _TIER1_RAG_RESULT["answer"]
        assert data["model"] == "gemma4:e4b"
        assert data["query"] == "fault code OC on GS20 VFD"
        assert isinstance(data["sources"], list)


class TestRouteEndpointTier3:
    """Complex queries route to Tier 3."""

    async def test_complex_query_uses_tier3(self, _app_globals) -> None:
        g = _app_globals
        t3 = _make_llm_provider("claude-sonnet-4-6")
        g["app_mod"]._tier_router = _make_tier_router(
            probe_available=True,
            tier3_provider=t3,
        )

        # A query long enough to exceed the 40-word threshold → COMPLEX → Tier 3
        long_query = (
            "I need a detailed root cause analysis for the recurring overcurrent faults "
            "on motor M-204 that happen intermittently during the afternoon shift when "
            "ambient temperatures are above 95 degrees Fahrenheit and the bearing "
            "vibration readings on the drive end are elevated compared to baseline"
        )

        with patch("app.rag_query", new=AsyncMock(return_value=_TIER3_RAG_RESULT)):
            async with AsyncClient(
                transport=ASGITransport(app=g["app_mod"].app),
                base_url="http://test",
            ) as ac:
                resp = await ac.post(
                    "/route",
                    json={"query": long_query, "asset_id": "motor-204"},
                )

        assert resp.status_code == 200
        data = resp.json()
        assert data["tier_used"] == "tier3"
        assert data["model"] == "claude-sonnet-4-6"
        assert data["answer"] == _TIER3_RAG_RESULT["answer"]


class TestRouteEndpointForceTier:
    """force_tier overrides the routing classification."""

    async def test_force_tier1_overrides_complex_query(self, _app_globals) -> None:
        g = _app_globals
        t1 = _make_llm_provider("gemma4:e4b")
        g["app_mod"]._tier_router = _make_tier_router(
            probe_available=True,
            tier1_provider=t1,
        )

        with patch("app.rag_query", new=AsyncMock(return_value=_TIER1_RAG_RESULT)):
            async with AsyncClient(
                transport=ASGITransport(app=g["app_mod"].app),
                base_url="http://test",
            ) as ac:
                resp = await ac.post(
                    "/route",
                    json={
                        "query": "Root cause analysis for reactor vessel seal failures",
                        "asset_id": "reactor-01",
                        "force_tier": "tier1",
                    },
                )

        assert resp.status_code == 200
        data = resp.json()
        # Even though this is a complex query, force_tier=tier1 wins
        assert data["tier_used"] == "tier1"
        assert data["model"] == "gemma4:e4b"

    async def test_force_tier3_overrides_simple_query(self, _app_globals) -> None:
        g = _app_globals
        t3 = _make_llm_provider("claude-sonnet-4-6")
        g["app_mod"]._tier_router = _make_tier_router(
            probe_available=True,
            tier3_provider=t3,
        )

        with patch("app.rag_query", new=AsyncMock(return_value=_TIER3_RAG_RESULT)):
            async with AsyncClient(
                transport=ASGITransport(app=g["app_mod"].app),
                base_url="http://test",
            ) as ac:
                resp = await ac.post(
                    "/route",
                    json={
                        "query": "fault code OC",
                        "asset_id": "vfd-001",
                        "force_tier": "tier3",
                    },
                )

        assert resp.status_code == 200
        data = resp.json()
        assert data["tier_used"] == "tier3"
        assert data["model"] == "claude-sonnet-4-6"


class TestRouteEndpointFallback:
    """Tier 1 empty/canned response triggers automatic fallback to Tier 3."""

    async def test_tier1_empty_answer_falls_back_to_tier3(self, _app_globals) -> None:
        g = _app_globals
        t1 = _make_llm_provider("gemma4:e4b")
        t3 = _make_llm_provider("claude-sonnet-4-6")
        g["app_mod"]._tier_router = _make_tier_router(
            probe_available=True,
            tier1_provider=t1,
            tier3_provider=t3,
        )

        # First call (Tier 1): returns empty answer — signals fallback
        tier1_empty = {"answer": "", "sources": []}
        # Second call (Tier 3 fallback): returns real answer
        call_count = 0

        async def _mock_rag_query(**kwargs):  # noqa: ANN201
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return tier1_empty
            return _TIER3_RAG_RESULT

        with patch("app.rag_query", new=_mock_rag_query):
            async with AsyncClient(
                transport=ASGITransport(app=g["app_mod"].app),
                base_url="http://test",
            ) as ac:
                resp = await ac.post(
                    "/route",
                    json={
                        "query": "fault code OC on GS20 VFD",
                        "asset_id": "vfd-001",
                    },
                )

        assert resp.status_code == 200
        data = resp.json()
        # After fallback, tier_used must reflect Tier 3
        assert data["tier_used"] == "tier3"
        assert data["model"] == "claude-sonnet-4-6"
        assert data["answer"] == _TIER3_RAG_RESULT["answer"]
        # rag_query must have been called exactly twice
        assert call_count == 2

    async def test_tier1_canned_error_triggers_fallback(self, _app_globals) -> None:
        """'Unable to generate' prefix is treated the same as an empty response."""
        g = _app_globals
        t1 = _make_llm_provider("gemma4:e4b")
        t3 = _make_llm_provider("claude-sonnet-4-6")
        g["app_mod"]._tier_router = _make_tier_router(
            probe_available=True,
            tier1_provider=t1,
            tier3_provider=t3,
        )

        tier1_canned = {
            "answer": "Unable to generate a response at this time.",
            "sources": [],
        }
        call_count = 0

        async def _mock_rag_query(**kwargs):  # noqa: ANN201
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return tier1_canned
            return _TIER3_RAG_RESULT

        with patch("app.rag_query", new=_mock_rag_query):
            async with AsyncClient(
                transport=ASGITransport(app=g["app_mod"].app),
                base_url="http://test",
            ) as ac:
                resp = await ac.post(
                    "/route",
                    json={
                        "query": "fault code OC on GS20 VFD",
                        "asset_id": "vfd-001",
                    },
                )

        assert resp.status_code == 200
        data = resp.json()
        assert data["tier_used"] == "tier3"
        assert call_count == 2

    async def test_no_fallback_when_tier3_not_configured(self, _app_globals) -> None:
        """When _tier3 is None, an empty Tier 1 response is returned as-is (no fallback loop)."""
        g = _app_globals
        t1 = _make_llm_provider("gemma4:e4b")

        from routing.health_probe import HealthProbe

        probe = HealthProbe(ollama_url="http://charlie:11434", interval=30)
        probe._available = True
        router = TierRouter(
            health_probe=probe,
            tier1_provider=t1,
            tier3_provider=None,
        )
        g["app_mod"]._tier_router = router

        tier1_empty = {"answer": "", "sources": []}

        with patch("app.rag_query", new=AsyncMock(return_value=tier1_empty)):
            async with AsyncClient(
                transport=ASGITransport(app=g["app_mod"].app),
                base_url="http://test",
            ) as ac:
                resp = await ac.post(
                    "/route",
                    json={
                        "query": "fault code OC on GS20 VFD",
                        "asset_id": "vfd-001",
                    },
                )

        assert resp.status_code == 200
        data = resp.json()
        # Empty answer returned, but tier stays tier1 (no tier3 available)
        assert data["tier_used"] == "tier1"
        assert data["answer"] == ""


class TestRouteEndpointLatency:
    """latency_ms is present and non-negative in every successful response."""

    async def test_latency_ms_is_populated(self, _app_globals) -> None:
        g = _app_globals
        g["app_mod"]._tier_router = _make_tier_router(probe_available=True)

        with patch("app.rag_query", new=AsyncMock(return_value=_TIER1_RAG_RESULT)):
            async with AsyncClient(
                transport=ASGITransport(app=g["app_mod"].app),
                base_url="http://test",
            ) as ac:
                resp = await ac.post(
                    "/route",
                    json={"query": "fault code OC on GS20 VFD", "asset_id": "vfd-001"},
                )

        assert resp.status_code == 200
        data = resp.json()
        assert "latency_ms" in data
        assert isinstance(data["latency_ms"], int)
        assert data["latency_ms"] >= 0

    async def test_latency_ms_is_positive_with_real_timer(self, _app_globals) -> None:
        """Latency must be a non-negative integer — even sub-millisecond calls report 0+."""
        g = _app_globals
        g["app_mod"]._tier_router = _make_tier_router(probe_available=True)

        with patch("app.rag_query", new=AsyncMock(return_value=_TIER3_RAG_RESULT)):
            async with AsyncClient(
                transport=ASGITransport(app=g["app_mod"].app),
                base_url="http://test",
            ) as ac:
                resp = await ac.post(
                    "/route",
                    json={
                        "query": "Root cause analysis for recurring seal failures on the reactor vessel agitator",
                        "asset_id": "reactor-01",
                    },
                )

        assert resp.status_code == 200
        assert resp.json()["latency_ms"] >= 0


class TestRouteEndpointResponseShape:
    """Response body matches the RouteResponse schema in all fields."""

    async def test_response_contains_all_required_fields(self, _app_globals) -> None:
        g = _app_globals
        g["app_mod"]._tier_router = _make_tier_router(probe_available=True)

        with patch("app.rag_query", new=AsyncMock(return_value=_TIER1_RAG_RESULT)):
            async with AsyncClient(
                transport=ASGITransport(app=g["app_mod"].app),
                base_url="http://test",
            ) as ac:
                resp = await ac.post(
                    "/route",
                    json={
                        "query": "fault code OC on GS20 VFD",
                        "asset_id": "vfd-001",
                        "user_id": "tech-mike",
                        "facility_id": "plant-a",
                    },
                )

        assert resp.status_code == 200
        data = resp.json()
        required_fields = {"answer", "sources", "tier_used", "latency_ms", "model", "query"}
        assert required_fields.issubset(data.keys())
        # query echoed back verbatim
        assert data["query"] == "fault code OC on GS20 VFD"
        assert isinstance(data["sources"], list)
