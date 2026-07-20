"""Hermetic tests for the best-of-N acceptance lane's pure pieces.

No network, no Doppler, no metered call, no submit — the real per-case run is
out-of-band (gated on a budget declaration). This covers only the pure guard +
pricing logic that bounds it: cost is summed AFTER each case and the guard trips
once cumulative spend reaches the ceiling (overshoot bounded by one case).
"""

import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import best_of_n  # noqa: E402


def test_price_usage_sums_input_and_output():
    cost = best_of_n.price_usage({"input_tokens": 1000, "output_tokens": 2000}, 0.001, 0.002)
    assert cost == (1000 / 1000) * 0.001 + (2000 / 1000) * 0.002  # 0.001 + 0.004


def test_price_usage_none_or_empty_is_zero():
    assert best_of_n.price_usage(None, 0.001, 0.001) == 0.0
    assert best_of_n.price_usage({}, 0.001, 0.001) == 0.0


def test_spend_guard_allows_until_ceiling_then_trips():
    guard = best_of_n.SpendGuard(ceiling_usd=1.0)
    assert guard.record("c01", 0.4) is True  # 0.4 < 1.0 -> keep going
    assert guard.tripped is False
    assert guard.record("c02", 0.4) is True  # 0.8 < 1.0 -> keep going
    assert guard.record("c03", 0.4) is False  # 1.2 >= 1.0 -> trip, stop launching
    assert guard.tripped is True
    # overshoot is bounded by exactly one case's cost (checked AFTER the case)
    assert round(guard.spent_usd, 4) == 1.2


def test_spend_guard_records_each_case_in_order():
    guard = best_of_n.SpendGuard(ceiling_usd=10.0)
    guard.record("c01", 0.1)
    guard.record("c02", 0.2)
    assert [cid for cid, _ in guard.records] == ["c01", "c02"]
    assert guard.tripped is False


def test_spend_guard_trips_exactly_at_the_line():
    guard = best_of_n.SpendGuard(ceiling_usd=0.5)
    assert guard.record("c01", 0.5) is False  # >= ceiling trips
    assert guard.tripped is True


def test_flagged_cases_are_the_three_variance_cases():
    # The ROUND5 Addendum 3 "multi-sample on flagged cases" set.
    assert best_of_n.FLAGGED_CASES == ("c01", "c03", "c07")
