"""Tests for run_engine.baseline — per-tag per-phase stats over N normal runs.

Pure stdlib `statistics`; no numpy. One sample per normal run per tag (the
run's mean for that tag), then min/max/avg/stddev across those run-means.
"""

from __future__ import annotations

from run_engine.baseline import compute_baseline
from run_engine.models import Reading

UNS = "demo.cell1.conveyor.cv101"


def _r(tag, value, ts):
    return Reading(tag_path=tag, value=value, event_timestamp=float(ts), uns_path=UNS)


class TestComputeBaseline:
    def test_two_normal_runs_one_tag(self):
        # run1 motor_current avg 10, run2 avg 12 -> samples [10, 12]
        run1 = [_r("motor_current", 10.0, 1), _r("motor_current", 10.0, 2)]
        run2 = [_r("motor_current", 12.0, 11), _r("motor_current", 12.0, 12)]
        baseline = compute_baseline([run1, run2], k_sigma=3.0)

        assert ("motor_current", "default") in baseline
        stats = baseline[("motor_current", "default")]
        assert stats.sample_count == 2
        assert stats.min == 10.0
        assert stats.max == 12.0
        assert stats.avg == 11.0
        # population stddev of [10, 12] = 1.0
        assert abs(stats.stddev - 1.0) < 1e-9
        assert stats.k_sigma == 3.0
        assert stats.phase_name == "default"

    def test_multiple_tags(self):
        run1 = [_r("vfd_freq", 50.0, 1), _r("motor_current", 10.0, 1)]
        run2 = [_r("vfd_freq", 50.0, 11), _r("motor_current", 14.0, 11)]
        baseline = compute_baseline([run1, run2], k_sigma=2.0)

        assert baseline[("vfd_freq", "default")].avg == 50.0
        assert baseline[("vfd_freq", "default")].stddev == 0.0
        assert baseline[("motor_current", "default")].avg == 12.0

    def test_run_mean_collapses_many_readings(self):
        # A run with many readings contributes ONE sample (its mean).
        run1 = [_r("motor_current", v, i) for i, v in enumerate([8.0, 10.0, 12.0])]
        run2 = [_r("motor_current", v, 100 + i) for i, v in enumerate([18.0, 20.0, 22.0])]
        baseline = compute_baseline([run1, run2], k_sigma=3.0)
        stats = baseline[("motor_current", "default")]
        # run means: 10 and 20 -> sample_count 2, avg 15
        assert stats.sample_count == 2
        assert stats.avg == 15.0

    def test_empty_returns_empty(self):
        assert compute_baseline([], k_sigma=3.0) == {}
