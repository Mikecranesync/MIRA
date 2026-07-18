"""UNSEEN generalization lane (UNSEEN-5) — see README.md in this directory.

Frozen novel-content probe corpus, SEPARATE from every calibration corpus.
NEVER used for calibration, prompts, fixtures, or tuning — it exists to
measure generalization (the seen-vs-unseen delta is the overfit metric)."""

from .cases import (
    PAGE_TRUTH_TOKENS,
    UNSEEN_BASE,
    UNSEEN_CASES,
    UNSEEN_VERSION,
    expectations_digest,
    expectations_frozen_ok,
)

__all__ = [
    "PAGE_TRUTH_TOKENS",
    "UNSEEN_BASE",
    "UNSEEN_CASES",
    "UNSEEN_VERSION",
    "expectations_digest",
    "expectations_frozen_ok",
]
