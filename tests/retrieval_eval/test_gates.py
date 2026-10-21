"""Gate A1 must pass a no-op change and fail a real regression (#4576)."""

from __future__ import annotations

import pytest

from retrieval_eval import gates, stats


@pytest.mark.parametrize(
    "lost,gained",
    [(3, 0), (2, 1), (1, 0), (0, 0)],  # the #4460 same-build repeats and smaller
)
def test_a1_passes_every_observed_no_op(lost, gained):
    ok, why = gates.a1_citation(lost, gained)
    assert ok, why


@pytest.mark.parametrize("lost,gained", [(4, 0), (5, 1), (6, 0), (8, 3)])
def test_a1_fails_losses_beyond_the_noise_floor(lost, gained):
    ok, _ = gates.a1_citation(lost, gained)
    assert not ok


def test_a1_passes_the_lexical_idf_walk():
    assert gates.a1_citation(2, 6)[0]


def test_why_a_newcombe_lower_bound_rule_was_rejected():
    # A worst-case no-op (3 lost, 0 gained of 50, 30 right in both arms) has a lower bound of
    # about -13.6 points, so "lower bound > -10 points" would fail an unchanged build.
    lo, _ = stats.newcombe_paired(30, 3, 0, 17)
    assert lo < -0.10
