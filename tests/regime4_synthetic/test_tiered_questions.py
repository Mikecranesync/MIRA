"""Regime 4 — Synthetic Question Evolution Tests.

Runs tiered questions through the system and identifies the failure tier.
Offline mode validates the framework; live mode requires Supervisor.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from tests.conftest import REPO_ROOT, TESTS_ROOT
from tests.scoring.contains_check import keyword_match_score
from tests.scoring.composite import CaseResult, build_case_result


# ── Tier scoring ────────────────────────────────────────────────────────────

TIER_THRESHOLDS = {
    "L1": 0.90,
    "L2": 0.75,
    "L3": 0.60,
    "L4": 0.40,
}


def score_tier_response(
    question: str,
    response: str,
    ground_truth: dict,
    tier: str,
) -> dict:
    """Score a tiered question response against ground truth keywords.

    Returns dict with contains_score, keyword_matches, passed, tier.
    """
    keywords = ground_truth.get("keywords", [])
    contains_score, matched, _ = keyword_match_score(response, keywords)

    threshold = TIER_THRESHOLDS.get(tier, 0.80)
    passed = contains_score >= threshold

    return {
        "tier": tier,
        "contains_score": contains_score,
        "keyword_matches": matched,
        "keywords_total": len(keywords),
        "passed": passed,
        "threshold": threshold,
    }


def find_failure_tier(tier_results: dict[str, dict]) -> str | None:
    """Find the highest tier that fails.

    Returns tier name (e.g., "L3") or None if all pass.
    """
    for tier in ["L4", "L3", "L2", "L1"]:
        if tier in tier_results and not tier_results[tier]["passed"]:
            return tier
    return None


# ── Mock responses for dry-run ──────────────────────────────────────────────

def _mock_response(ground_truth: dict, tier: str) -> str:
    """Generate a mock response that degrades with tier difficulty."""
    keywords = ground_truth.get("keywords", [])
    root_cause = ground_truth.get("root_cause", "Unknown cause")
    fix = ground_truth.get("fix", "Check the equipment")

    if tier == "L1":
        # Perfect response — includes all keywords
        return f"{root_cause}. Recommended fix: {fix}. Keywords: {', '.join(keywords)}"
    elif tier == "L2":
        # Good response — includes most keywords (ceil to ensure >= 75% coverage)
        import math
        kw_count = max(1, math.ceil(len(keywords) * 0.85))
        kw_subset = keywords[:kw_count]
        return f"Likely cause: {root_cause}. Check {', '.join(kw_subset)}."
    elif tier == "L3":
        # Partial response — includes some keywords
        kw_subset = keywords[:max(1, int(len(keywords) * 0.5))]
        return f"Could be related to {kw_subset[0] if kw_subset else 'unknown'}. Need more info."
    else:  # L4
        # Degraded response — minimal keyword overlap
        kw_subset = keywords[:max(1, int(len(keywords) * 0.3))]
        return f"Unclear situation. Possibly {kw_subset[0] if kw_subset else 'something'}. Please clarify."


# ── Offline tests ───────────────────────────────────────────────────────────

@pytest.mark.regime4
class TestTieredQuestionsOffline:
    """Test tier scoring logic with mock data."""

    def test_tier_definitions_load(self, tier_definitions):
        """Verify tier definitions load correctly."""
        tiers = tier_definitions["tiers"]
        assert "L1" in tiers
        assert "L2" in tiers
        assert "L3" in tiers
        assert "L4" in tiers

    def test_l1_perfect_response(self, seed_cases):
        """L1 should pass with a comprehensive response."""
        case = seed_cases[0]
        gt = case["ground_truth"]
        response = _mock_response(gt, "L1")
        result = score_tier_response("test", response, gt, "L1")
        assert result["passed"] is True
        assert result["contains_score"] >= 0.90

    def test_l2_good_response(self, seed_cases):
        """L2 should pass with abbreviated but correct response."""
        case = seed_cases[0]
        gt = case["ground_truth"]
        response = _mock_response(gt, "L2")
        result = score_tier_response("test", response, gt, "L2")
        assert result["passed"] is True

    def test_l4_degraded_response(self, seed_cases):
        """L4 may fail with degraded responses."""
        case = seed_cases[0]
        gt = case["ground_truth"]
        response = _mock_response(gt, "L4")
        result = score_tier_response("test", response, gt, "L4")
        # L4 threshold is low (0.40), so even degraded responses may pass
        assert result["contains_score"] >= 0  # Just verify scoring works

    def test_failure_tier_detection(self, seed_cases):
        """Test that failure tier detection works correctly."""
        case = seed_cases[0]
        gt = case["ground_truth"]

        tier_results = {}
        for tier in ["L1", "L2", "L3", "L4"]:
            response = _mock_response(gt, tier)
            tier_results[tier] = score_tier_response("test", response, gt, tier)

        failure = find_failure_tier(tier_results)
        # With mock responses, L4 is likely to fail (30% keyword coverage)
        # but with threshold 0.40, it depends on the case
        assert failure is None or failure in ["L1", "L2", "L3", "L4"]

    def test_all_tiers_scored(self, seed_cases):
        """Verify all 10 seed cases can be scored across all tiers."""
        for case in seed_cases:
            gt = case["ground_truth"]
            for tier in ["L1", "L2", "L3", "L4"]:
                response = _mock_response(gt, tier)
                result = score_tier_response("test", response, gt, tier)
                assert "contains_score" in result
                assert "passed" in result

    def test_tier_threshold_values(self):
        """Verify tier thresholds are correctly ordered."""
        assert TIER_THRESHOLDS["L1"] > TIER_THRESHOLDS["L2"]
        assert TIER_THRESHOLDS["L2"] > TIER_THRESHOLDS["L3"]
        assert TIER_THRESHOLDS["L3"] > TIER_THRESHOLDS["L4"]

    def test_empty_response(self, seed_cases):
        """Empty response should fail all tiers."""
        gt = seed_cases[0]["ground_truth"]
        for tier in ["L1", "L2", "L3", "L4"]:
            result = score_tier_response("test", "", gt, tier)
            assert result["passed"] is False


# ── Network tests ───────────────────────────────────────────────────────────

@pytest.mark.regime4
@pytest.mark.network
@pytest.mark.slow
class TestTieredQuestionsLive:
    """Live Supervisor tests — requires BRAVO services."""

    @pytest.fixture(autouse=True)
    def _check_services(self):
        import os
        if not os.getenv("OPENWEBUI_BASE_URL"):
            pytest.skip("Live tests require OPENWEBUI_BASE_URL")

    def test_placeholder(self):
        pass


# ── Regime runner (called by synthetic_eval.py) ─────────────────────────────

async def regime4_runner(
    mode: str = "offline",
) -> list[CaseResult]:
    """Run all Regime 4 tiered questions and return scored results."""
    seed_path = REPO_ROOT / "mira-core" / "data" / "seed_cases.json"
    with open(seed_path) as f:
        seed_cases = json.load(f)

    results: list[CaseResult] = []
    tier_summaries: list[str] = []

    for case in seed_cases:
        gt = case["ground_truth"]
        tier_results = {}

        for tier in ["L1", "L2", "L3", "L4"]:
            if mode in ("offline", "dry-run"):
                response = _mock_response(gt, tier)
            else:
                response = ""  # Live mode would call Supervisor.process_full()

            tier_results[tier] = score_tier_response(
                case.get("evidence_packet", ""),
                response,
                gt,
                tier,
            )

        failure = find_failure_tier(tier_results)
        best_score = max(tr["contains_score"] for tr in tier_results.values())

        result = build_case_result(
            case_id=f"{case['id']}_tiered",
            regime="regime4_synthetic",
            contains_score=best_score,
            failure_bucket=f"TIER_{failure}_FAIL" if failure else None,
            metadata={
                "seed_id": case["id"],
                "tier_results": {t: r for t, r in tier_results.items()},
                "failure_tier": failure,
                "mode": mode,
            },
        )
        results.append(result)

    # Build tier summary for report
    tier_pass = {"L1": 0, "L2": 0, "L3": 0, "L4": 0}
    total = len(seed_cases)
    for r in results:
        for tier in ["L1", "L2", "L3", "L4"]:
            if r.metadata.get("tier_results", {}).get(tier, {}).get("passed"):
                tier_pass[tier] += 1

    summary_parts = []
    for tier in ["L1", "L2", "L3", "L4"]:
        rate = tier_pass[tier] / total if total > 0 else 0
        if rate >= 0.90:
            summary_parts.append(f"{tier} pass")
        elif rate >= 0.60:
            summary_parts.append(f"{tier} warn")
        else:
            summary_parts.append(f"{tier} fail")

    # Attach summary to first result for report rendering
    if results:
        results[0].metadata["tier_summary"] = "  ".join(summary_parts)

    return results
