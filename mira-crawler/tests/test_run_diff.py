"""Tests for run_engine.diff — observed-vs-baseline anomaly diffs + severity.

delta = observed_avg - baseline_avg; severity by sigma distance using k_sigma:
  |delta| > k_sigma*stddev -> critical; > 1*stddev -> warning; else info.
Any warning/critical diff => run status 'anomalous'.
"""

from __future__ import annotations

from run_engine.diff import compute_run_diff, run_status_from_diffs
from run_engine.models import PhaseStats, Reading

UNS = "demo.cell1.conveyor.cv101"


def _r(tag, value, ts):
    return Reading(tag_path=tag, value=value, event_timestamp=float(ts), uns_path=UNS)


def _baseline(tag="motor_current", avg=11.0, stddev=1.0, k_sigma=3.0):
    return {
        (tag, "default"): PhaseStats(
            tag_path=tag, phase_name="default", min=10.0, max=12.0,
            avg=avg, stddev=stddev, sample_count=2, k_sigma=k_sigma,
        )
    }


class TestSeverity:
    def test_far_deviation_is_critical(self):
        baseline = _baseline(avg=11.0, stddev=1.0)
        observed = [_r("motor_current", 80.0, 1), _r("motor_current", 80.0, 2)]
        diffs = compute_run_diff(observed, baseline, k_sigma=3.0)
        assert len(diffs) == 1
        d = diffs[0]
        assert d.severity == "critical"
        assert d.observed == 80.0
        assert d.baseline == 11.0
        assert d.delta == 69.0
        assert abs(d.delta_percent - (69.0 / 11.0 * 100.0)) < 1e-9

    def test_moderate_deviation_is_warning(self):
        # stddev 1, k_sigma 3 -> warning band is (1, 3]; delta 2 -> warning
        baseline = _baseline(avg=11.0, stddev=1.0)
        observed = [_r("motor_current", 13.0, 1)]
        diffs = compute_run_diff(observed, baseline, k_sigma=3.0)
        assert diffs[0].severity == "warning"
        assert diffs[0].delta == 2.0

    def test_within_one_sigma_is_info(self):
        baseline = _baseline(avg=11.0, stddev=1.0)
        observed = [_r("motor_current", 11.5, 1)]
        diffs = compute_run_diff(observed, baseline, k_sigma=3.0)
        assert diffs[0].severity == "info"

    def test_zero_stddev_nonzero_delta_is_critical(self):
        baseline = _baseline(avg=50.0, stddev=0.0)
        observed = [_r("motor_current", 55.0, 1)]
        diffs = compute_run_diff(observed, baseline, k_sigma=3.0)
        assert diffs[0].severity == "critical"

    def test_zero_stddev_zero_delta_is_info(self):
        baseline = _baseline(avg=50.0, stddev=0.0)
        observed = [_r("motor_current", 50.0, 1)]
        diffs = compute_run_diff(observed, baseline, k_sigma=3.0)
        assert diffs[0].severity == "info"


class TestNoBaselineTag:
    def test_observed_tag_absent_from_baseline_is_skipped(self):
        baseline = _baseline(tag="motor_current")
        observed = [_r("some_other_tag", 999.0, 1)]
        diffs = compute_run_diff(observed, baseline, k_sigma=3.0)
        assert diffs == []


class TestRunStatus:
    def test_any_critical_is_anomalous(self):
        baseline = _baseline(avg=11.0, stddev=1.0)
        observed = [_r("motor_current", 80.0, 1)]
        diffs = compute_run_diff(observed, baseline, k_sigma=3.0)
        assert run_status_from_diffs(diffs) == "anomalous"

    def test_all_info_is_closed(self):
        baseline = _baseline(avg=11.0, stddev=1.0)
        observed = [_r("motor_current", 11.2, 1)]
        diffs = compute_run_diff(observed, baseline, k_sigma=3.0)
        assert run_status_from_diffs(diffs) == "closed"

    def test_empty_is_closed(self):
        assert run_status_from_diffs([]) == "closed"
