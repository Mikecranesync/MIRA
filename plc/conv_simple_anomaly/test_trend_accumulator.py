"""Offline unit tests for the trend accumulator (no bench, synthetic samples)."""
from __future__ import annotations
from trend_accumulator import TrendAccumulator
import rules


def _feed(acc, tag, series, t0=0.0, dt=1.0, quality="good"):
    """Feed a value series at dt spacing starting at t0; return the final timestamp."""
    t = t0
    for v in series:
        acc.update(tag, v, t, quality)
        t += dt
    return t - dt


def test_stable_flat_data():
    acc = TrendAccumulator()
    last = _feed(acc, "vfd_dc_bus_v", [320.0] * 60)
    s = acc.summarize("vfd_dc_bus_v", now=last, window_s=60)
    assert s.direction == "frozen"          # truly unchanged for >5s reads as frozen
    assert s.min_val == s.max_val == 320.0
    assert abs(s.rate_per_min) < 0.5


def test_wiggling_is_not_frozen():
    acc = TrendAccumulator()
    series = [320.0 + (0.3 if i % 2 else -0.3) for i in range(60)]  # tiny dither, always changing
    last = _feed(acc, "vfd_dc_bus_v", series)
    s = acc.summarize("vfd_dc_bus_v", now=last, window_s=60)
    assert s.direction != "frozen"          # a continuously-changing signal must not read frozen
    assert s.min_val == 319.7 and s.max_val == 320.3


def test_rising_ramp():
    acc = TrendAccumulator()
    last = _feed(acc, "temperature", [20.0 + i * 0.5 for i in range(60)])  # +0.5/s = +30/min
    s = acc.summarize("temperature", now=last, window_s=60)
    assert s.direction == "rising"
    assert s.rate_per_min > 25


def test_falling_ramp():
    acc = TrendAccumulator()
    last = _feed(acc, "vfd_dc_bus_v", [340.0 - i * 0.4 for i in range(50)])
    s = acc.summarize("vfd_dc_bus_v", now=last, window_s=60)
    assert s.direction == "falling"
    assert s.rate_per_min < -0.5


def test_distance_to_threshold_band_sign():
    acc = TrendAccumulator()
    # DC bus inside the band [250, 410] -> positive headroom to nearest limit
    last = _feed(acc, "vfd_dc_bus_v", [317.0] * 10)
    s = acc.summarize("vfd_dc_bus_v", now=last, window_s=60)
    assert s.threshold_lo == rules.DEFAULT_CFG["dc_bus_lo_v"]
    assert s.threshold_hi == rules.DEFAULT_CFG["dc_bus_hi_v"]
    assert s.distance_to_threshold == min(317.0 - 250.0, 410.0 - 317.0)  # = 67.0


def test_distance_negative_when_violated():
    acc = TrendAccumulator()
    last = _feed(acc, "vfd_current_a", [7.5] * 10)  # > motor_fla_a default 5.0
    s = acc.summarize("vfd_current_a", now=last, window_s=60)
    assert s.threshold_hi == rules.DEFAULT_CFG["motor_fla_a"]
    assert s.distance_to_threshold == 5.0 - 7.5     # negative = overcurrent


def test_no_data_summary():
    acc = TrendAccumulator()
    s = acc.summarize("never_seen", now=100.0, window_s=60)
    assert s.quality == "no_data" and s.current is None and s.direction == "unknown"


def test_bad_quality_excluded_marks_stale():
    acc = TrendAccumulator()
    _feed(acc, "vfd_voltage_v", [130.0] * 5, quality="error")
    s = acc.summarize("vfd_voltage_v", now=4.0, window_s=60)
    assert s.current is None and s.quality == "stale"


def test_noload_guard_fires():
    acc = TrendAccumulator()
    _feed(acc, "vfd_current_a", [0.0] * 10)
    acc.update("motor_running", 1, 9.0)
    out = acc.summarize_all(now=9.0, window_s=60)
    assert "unloaded bench" in out["vfd_current_a"].note


def test_noload_guard_silent_when_loaded():
    acc = TrendAccumulator()
    _feed(acc, "vfd_current_a", [3.2] * 10)
    acc.update("motor_running", 1, 9.0)
    out = acc.summarize_all(now=9.0, window_s=60)
    assert out["vfd_current_a"].note == ""


def test_v2_torque_threshold_wired():
    acc = TrendAccumulator()
    last = _feed(acc, "vfd_torque_pct", [165.0] * 10)  # > torque_hi_pct default 150
    s = acc.summarize("vfd_torque_pct", now=last, window_s=60)
    assert s.unit == "%"
    assert s.threshold_hi == rules.DEFAULT_CFG["torque_hi_pct"]
    assert s.distance_to_threshold == 150.0 - 165.0    # negative = jam-precursor territory


def test_v2_slip_note_fires_when_rpm_lags_cmd():
    acc = TrendAccumulator()
    _feed(acc, "vfd_freq_cmd", [60.0] * 10)        # commanded 60 Hz → ~1800 rpm sync
    _feed(acc, "vfd_motor_rpm", [900.0] * 10)      # shaft at half speed
    acc.update("motor_running", 1, 9.0)
    out = acc.summarize_all(now=9.0, window_s=60)
    assert "rpm lags freq command" in out["vfd_motor_rpm"].note


def test_v2_slip_note_silent_when_tracking():
    acc = TrendAccumulator()
    _feed(acc, "vfd_freq_cmd", [60.0] * 10)
    _feed(acc, "vfd_motor_rpm", [1750.0] * 10)     # normal slip, inside tolerance
    acc.update("motor_running", 1, 9.0)
    out = acc.summarize_all(now=9.0, window_s=60)
    assert out["vfd_motor_rpm"].note == ""
