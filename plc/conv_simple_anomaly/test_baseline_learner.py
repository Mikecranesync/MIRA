"""
Deterministic unit tests for baseline_learner.
Run: pytest plc/conv_simple_anomaly/test_baseline_learner.py -v
"""
from baseline_learner import learn_paired_lag, learn_signal_baseline


def test_learns_range_and_stats():
    samples = [(0.0, 12.0, "good"), (1.0, 12.0, "good"),
               (2.0, 11.9, "good"), (3.0, 12.1, "good")]
    b = learn_signal_baseline("bowl", samples, "steady-run", min_sample_count=3)
    assert b.lo == 11.9 and b.hi == 12.1
    assert abs(b.mean - 12.0) < 0.1
    assert b.stddev >= 0.0
    assert b.sample_count == 4 and b.sufficient
    assert b.window_s == 3.0


def test_skips_bad_quality():
    samples = [(0.0, 12.0, "good"), (1.0, 999.0, "bad"), (2.0, 11.5, "good")]
    b = learn_signal_baseline("bowl", samples, min_sample_count=1)
    assert b.hi == 12.0 and b.lo == 11.5  # the 999 'bad' sample is excluded


def test_insufficient_flagged():
    b = learn_signal_baseline("x", [(0.0, 1.0, "good")], min_sample_count=10)
    assert not b.sufficient and b.sample_count == 1


def test_empty_is_safe():
    b = learn_signal_baseline("x", [], min_sample_count=1)
    assert b.lo is None and b.mean is None and not b.sufficient


def test_paired_lag():
    lag = learn_paired_lag("a", "b", [10.0, 20.0], [10.4, 20.5], min_pair_count=1)
    assert lag.pair_count == 2
    assert abs(lag.normal_lag_s - 0.45) < 1e-6
    assert lag.sufficient


def test_paired_lag_empty_is_safe():
    lag = learn_paired_lag("a", "b", [], [], min_pair_count=1)
    assert lag.normal_lag_s is None and not lag.sufficient
