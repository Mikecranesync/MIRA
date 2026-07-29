"""Unit tests for mira-bots/shared/detection/flaky_input.py.

Tests all four detection rules + the run_all_rules dispatcher.
No DB or network required.
"""

from __future__ import annotations

import sys
from pathlib import Path

_SHARED = str(Path(__file__).resolve().parent.parent / "mira-bots" / "shared")
if _SHARED not in sys.path:
    sys.path.insert(0, _SHARED)

from detection.flaky_input import (
    FlakySignal,
    brown_out,
    intermittent_disc,
    rapid_toggle,
    run_all_rules,
    value_spike,
    RAPID_TOGGLE_MEDIUM_THRESHOLD,
    RAPID_TOGGLE_HIGH_THRESHOLD,
    BROWNOUT_CYCLE_THRESHOLD,
    INTERMITTENT_DISC_CYCLE_THRESHOLD,
    VALUE_SPIKE_MIN_SAMPLES,
)

import uuid


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_diff(diff_type: str, tag_path: str = "enterprise.site.area.cv101.prox",
               prev_value: str = "false", new_value: str = "true",
               value_type: str = "bool") -> dict:
    return {
        "diff_id": str(uuid.uuid4()),
        "diff_type": diff_type,
        "tag_path": tag_path,
        "prev_value": prev_value,
        "new_value": new_value,
        "value_type": value_type,
        "uns_path": "enterprise.site.area.cv101",
    }


def _edges(count: int, tag_path: str = "enterprise.site.area.cv101.prox") -> list[dict]:
    """Alternating rising/falling edge events."""
    diffs = []
    for i in range(count):
        t = "rising_edge" if i % 2 == 0 else "falling_edge"
        diffs.append(_make_diff(t, tag_path=tag_path))
    return diffs


# ── rapid_toggle ──────────────────────────────────────────────────────────────

def test_rapid_toggle_below_threshold_returns_none():
    diffs = _edges(RAPID_TOGGLE_MEDIUM_THRESHOLD - 1)
    assert rapid_toggle(diffs) is None


def test_rapid_toggle_at_medium_threshold():
    diffs = _edges(RAPID_TOGGLE_MEDIUM_THRESHOLD)
    result = rapid_toggle(diffs)
    assert result is not None
    assert result.rule == "rapid_toggle"
    assert result.confidence == "medium"
    assert result.transition_count == RAPID_TOGGLE_MEDIUM_THRESHOLD


def test_rapid_toggle_at_high_threshold():
    diffs = _edges(RAPID_TOGGLE_HIGH_THRESHOLD)
    result = rapid_toggle(diffs)
    assert result is not None
    assert result.confidence == "high"


def test_rapid_toggle_beyond_high_threshold():
    diffs = _edges(RAPID_TOGGLE_HIGH_THRESHOLD + 5)
    result = rapid_toggle(diffs)
    assert result is not None
    assert result.confidence == "high"
    assert result.transition_count == RAPID_TOGGLE_HIGH_THRESHOLD + 5


def test_rapid_toggle_ignores_non_edge_diffs():
    """value_changed diffs in the same window must not count as edges."""
    diffs = _edges(RAPID_TOGGLE_MEDIUM_THRESHOLD - 1)
    diffs += [_make_diff("value_changed") for _ in range(20)]
    assert rapid_toggle(diffs) is None


def test_rapid_toggle_evidence_ids_match_edge_events():
    diffs = _edges(RAPID_TOGGLE_MEDIUM_THRESHOLD)
    result = rapid_toggle(diffs)
    assert len(result.evidence_diff_ids) == RAPID_TOGGLE_MEDIUM_THRESHOLD
    for d in diffs:
        assert d["diff_id"] in result.evidence_diff_ids


def test_rapid_toggle_metadata_counts():
    diffs = _edges(12)  # 6 rising, 6 falling
    result = rapid_toggle(diffs)
    assert result.metadata["rising"] == 6
    assert result.metadata["falling"] == 6


def test_rapid_toggle_empty_diffs_returns_none():
    assert rapid_toggle([]) is None


# ── brown_out ─────────────────────────────────────────────────────────────────

def _brownout_cycle(n: int) -> list[dict]:
    """n dip→recover cycles: threshold_cross_low then threshold_cross_high."""
    diffs = []
    for _ in range(n):
        diffs.append(_make_diff("threshold_cross_low"))
        diffs.append(_make_diff("threshold_cross_high"))
    return diffs


def test_brownout_below_threshold_returns_none():
    diffs = _brownout_cycle(BROWNOUT_CYCLE_THRESHOLD - 1)
    assert brown_out(diffs) is None


def test_brownout_at_threshold():
    diffs = _brownout_cycle(BROWNOUT_CYCLE_THRESHOLD)
    result = brown_out(diffs)
    assert result is not None
    assert result.rule == "brown_out"
    assert result.transition_count == BROWNOUT_CYCLE_THRESHOLD


def test_brownout_incomplete_cycle_not_counted():
    """A dip with no recovery shouldn't count as a cycle."""
    diffs = _brownout_cycle(BROWNOUT_CYCLE_THRESHOLD - 1)
    diffs.append(_make_diff("threshold_cross_low"))  # trailing dip, no recovery
    assert brown_out(diffs) is None


def test_brownout_no_relevant_diffs():
    diffs = _edges(15)  # edge events, not threshold crossings
    assert brown_out(diffs) is None


