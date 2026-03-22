"""Composite scorer — blends CONTAINS check + LLM-as-judge into PASS/FAIL.

Two modes:
  - Fast path (CI): CONTAINS-only, threshold 0.70
  - Full path (nightly): weighted blend of CONTAINS + LLM judge, threshold 0.80
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .thresholds import CONTAINS_WEIGHT, LLM_JUDGE_WEIGHT, get_threshold


@dataclass
class CaseResult:
    """Result for a single evaluated case, used across all regimes."""

    case_id: str
    regime: str
    contains_score: float = 0.0        # 0.0-1.0 keyword match
    llm_judge_score: float = 0.0       # 1.0-5.0 (0.0 if skipped)
    composite_score: float = 0.0       # weighted blend
    passed: bool = False
    failure_bucket: str | None = None
    latency_ms: int = 0
    raw_response: str = ""
    metadata: dict = field(default_factory=dict)


@dataclass
class RunResult:
    """Aggregate result for a single regime run."""

    run_id: str
    timestamp: str
    regime: str
    total_cases: int = 0
    passed_cases: int = 0
    pass_rate: float = 0.0
    avg_latency_ms: float = 0.0
    results: list[CaseResult] = field(default_factory=list)
    duration_seconds: float = 0.0


def compute_composite(
    contains_score: float,
    llm_judge_score: float = 0.0,
    *,
    fast: bool = False,
) -> float:
    """Compute composite score from CONTAINS and LLM judge scores.

    Args:
        contains_score: 0.0-1.0 keyword match fraction
        llm_judge_score: 1.0-5.0 LLM judge score (ignored in fast mode)
        fast: if True, return contains_score directly (no LLM weight)

    Returns:
        Composite score (0.0-1.0)
    """
    if fast or llm_judge_score == 0.0:
        return contains_score

    normalized_judge = llm_judge_score / 5.0
    return (contains_score * CONTAINS_WEIGHT) + (normalized_judge * LLM_JUDGE_WEIGHT)


def evaluate_pass(
    composite_score: float,
    regime: str,
    *,
    fast: bool = False,
    threshold_override: float | None = None,
) -> bool:
    """Determine if a composite score passes the threshold."""
    threshold = threshold_override or get_threshold(regime, fast=fast)
    return composite_score >= threshold


def build_case_result(
    case_id: str,
    regime: str,
    contains_score: float,
    llm_judge_score: float = 0.0,
    failure_bucket: str | None = None,
    latency_ms: int = 0,
    raw_response: str = "",
    metadata: dict | None = None,
    *,
    fast: bool = False,
    threshold_override: float | None = None,
) -> CaseResult:
    """Build a CaseResult with composite scoring applied."""
    composite = compute_composite(contains_score, llm_judge_score, fast=fast)
    passed = evaluate_pass(composite, regime, fast=fast, threshold_override=threshold_override)

    # Override pass if hallucination detected
    if failure_bucket == "HALLUCINATION":
        passed = False

    return CaseResult(
        case_id=case_id,
        regime=regime,
        contains_score=contains_score,
        llm_judge_score=llm_judge_score,
        composite_score=round(composite, 4),
        passed=passed,
        failure_bucket=failure_bucket if not passed else None,
        latency_ms=latency_ms,
        raw_response=raw_response,
        metadata=metadata or {},
    )


def aggregate_run(
    run_id: str,
    timestamp: str,
    regime: str,
    results: list[CaseResult],
    duration_seconds: float = 0.0,
) -> RunResult:
    """Aggregate individual CaseResults into a RunResult."""
    total = len(results)
    passed = sum(1 for r in results if r.passed)
    pass_rate = passed / total if total > 0 else 0.0
    avg_latency = sum(r.latency_ms for r in results) / total if total > 0 else 0.0

    return RunResult(
        run_id=run_id,
        timestamp=timestamp,
        regime=regime,
        total_cases=total,
        passed_cases=passed,
        pass_rate=round(pass_rate, 4),
        avg_latency_ms=round(avg_latency, 1),
        results=results,
        duration_seconds=round(duration_seconds, 2),
    )
