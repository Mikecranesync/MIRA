"""Reference values for the paired-comparison statistics (#4576).

Each expected number is computed independently of the code under test: by hand
from the binomial distribution, or taken from the published worked example.
"""

from __future__ import annotations

import math

import pytest

from retrieval_eval import stats


def test_wilson_matches_textbook_value():
    # Newcombe (1998) Table I: 81/263 -> 0.2553 to 0.3662.
    lo, hi = stats.wilson(81, 263)
    assert lo == pytest.approx(0.2553, abs=5e-4)
    assert hi == pytest.approx(0.3662, abs=5e-4)


def test_wilson_bounds_at_the_extremes():
    assert stats.wilson(0, 7)[0] == pytest.approx(0.0, abs=1e-12)
    assert stats.wilson(7, 7)[1] == pytest.approx(1.0)
    assert stats.wilson(7, 7)[0] == pytest.approx(0.6457, abs=5e-4)
    assert stats.wilson(0, 0) is None


def test_mcnemar_exact_matches_hand_binomial():
    # The #4571 walk: +6 / -2. P = 2 * sum_{i<=2} C(8,i) / 2^8 = 2 * 37/256.
    assert stats.mcnemar_exact(2, 6) == pytest.approx(2 * 37 / 256)
    assert stats.mcnemar_exact(6, 2) == stats.mcnemar_exact(2, 6)
    # 1 of 7 refusals lost, nothing gained: p = 1.0.
    assert stats.mcnemar_exact(1, 0) == 1.0
    assert stats.mcnemar_exact(0, 0) == 1.0


def test_mcnemar_needs_six_one_way_discordant_pairs():
    # 2 * 0.5^5 = 0.0625 is not significant; 2 * 0.5^6 = 0.03125 is.
    assert stats.mcnemar_min_discordant() == 6


@pytest.mark.parametrize(
    "a,b,c,d", [(12, 9, 2, 1), (28, 2, 6, 14)]
)  # ad < bc, and ad > bc (continuity step)
def test_newcombe_paired_agrees_with_newcombes_own_sign_convention(a, b, c, d):
    # Newcombe (1998b) method 10 states the interval for theta = p1 - p2 = (b - c)/n
    # as theta - delta .. theta + epsilon. This module reports p2 - p1, so its bounds
    # must be exactly the negated, swapped Newcombe bounds. Derived here in Newcombe's
    # notation, independently of the implementation's arrangement of terms.
    n = a + b + c + d
    p1, p2 = (a + b) / n, (a + c) / n
    l1, u1 = stats.wilson(a + b, n)
    l2, u2 = stats.wilson(a + c, n)
    num = max(a * d - b * c - n / 2, 0) if a * d > b * c else a * d - b * c
    phi = num / math.sqrt((a + b) * (c + d) * (a + c) * (b + d))
    dl2, du2, dl3, du3 = p1 - l1, u1 - p1, p2 - l2, u2 - p2
    theta = (b - c) / n
    lo_n = theta - math.sqrt(dl2**2 - 2 * phi * dl2 * du3 + du3**2)
    hi_n = theta + math.sqrt(du2**2 - 2 * phi * du2 * dl3 + dl3**2)
    lo, hi = stats.newcombe_paired(a, b, c, d)
    assert lo == pytest.approx(-hi_n)
    assert hi == pytest.approx(-lo_n)
    assert lo < (c - b) / n < hi


def test_newcombe_contains_zero_for_the_lexical_walk():
    # 50 rows, 28 both right, 2 off-only, 6 on-only, 14 neither: +8 points, not conclusive.
    lo, hi = stats.newcombe_paired(28, 2, 6, 14)
    assert lo < 0 < hi


def test_cluster_bootstrap_is_deterministic_and_brackets_the_mean():
    pairs = [(f"m{i % 10}", int(i % 3 == 0), int(i % 2 == 0)) for i in range(50)]
    a = stats.cluster_bootstrap_diff(pairs, reps=2000, seed=1)
    b = stats.cluster_bootstrap_diff(pairs, reps=2000, seed=1)
    assert a == b
    mean = sum(x2 - x1 for _, x1, x2 in pairs) / len(pairs)
    assert a[0] <= mean <= a[1]


def test_cluster_bootstrap_is_wider_than_independent_when_clusters_move_together():
    # Every question in a manual moves the same way: a cluster-blind interval
    # would be far too narrow. Five manuals improve fully, five do not move.
    pairs = [(f"m{m}", 0, int(m < 5)) for m in range(10) for _ in range(5)]
    lo, hi = stats.cluster_bootstrap_diff(pairs, reps=4000, seed=7)
    ind_half = 1.96 * math.sqrt(0.5 * 0.5 / 50)
    assert (hi - lo) / 2 > 1.5 * ind_half


def test_n_to_detect_a_refusal_drop():
    # By hand: z(.95)=1.6449, z(.80)=0.8416; (1.6449*sqrt(.95*.05) + 0.8416*sqrt(.85*.15)) / 0.10
    # = 6.590, squared 43.4, rounded up: 44 unanswerable questions for a 95% -> 85% drop.
    assert stats.n_to_detect_drop(0.95, 0.85) == 44


def test_percentile_nearest_rank():
    assert stats.percentile([5, 1, 3, 2, 4], 50) == 3
    assert stats.percentile(list(range(1, 21)), 95) == 19
    assert stats.percentile([], 95) is None
