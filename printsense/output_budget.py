"""Density-aware output-token budgeting for the print interpreter.

The 2026-07-22 benchmark showed a dense sheet (A104) deterministically
truncating its JSON at the 4000-token output cap. The naive fix — raise the cap
for every call — wastes tokens on the common sparse sheet and still has no
principled ceiling. Instead:

* pick a **planned** budget from a coarse density signal (bounded), and
* on a *detected* truncation, **escalate** the budget along a bounded ladder up
  to an absolute ``ceiling`` — never higher, and only when truncation actually
  happened.

Sparse and moderate sheets keep the base cap; only density (a strong pre-signal
or an observed truncation) spends more tokens, and always within the ceiling.
This module is pure arithmetic — the interpret layer supplies the density signal
and consumes the ladder. No env reads here (the caller resolves env → ints).
"""

from __future__ import annotations

# Defaults the interpret layer falls back to (it reads the env and passes ints).
DEFAULT_BASE = 4000  # matches the container's PRINT_VISION_MAX_TOKENS
DEFAULT_CEILING = 12000  # absolute bounded maximum — never exceeded

SPARSE = "sparse"
MODERATE = "moderate"
DENSE = "dense"

# Coarse pre-call thresholds on the density signal (image bytes by default).
# Deliberately conservative: the signal is a weak predictor (A104 was SMALLER
# than a sheet that succeeded), so the pre-call bump is modest and the
# truncation escalation is the real guarantee.
_MODERATE_AT = 400_000
_DENSE_AT = 900_000

# Per-class multipliers on the base budget (all clamped to the ceiling).
_MULTIPLIER = {SPARSE: 1.0, MODERATE: 1.25, DENSE: 1.5}

# Escalation factor applied on each observed truncation.
_ESCALATE_FACTOR = 1.6


def density_class(
    signal: int, *, moderate_at: int = _MODERATE_AT, dense_at: int = _DENSE_AT
) -> str:
    """Map a coarse numeric density signal (image bytes, or a better OCR-token
    count when available) to a class. Monotone and deterministic."""
    if signal >= dense_at:
        return DENSE
    if signal >= moderate_at:
        return MODERATE
    return SPARSE


def planned_max_tokens(base: int, ceiling: int, density: str) -> int:
    """The pre-call budget for a given density, clamped to ``[base, ceiling]``.
    Never below base, never above the ceiling — a bounded maximum."""
    base = max(1, base)
    ceiling = max(base, ceiling)
    want = int(round(base * _MULTIPLIER.get(density, 1.0)))
    return min(max(want, base), ceiling)


def escalated_max_tokens(
    current: int, ceiling: int, *, factor: float = _ESCALATE_FACTOR
) -> int | None:
    """The next budget after an observed truncation, or ``None`` when already at
    the ceiling (caller must then FAIL CLOSED rather than retry forever)."""
    ceiling = max(1, ceiling)
    if current >= ceiling:
        return None
    nxt = int(round(current * factor))
    if nxt <= current:  # factor <= 1 guard — always make progress
        nxt = current + 1
    return min(nxt, ceiling)


def budget_ladder(base: int, ceiling: int, density: str) -> list[int]:
    """The bounded, strictly-increasing sequence of budgets to try: the planned
    budget, then truncation-escalations up to the ceiling. Deduped; finite (it
    terminates at the ceiling). The interpret layer tries each rung only when the
    previous one truncated — so a clean sparse sheet spends exactly one call at
    ``base``."""
    ladder = [planned_max_tokens(base, ceiling, density)]
    cur = ladder[0]
    while True:
        nxt = escalated_max_tokens(cur, ceiling)
        if nxt is None or nxt == cur:
            break
        ladder.append(nxt)
        cur = nxt
    # dedupe preserving order (already strictly increasing, but be defensive)
    seen: set[int] = set()
    out: list[int] = []
    for v in ladder:
        if v not in seen:
            seen.add(v)
            out.append(v)
    return out
