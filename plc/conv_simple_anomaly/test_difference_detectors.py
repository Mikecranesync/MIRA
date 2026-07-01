"""
Deterministic unit tests for the signal difference detectors + event grouping.
Run: pytest plc/conv_simple_anomaly/test_difference_detectors.py -v

Mirrors the Style-A snapshot/assertion pattern of test_rules.py. Fully offline:
no LLM, no broker, no DB. Examples use the PRD's canonical cases (DC-bus-like
signal 318-325 -> 287; Signal A normally 0.4s after B -> 3.2s late).
"""
from difference_detectors import (
    detect_out_of_baseline, detect_stuck, detect_delayed_transition,
    detect_drift, detect_never_seen_pattern,
    group_observations, OUT_OF_BASELINE, STUCK, DELAYED_TRANSITION,
    DRIFT, NEVER_SEEN,
)


# --- out-of-baseline -----------------------------------------------------------
def test_out_of_baseline_flags_low():
    o = detect_out_of_baseline("signal_c", 287.0, 318.0, 325.0, ts=10.0)
    assert o is not None
    assert o.kind == OUT_OF_BASELINE
    assert o.magnitude == 318.0 - 287.0
    assert "287" in o.detail and "318" in o.detail and "325" in o.detail


def test_out_of_baseline_flags_high():
    o = detect_out_of_baseline("signal_c", 415.0, 318.0, 325.0)
    assert o is not None and o.kind == OUT_OF_BASELINE
    assert o.magnitude == 415.0 - 325.0


def test_within_baseline_is_silent():
    assert detect_out_of_baseline("signal_c", 322.0, 318.0, 325.0) is None
    assert detect_out_of_baseline("signal_c", 318.0, 318.0, 325.0) is None  # boundary inclusive


def test_out_of_baseline_none_inputs_silent():
    assert detect_out_of_baseline("s", None, 1.0, 2.0) is None
    assert detect_out_of_baseline("s", 5.0, None, 2.0) is None


# --- stuck signal --------------------------------------------------------------
def test_stuck_flags_when_frozen_past_span():
    samples = [(0.0, 12.0), (2.0, 12.0), (4.0, 12.0), (6.0, 12.0)]  # 6s, unchanged
    o = detect_stuck("conveyor_speed", samples, min_span_s=5.0)
    assert o is not None and o.kind == STUCK
    assert o.value == 12.0 and o.magnitude == 6.0


def test_not_stuck_when_value_moves():
    samples = [(0.0, 12.0), (2.0, 12.0), (4.0, 13.0)]
    assert detect_stuck("conveyor_speed", samples, min_span_s=2.0) is None


def test_not_stuck_when_span_too_short():
    samples = [(0.0, 12.0), (1.0, 12.0)]  # only 1s
    assert detect_stuck("conveyor_speed", samples, min_span_s=5.0) is None


def test_stuck_needs_two_samples():
    assert detect_stuck("s", [(0.0, 1.0)], min_span_s=0.0) is None
    assert detect_stuck("s", [], min_span_s=0.0) is None


# --- delayed transition --------------------------------------------------------
def test_delayed_transition_flags_late():
    # Signal A normally changes 0.4s after Signal B; today 3.2s later.
    o = detect_delayed_transition("signal_b", "signal_a", a_ts=100.0, b_ts=103.2,
                                  normal_lag_s=0.4, tol_s=0.5)
    assert o is not None and o.kind == DELAYED_TRANSITION
    assert abs(o.value - 3.2) < 1e-9
    assert abs(o.magnitude - (3.2 - 0.4)) < 1e-9


def test_on_time_transition_is_silent():
    o = detect_delayed_transition("signal_b", "signal_a", a_ts=100.0, b_ts=100.5,
                                  normal_lag_s=0.4, tol_s=0.5)
    assert o is None  # 0.5s <= 0.4 + 0.5


def test_delayed_transition_none_inputs_silent():
    assert detect_delayed_transition("a", "b", None, 1.0, 0.4, 0.5) is None


# --- event grouping (compression) ---------------------------------------------
def test_group_compresses_close_observations_into_one_event():
    obs = [
        detect_out_of_baseline("dc_bus", 287.0, 318.0, 325.0, ts=100.0),
        detect_delayed_transition("cmd", "run_confirm", a_ts=100.2, b_ts=101.0,
                                  normal_lag_s=0.1, tol_s=0.2),   # b_ts=101.0
        detect_out_of_baseline("freq_ramp", 5.0, 10.0, 60.0, ts=101.5),
    ]
    obs = [o for o in obs if o is not None]
    events = group_observations(obs, window_s=2.0)
    assert len(events) == 1                      # startup anomaly = ONE event
    assert len(events[0].observations) == 3
    assert set(events[0].signals) == {"dc_bus", "run_confirm", "freq_ramp"}


def test_group_splits_distant_observations():
    obs = [
        detect_out_of_baseline("dc_bus", 287.0, 318.0, 325.0, ts=100.0),
        detect_out_of_baseline("dc_bus", 400.0, 318.0, 325.0, ts=500.0),  # 400s later
    ]
    events = group_observations([o for o in obs if o], window_s=2.0)
    assert len(events) == 2


def test_group_empty_is_empty():
    assert group_observations([], window_s=2.0) == []


# --- drift ---------------------------------------------------------------------
def test_drift_flags_sustained_move():
    # baseline mean 12.0, stddev ~0.05; recent window sits at ~5 -> drifted down
    samples = [(80.0, 5.3), (81.0, 5.2), (82.0, 5.1), (83.0, 5.0)]
    o = detect_drift("bowl", samples, baseline_mean=12.0, baseline_stddev=0.05, window_s=4.0)
    assert o is not None and o.kind == DRIFT
    assert o.value < 12.0 and o.magnitude > 6.0


def test_drift_silent_within_noise():
    # tiny move, under both the sigma gate and the 10% relative gate
    samples = [(0.0, 12.01), (1.0, 11.99), (2.0, 12.0)]
    assert detect_drift("bowl", samples, baseline_mean=12.0, baseline_stddev=0.05, window_s=2.0) is None


def test_drift_none_inputs_silent():
    assert detect_drift("s", [], 12.0, 0.05, 2.0) is None
    assert detect_drift("s", [(0.0, 5.0)], None, 0.05, 2.0) is None


# --- never-seen pattern --------------------------------------------------------
def test_never_seen_flags_novel_value():
    o = detect_never_seen_pattern("vfd_fault_code", 58, seen_values={0, 1, 2}, ts=10.0)
    assert o is not None and o.kind == NEVER_SEEN and o.value == 58


def test_never_seen_silent_for_known_value():
    assert detect_never_seen_pattern("mode", "run", seen_values={"run", "idle"}) is None


def test_never_seen_none_inputs_silent():
    assert detect_never_seen_pattern("s", None, {1, 2}) is None
    assert detect_never_seen_pattern("s", 5, None) is None
