"""Tests for Path B tier routing — query classification, health probe, tier selection."""

from __future__ import annotations

# Import needs sys.path manipulation since mira-sidecar is not installed as a package
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "mira-sidecar"))

from routing.health_probe import HealthProbe
from routing.tier_router import (
    QueryComplexity,
    Tier,
    TierRouter,
    TierSelection,
    classify_query,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mock_provider(name: str = "mock-model") -> MagicMock:
    """Create a mock LLMProvider with model_name."""
    p = MagicMock()
    p.model_name = name
    p.complete = AsyncMock(return_value="mock response")
    p.embed = AsyncMock(return_value=[[0.1] * 384])
    return p


# ---------------------------------------------------------------------------
# classify_query
# ---------------------------------------------------------------------------


class TestClassifyQuery:
    """Deterministic query classification tests."""

    @pytest.mark.parametrize(
        "query",
        [
            "fault code 47 on PowerFlex 525",
            "how to reset GS20 VFD",
            "alarm F001 meaning",
            "procedure for pump alignment",
            "check motor winding resistance",
            "what is an overcurrent fault",
            "create work order for pump P-204",
            "pm schedule for conveyor C-12",
            "last replaced bearing on motor M-101",
        ],
    )
    def test_simple_queries(self, query: str) -> None:
        assert classify_query(query) == QueryComplexity.SIMPLE

    @pytest.mark.parametrize(
        "query",
        [
            # Long queries (> 40 words)
            "I have a centrifugal pump that has been making a grinding noise for the past "
            "three days and the vibration readings on the drive end bearing have been "
            "increasing steadily from 0.15 to 0.45 inches per second and I noticed some "
            "discoloration on the bearing housing that might indicate overheating",
            # Complex queries without simple keywords
            "Intermittent overcurrent trips on the main conveyor drive correlate with "
            "ambient temperature above 95F but only during the afternoon shift",
            "Root cause analysis needed for recurring seal failures on reactor vessel agitator",
        ],
    )
    def test_complex_queries(self, query: str) -> None:
        assert classify_query(query) == QueryComplexity.COMPLEX

    def test_custom_word_limit(self) -> None:
        short = "fault code 47"
        assert classify_query(short, max_simple_words=2) == QueryComplexity.COMPLEX

    def test_empty_query(self) -> None:
        assert classify_query("") == QueryComplexity.COMPLEX

    def test_case_insensitive(self) -> None:
        assert classify_query("FAULT CODE 47") == QueryComplexity.SIMPLE
        assert classify_query("How To Reset VFD") == QueryComplexity.SIMPLE


# ---------------------------------------------------------------------------
# HealthProbe
# ---------------------------------------------------------------------------


class TestHealthProbe:
    """Health probe availability checks."""

    async def test_unavailable_when_url_empty(self) -> None:
        probe = HealthProbe(ollama_url="", interval=30)
        result = await probe.check_once()
        assert result is False
        assert probe.available is False

    async def test_available_when_ollama_responds(self) -> None:
        probe = HealthProbe(ollama_url="http://fake:11434", interval=30)

        mock_response = AsyncMock()
        mock_response.raise_for_status = lambda: None

        with patch("routing.health_probe.httpx.AsyncClient") as mock_client:
            instance = AsyncMock()
            instance.get = AsyncMock(return_value=mock_response)
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = instance

            result = await probe.check_once()
            assert result is True

    async def test_unavailable_on_connection_error(self) -> None:
        probe = HealthProbe(ollama_url="http://unreachable:11434", interval=30, timeout=1)

        with patch("routing.health_probe.httpx.AsyncClient") as mock_client:
            instance = AsyncMock()
            instance.get = AsyncMock(side_effect=ConnectionError("refused"))
            instance.__aenter__ = AsyncMock(return_value=instance)
            instance.__aexit__ = AsyncMock(return_value=False)
            mock_client.return_value = instance

            result = await probe.check_once()
            assert result is False


# ---------------------------------------------------------------------------
# TierRouter.select — provider-based tier selection
# ---------------------------------------------------------------------------


class TestTierRouterSelection:
    """Tier selection returns the correct provider for each scenario."""

    def _make_router(
        self,
        probe_available: bool = True,
        tier2_url: str = "",
        tier1_provider: MagicMock | None = None,
        tier3_provider: MagicMock | None = None,
    ) -> TierRouter:
        probe = HealthProbe(ollama_url="http://charlie:11434", interval=30)
        probe._available = probe_available
        return TierRouter(
            health_probe=probe,
            tier1_provider=tier1_provider or _mock_provider("gemma4:e4b"),
            tier3_provider=tier3_provider or _mock_provider("claude-sonnet-4-6"),
            tier2_gpu_url=tier2_url,
        )

    def test_simple_query_selects_tier1_when_available(self) -> None:
        t1 = _mock_provider("gemma4:e4b")
        router = self._make_router(probe_available=True, tier1_provider=t1)
        sel = router.select("fault code 47 VFD")
        assert sel.tier == Tier.TIER1
        assert sel.complexity == QueryComplexity.SIMPLE
        assert sel.llm is t1
        assert sel.model_name == "gemma4:e4b"

    def test_simple_query_falls_to_tier3_when_unavailable(self) -> None:
        t3 = _mock_provider("claude-sonnet-4-6")
        router = self._make_router(probe_available=False, tier3_provider=t3)
        sel = router.select("fault code 47 VFD")
        assert sel.tier == Tier.TIER3
        assert sel.complexity == QueryComplexity.SIMPLE
        assert sel.llm is t3

    def test_complex_query_routes_to_tier3_when_no_tier2(self) -> None:
        t3 = _mock_provider("claude-sonnet-4-6")
        router = self._make_router(tier2_url="", tier3_provider=t3)
        sel = router.select("Root cause analysis for recurring seal failures on reactor agitator")
        assert sel.tier == Tier.TIER3
        assert sel.complexity == QueryComplexity.COMPLEX
        assert sel.llm is t3

    def test_complex_query_with_tier2_url_still_uses_tier3_provider(self) -> None:
        """Tier 2 slot exists but provider is not yet built — falls to Tier 3."""
        t3 = _mock_provider("claude-sonnet-4-6")
        router = self._make_router(tier2_url="http://runpod:8000", tier3_provider=t3)
        sel = router.select("Root cause analysis for recurring seal failures on reactor agitator")
        # Tier 2 slot routes through to Tier 3 provider since no Tier 2 provider exists yet
        assert sel.tier == Tier.TIER3
        assert sel.llm is t3

    def test_force_tier_overrides_classification(self) -> None:
        t3 = _mock_provider("claude-sonnet-4-6")
        router = self._make_router(probe_available=True, tier3_provider=t3)
        sel = router.select("fault code 47", force_tier="tier3")
        assert sel.tier == Tier.TIER3
        assert sel.llm is t3

    def test_force_tier1_selects_tier1_provider(self) -> None:
        t1 = _mock_provider("gemma4:e4b")
        router = self._make_router(probe_available=False, tier1_provider=t1)
        sel = router.select("fault code 47", force_tier="tier1")
        assert sel.tier == Tier.TIER1
        assert sel.llm is t1

    def test_no_tier3_provider_falls_back_to_tier1(self) -> None:
        """When only Tier 1 is configured, complex queries still get handled."""
        t1 = _mock_provider("gemma4:e4b")
        router = self._make_router(
            probe_available=True,
            tier1_provider=t1,
            tier3_provider=None,
        )
        # Override the None tier3 by constructing directly
        probe = HealthProbe(ollama_url="http://charlie:11434", interval=30)
        probe._available = True
        router = TierRouter(
            health_probe=probe,
            tier1_provider=t1,
            tier3_provider=None,
        )
        sel = router.select("Root cause analysis for recurring seal failures on reactor agitator")
        # Falls back to tier1 since tier3 is None
        assert sel.llm is t1

    def test_no_providers_raises(self) -> None:
        probe = HealthProbe(ollama_url="http://charlie:11434", interval=30)
        probe._available = False
        router = TierRouter(health_probe=probe, tier1_provider=None, tier3_provider=None)
        with pytest.raises(RuntimeError, match="no providers configured"):
            router.select("fault code 47")


# ---------------------------------------------------------------------------
# TierRouter.log_route
# ---------------------------------------------------------------------------


class TestTierRouterLogging:
    """Structured logging of routing decisions."""

    def test_log_route_basic(self, caplog: pytest.LogCaptureFixture) -> None:
        import logging

        sel = TierSelection(
            tier=Tier.TIER1,
            complexity=QueryComplexity.SIMPLE,
            llm=_mock_provider("gemma4:e4b"),
            model_name="gemma4:e4b",
        )
        with caplog.at_level(logging.INFO, logger="mira-sidecar"):
            TierRouter.log_route("fault code 47", sel, latency_ms=1500)
        assert "TIER_ROUTE" in caplog.text
        assert "tier=tier1" in caplog.text
        assert "complexity=SIMPLE" in caplog.text
        assert "latency_ms=1500" in caplog.text

    def test_log_route_fallback(self, caplog: pytest.LogCaptureFixture) -> None:
        import logging

        sel = TierSelection(
            tier=Tier.TIER3,
            complexity=QueryComplexity.SIMPLE,
            llm=_mock_provider("claude-sonnet-4-6"),
            model_name="claude-sonnet-4-6",
        )
        with caplog.at_level(logging.INFO, logger="mira-sidecar"):
            TierRouter.log_route(
                "fault code 47", sel, latency_ms=3000, fallback=True, fallback_reason="tier1_error"
            )
        assert "fallback=true" in caplog.text
        assert "reason=tier1_error" in caplog.text
