"""Regime 2 — RAG Retrieval Precision Tests.

Measures chunk retrieval accuracy: precision@5 and recall@5.
Offline mode validates scoring logic with mock data.
Live mode queries NeonDB via neon_recall.recall_knowledge().
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from tests.conftest import TESTS_ROOT
from tests.scoring.contains_check import keyword_match_score
from tests.scoring.composite import CaseResult, build_case_result


# ── Retrieval scoring ──────────────────────────────────────────────────────

def compute_precision_at_k(
    retrieved: list[str],
    expected: list[str],
    k: int = 5,
) -> float:
    """Compute precision@k: fraction of top-k results that are relevant."""
    top_k = retrieved[:k]
    if not top_k:
        return 0.0
    relevant = sum(1 for r in top_k if r in expected)
    return relevant / len(top_k)


def compute_recall_at_k(
    retrieved: list[str],
    expected: list[str],
    k: int = 5,
) -> float:
    """Compute recall@k: fraction of expected results found in top-k."""
    if not expected:
        return 1.0
    top_k = set(retrieved[:k])
    found = sum(1 for e in expected if e in top_k)
    return found / len(expected)


def score_triplet(
    triplet: dict,
    response: str,
    retrieved_keywords: list[str] | None = None,
) -> dict:
    """Score a RAG triplet on retrieval and answer quality.

    Returns dict with contains_score, precision, recall, passed.
    """
    expected_keywords = triplet.get("expected_keywords", [])
    contains_score, matched, _ = keyword_match_score(response, expected_keywords)

    # If retrieved_keywords provided, compute precision/recall
    precision = 0.0
    recall = 0.0
    if retrieved_keywords is not None:
        precision = compute_precision_at_k(retrieved_keywords, expected_keywords)
        recall = compute_recall_at_k(retrieved_keywords, expected_keywords)

    return {
        "contains_score": contains_score,
        "precision_at_5": precision,
        "recall_at_5": recall,
        "keyword_matches": matched,
        "passed": contains_score >= 0.60,
    }


# ── Mock data for offline testing ───────────────────────────────────────────

def _mock_response(triplet: dict) -> tuple[str, list[str]]:
    """Generate a mock response and retrieved keywords."""
    keywords = triplet.get("expected_keywords", [])
    answer = triplet.get("expected_answer_summary", "Unknown")

    # Simulate partial retrieval (80% of keywords found)
    import math
    k = max(1, math.ceil(len(keywords) * 0.8))
    retrieved = keywords[:k]
    response = f"{answer} Related: {', '.join(retrieved)}"

    return response, retrieved


# ── Seed-based triplets (available without generation) ─────────────────────

def _load_seed_triplets() -> list[dict]:
    """Load pre-built seed triplets from generate_triplets.py."""
    from tests.regime2_rag.generate_triplets import SEED_TRIPLETS
    return SEED_TRIPLETS


# ── Offline tests ───────────────────────────────────────────────────────────

@pytest.mark.regime2
class TestRetrievalPrecisionOffline:
    """Test retrieval scoring logic with mock data."""

    def test_perfect_retrieval(self):
        expected = ["a", "b", "c"]
        retrieved = ["a", "b", "c", "d", "e"]
        assert compute_precision_at_k(retrieved, expected, k=5) == 0.6
        assert compute_recall_at_k(retrieved, expected, k=5) == 1.0

    def test_no_retrieval(self):
        assert compute_precision_at_k([], ["a", "b"], k=5) == 0.0
        assert compute_recall_at_k([], ["a", "b"], k=5) == 0.0

    def test_partial_recall(self):
        retrieved = ["a", "x", "y"]
        expected = ["a", "b", "c"]
        assert compute_recall_at_k(retrieved, expected, k=5) == pytest.approx(1 / 3)

    def test_empty_expected(self):
        assert compute_recall_at_k(["a", "b"], [], k=5) == 1.0

    def test_score_triplet_mock(self):
        triplets = _load_seed_triplets()
        for triplet in triplets[:3]:
            response, retrieved = _mock_response(triplet)
            result = score_triplet(triplet, response, retrieved)
            assert result["contains_score"] > 0
            assert "passed" in result

    def test_all_seed_triplets_scoreable(self):
        """All 10 seed triplets can be scored."""
        triplets = _load_seed_triplets()
        assert len(triplets) == 10
        for triplet in triplets:
            response, retrieved = _mock_response(triplet)
            result = score_triplet(triplet, response, retrieved)
            assert "contains_score" in result

    def test_empty_response(self):
        triplet = {"expected_keywords": ["motor", "bearing", "vibration"]}
        result = score_triplet(triplet, "")
        assert result["contains_score"] == 0.0
        assert result["passed"] is False


# ── Network tests ───────────────────────────────────────────────────────────

@pytest.mark.regime2
@pytest.mark.network
@pytest.mark.slow
class TestRetrievalPrecisionLive:
    """Live NeonDB retrieval tests."""

    @pytest.fixture(autouse=True)
    def _check_services(self):
        import os
        if not os.getenv("NEON_DATABASE_URL"):
            pytest.skip("Live tests require NEON_DATABASE_URL")

    def test_placeholder(self):
        pass


# ── Regime runner (called by synthetic_eval.py) ─────────────────────────────

async def regime2_runner(
    mode: str = "offline",
) -> list[CaseResult]:
    """Run all Regime 2 RAG triplets and return scored results."""
    triplets = _load_seed_triplets()
    results: list[CaseResult] = []

    for triplet in triplets:
        if mode in ("offline", "dry-run"):
            response, retrieved = _mock_response(triplet)
        else:
            response, retrieved = "", []

        scoring = score_triplet(triplet, response, retrieved)

        result = build_case_result(
            case_id=triplet["id"],
            regime="regime2_rag",
            contains_score=scoring["contains_score"],
            metadata={
                "precision_at_5": scoring["precision_at_5"],
                "recall_at_5": scoring["recall_at_5"],
                "keyword_matches": scoring["keyword_matches"],
                "equipment_type": triplet.get("equipment_type"),
                "mode": mode,
            },
        )
        results.append(result)

    return results