def test_brownout_confidence_high_for_many_cycles():
    diffs = _brownout_cycle(BROWNOUT_CYCLE_THRESHOLD * 2)
    result = brown_out(diffs)
    assert result is not None
    assert result.confidence == "high"


# ── intermittent_disc ─────────────────────────────────────────────────────────

def _disc_cycle(n: int) -> list[dict]:
    diffs = []
    for _ in range(n):
        diffs.append(_make_diff("quality_degraded"))
        diffs.append(_make_diff("quality_recovered"))
    return diffs


def test_intermittent_disc_below_threshold():
    diffs = _disc_cycle(INTERMITTENT_DISC_CYCLE_THRESHOLD - 1)
    assert intermittent_disc(diffs) is None


def test_intermittent_disc_at_threshold():
    diffs = _disc_cycle(INTERMITTENT_DISC_CYCLE_THRESHOLD)
    result = intermittent_disc(diffs)
    assert result is not None
    assert result.rule == "intermittent_disc"
    assert result.transition_count == INTERMITTENT_DISC_CYCLE_THRESHOLD


def test_intermittent_disc_degrade_without_recover_not_counted():
    diffs = _disc_cycle(INTERMITTENT_DISC_CYCLE_THRESHOLD - 1)
    diffs.append(_make_diff("quality_degraded"))
    assert intermittent_disc(diffs) is None


def test_intermittent_disc_no_relevant_diffs():
    diffs = _edges(20)
    assert intermittent_disc(diffs) is None


def test_intermittent_disc_confidence_high_for_many_cycles():
    diffs = _disc_cycle(INTERMITTENT_DISC_CYCLE_THRESHOLD * 2)
    result = intermittent_disc(diffs)
    assert result.confidence == "high"


# ── value_spike ───────────────────────────────────────────────────────────────

def _numeric_diffs(values: list[float]) -> list[dict]:
    return [
        _make_diff("value_changed", value_type="float",
                   prev_value=str(v - 0.1), new_value=str(v))
        for v in values
    ]


def test_value_spike_too_few_samples():
    diffs = _numeric_diffs([1.0] * (VALUE_SPIKE_MIN_SAMPLES - 1))
    assert value_spike(diffs) is None


def test_value_spike_no_spike_in_stable_data():
    diffs = _numeric_diffs([10.0] * VALUE_SPIKE_MIN_SAMPLES)
    assert value_spike(diffs) is None  # stddev=0 → no spike possible


def test_value_spike_detects_outlier():
    # 10 readings around 10.0, then one extreme spike
    values = [10.0] * VALUE_SPIKE_MIN_SAMPLES + [1000.0]
    diffs = _numeric_diffs(values)
    result = value_spike(diffs)
    assert result is not None
    assert result.rule == "value_spike"
    assert result.transition_count >= 1


def test_value_spike_metadata_has_mean_and_stddev():
    values = [10.0] * VALUE_SPIKE_MIN_SAMPLES + [1000.0]
    diffs = _numeric_diffs(values)
    result = value_spike(diffs)
    assert "mean" in result.metadata
    assert "stddev" in result.metadata
    assert result.metadata["stddev"] > 0


def test_value_spike_skips_non_numeric_values():
    """Non-parseable values must be silently skipped, not raise."""
    diffs = _numeric_diffs([10.0] * VALUE_SPIKE_MIN_SAMPLES + [1000.0])
    diffs.append(_make_diff("value_changed", new_value="N/A", value_type="string"))
    result = value_spike(diffs)
    # Should still detect the spike from the numeric values
    assert result is not None


def test_value_spike_non_value_changed_diffs_ignored():
    values = [10.0] * VALUE_SPIKE_MIN_SAMPLES + [1000.0]
    diffs = _numeric_diffs(values) + _edges(20)
    result = value_spike(diffs)
    assert result is not None
    # Edge events must not inflate transition_count
    assert result.transition_count < 5


# ── run_all_rules ─────────────────────────────────────────────────────────────

def test_run_all_rules_empty_returns_empty():
    assert run_all_rules([]) == []


def test_run_all_rules_no_match():
    diffs = [_make_diff("value_changed")]
    assert run_all_rules(diffs) == []


def test_run_all_rules_rapid_toggle_detected():
    diffs = _edges(RAPID_TOGGLE_MEDIUM_THRESHOLD)
    results = run_all_rules(diffs)
    rules = [r.rule for r in results]
    assert "rapid_toggle" in rules


def test_run_all_rules_multiple_rules_can_fire():
    """Edge events can satisfy rapid_toggle; quality events can satisfy intermittent_disc."""
    diffs = _edges(RAPID_TOGGLE_MEDIUM_THRESHOLD) + _disc_cycle(INTERMITTENT_DISC_CYCLE_THRESHOLD)
    # All diffs have the same tag_path for the dispatcher
    for d in diffs:
        d["tag_path"] = "enterprise.site.area.cv101.sensor"
    results = run_all_rules(diffs)
    rules = [r.rule for r in results]
    assert "rapid_toggle" in rules
    assert "intermittent_disc" in rules


def test_run_all_rules_returns_flaky_signal_instances():
    diffs = _edges(RAPID_TOGGLE_MEDIUM_THRESHOLD)
    results = run_all_rules(diffs)
    for r in results:
        assert isinstance(r, FlakySignal)
