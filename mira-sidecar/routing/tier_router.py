"""Tier router — deterministic query classifier and provider selector.

Routes maintenance queries to the optimal inference tier by selecting
which LLM provider to use for the RAG pipeline:

  Tier 1: Local Gemma 4 E4B via Ollama on Charlie (simple queries, offline)
  Tier 2: Cloud GPU via RunPod/Cloud Run (complex queries, on-demand)
  Tier 3: Claude API via Anthropic (fallback, highest quality)

The classifier is intentionally simple and deterministic — no ML model.
Iterate based on real usage data from structured logs.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import Enum

from llm.base import LLMProvider

from .health_probe import HealthProbe

logger = logging.getLogger("mira-sidecar")

# ---------------------------------------------------------------------------
# Query classification
# ---------------------------------------------------------------------------

SIMPLE_KEYWORDS = [
    "fault code",
    "alarm",
    "step",
    "how to",
    "procedure",
    "what is",
    "check",
    "reset",
    "create work order",
    "work order",
    "pm due",
    "pm schedule",
    "who is on",
    "schedule",
    "history",
    "last replaced",
    "part number",
    "specs",
    "wiring diagram",
]


class QueryComplexity(str, Enum):
    SIMPLE = "SIMPLE"
    COMPLEX = "COMPLEX"


class Tier(str, Enum):
    TIER1 = "tier1"
    TIER2 = "tier2"
    TIER3 = "tier3"


@dataclass
class TierSelection:
    """Result of tier selection — which provider to use for RAG."""

    tier: Tier
    complexity: QueryComplexity
    llm: LLMProvider
    model_name: str


def classify_query(query: str, max_simple_words: int = 40) -> QueryComplexity:
    """Classify a query as SIMPLE or COMPLEX using keyword heuristics.

    SIMPLE: lookup-style queries — fault codes, alarms, procedures, how-tos.
    COMPLEX: multi-step reasoning, long queries, root cause analysis.
    """
    query_lower = query.lower()
    word_count = len(query.split())

    if word_count > max_simple_words:
        return QueryComplexity.COMPLEX

    if any(kw in query_lower for kw in SIMPLE_KEYWORDS):
        return QueryComplexity.SIMPLE

    return QueryComplexity.COMPLEX


# ---------------------------------------------------------------------------
# Tier router
# ---------------------------------------------------------------------------


class TierRouter:
    """Selects which LLM provider to use based on query complexity and tier availability.

    Does NOT call the LLM directly — returns a TierSelection with the chosen
    provider so the caller can pass it to rag_query() or any other pipeline.
    """

    def __init__(
        self,
        health_probe: HealthProbe,
        tier1_provider: LLMProvider | None = None,
        tier3_provider: LLMProvider | None = None,
        tier1_max_query_words: int = 40,
        tier2_gpu_url: str = "",
    ) -> None:
        self._probe = health_probe
        self._tier1 = tier1_provider
        self._tier3 = tier3_provider
        self._max_simple_words = tier1_max_query_words
        self._tier2_url = tier2_gpu_url

    def select(self, query: str, force_tier: str | None = None) -> TierSelection:
        """Determine which tier and provider should handle this query.

        Returns a TierSelection containing the chosen LLM provider.
        Falls back to Tier 3 when Tier 1 is unavailable or query is complex.
        """
        complexity = classify_query(query, self._max_simple_words)

        if force_tier:
            tier = Tier(force_tier)
        elif complexity == QueryComplexity.SIMPLE and self._probe.available and self._tier1:
            tier = Tier.TIER1
        elif complexity == QueryComplexity.COMPLEX and self._tier2_url:
            # Tier 2 slot — not yet activated, fall through to Tier 3
            # When activated: would return a Tier 2 provider here
            tier = Tier.TIER3
        else:
            tier = Tier.TIER3

        # Select the provider for the chosen tier
        if tier == Tier.TIER1 and self._tier1:
            return TierSelection(
                tier=Tier.TIER1,
                complexity=complexity,
                llm=self._tier1,
                model_name=self._tier1.model_name,
            )

        # Tier 2 and Tier 3 both use the Tier 3 provider for now
        if self._tier3:
            return TierSelection(
                tier=tier if tier != Tier.TIER1 else Tier.TIER3,
                complexity=complexity,
                llm=self._tier3,
                model_name=self._tier3.model_name,
            )

        # Last resort: Tier 1 provider even for complex queries
        if self._tier1:
            return TierSelection(
                tier=Tier.TIER1,
                complexity=complexity,
                llm=self._tier1,
                model_name=self._tier1.model_name,
            )

        raise RuntimeError("TierRouter has no providers configured")

    @staticmethod
    def log_route(
        query: str,
        selection: TierSelection,
        latency_ms: int,
        fallback: bool = False,
        fallback_reason: str = "",
    ) -> None:
        """Log a structured routing decision."""
        parts = [
            f"TIER_ROUTE query_words={len(query.split())}",
            f"complexity={selection.complexity.value}",
            f"tier={selection.tier.value}",
            f"latency_ms={latency_ms}",
            f"model={selection.model_name}",
        ]
        if fallback:
            parts.append(f"fallback=true reason={fallback_reason}")
        logger.info(" ".join(parts))
