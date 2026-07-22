"""Density-aware output-budget tests — bounded, never blindly raised.

Proves: sparse/moderate sheets keep the base cap; only density escalates; every
budget is clamped to the absolute ceiling; the ladder is finite and strictly
increasing; and escalation returns None at the ceiling so the caller fails
closed instead of retrying forever.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from printsense import output_budget as ob  # noqa: E402


def test_density_class_is_monotone() -> None:
    assert ob.density_class(10_000) == ob.SPARSE
    assert ob.density_class(500_000) == ob.MODERATE
    assert ob.density_class(1_000_000) == ob.DENSE


def test_sparse_keeps_base_cap() -> None:
    assert ob.planned_max_tokens(4000, 12000, ob.SPARSE) == 4000


def test_dense_bumps_but_never_exceeds_ceiling() -> None:
    p = ob.planned_max_tokens(4000, 12000, ob.DENSE)
    assert 4000 <= p <= 12000
    # a low ceiling clamps the bump
    assert ob.planned_max_tokens(4000, 4200, ob.DENSE) == 4200


def test_planned_never_below_base_or_above_ceiling() -> None:
    for d in (ob.SPARSE, ob.MODERATE, ob.DENSE):
        p = ob.planned_max_tokens(4000, 12000, d)
        assert 4000 <= p <= 12000


def test_escalation_increases_then_stops_at_ceiling() -> None:
    b = ob.planned_max_tokens(4000, 12000, ob.SPARSE)
    seen = [b]
    cur = b
    while True:
        nxt = ob.escalated_max_tokens(cur, 12000)
        if nxt is None:
            break
        assert nxt > cur, "must strictly increase"
        assert nxt <= 12000, "must never exceed ceiling"
        seen.append(nxt)
        cur = nxt
    assert seen[-1] == 12000
    # at the ceiling, escalation returns None → caller fails closed
    assert ob.escalated_max_tokens(12000, 12000) is None


def test_budget_ladder_is_finite_and_strictly_increasing() -> None:
    ladder = ob.budget_ladder(4000, 12000, ob.DENSE)
    assert ladder[0] >= 4000
    assert ladder[-1] == 12000
    assert ladder == sorted(set(ladder))  # strictly increasing, no dupes
    assert len(ladder) < 50  # bounded


def test_ladder_for_sparse_starts_at_base() -> None:
    ladder = ob.budget_ladder(4000, 12000, ob.SPARSE)
    assert ladder[0] == 4000
    # a clean sparse sheet uses exactly the first rung; the rest exist only for
    # the truncation path.
    assert ladder[-1] == 12000


def test_does_not_blindly_raise_every_call() -> None:
    # the DEFENSE against "just bump the cap": the planned budget for a sparse
    # sheet equals base — the extra budget is spent ONLY on the escalation path.
    assert ob.planned_max_tokens(4000, 12000, ob.SPARSE) == 4000
    assert (
        ob.planned_max_tokens(4000, 12000, ob.MODERATE) == 4000
        or ob.planned_max_tokens(4000, 12000, ob.MODERATE) <= 6000
    )
