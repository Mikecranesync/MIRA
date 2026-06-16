"""Pass/fail threshold constants for MIRA evaluation regimes."""

# Default composite threshold (nightly / full-judge runs)
DEFAULT_THRESHOLD = 0.80

# Fast-path threshold (CI, CONTAINS-only, no LLM judge)
FAST_THRESHOLD = 0.70

# Regime-specific overrides (regime_name -> threshold)
REGIME_THRESHOLDS: dict[str, float] = {
    "regime1_telethon": 0.80,
    "regime2_rag": 0.80,
    "regime3_nameplate": 0.90,
    "regime4_synthetic": 0.80,
    "regime5_nemotron": 0.80,
}

# Scoring weights for composite calculation
CONTAINS_WEIGHT = 0.40
LLM_JUDGE_WEIGHT = 0.60

# LLM-as-judge verdict thresholds (from prejudged_benchmark_run.py)
VERDICT_THRESHOLDS: list[tuple[float, str]] = [
    (8.5, "excellent"),
    (7.0, "good"),
    (5.0, "acceptable"),
    (3.0, "poor"),
]


def get_threshold(regime: str, *, fast: bool = False) -> float:
    """Return the pass/fail threshold for a regime."""
    if fast:
        return FAST_THRESHOLD
    return REGIME_THRESHOLDS.get(regime, DEFAULT_THRESHOLD)


def compute_verdict(composite: float) -> str:
    """Map composite score (0-10) to verdict string."""
    for threshold, label in VERDICT_THRESHOLDS:
        if composite >= threshold:
            return label
    return "failed"
