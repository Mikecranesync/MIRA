"""Unit tests for mira-bots/shared/flaky_rules.py (Phase 9 / issue #1661).

Each rule is tested for:
  - fires on a sufficient count (the positive / "must fire" case)
  - does NOT fire below the threshold (the control / "must not fire" case)
  - returns the correct confidence band

value_spike additionally tests:
  - no-fire when baseline is too shallow
  - no-fire when stddev is zero
  - no-fire when no value_changed diffs exist

All tests are offline — no DB, no Celery, no env-var dependency.
"""

from __future__ import annotations


from shared.flaky_rules import (
    brown_out,
    intermittent_disc,
    rapid_toggle,
    value_spike,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_diff(diff_type: str, event_id: str = "evt-1", value: str | None = None) -> dict:
    return {
        "diff_id": event_id,
        "tag_path": "enterprise.site1.area1.line1.cv101.speed",
        "uns_path": "enterprise.site1.area1.line1.cv101",
        "diff_type": diff_type,
        "prev_value": "0",
        "new_value": value or "1",
        "value_type": "float",
        "from_event_id": f"from-{event_id}",
        "to_event_id": event_id,
        "event_timestamp": "2026-11-27T00:00:00Z",
    }


def _baseline(mean: float = 50.0, stddev: float = 5.0, event_count: int = 100) -> dict:
    return {"mean": mean, "stddev": stddev, "event_count": event_count}


# ---------------------------------------------------------------------------
# rapid_toggle
# ---------------------------------------------------------------------------


class TestRapidToggle:
    def test_fires_at_threshold(self):
        """10 edge events is exactly the min_transitions threshold → must fire."""
        diffs = [_make_diff("rising_edge", f"e{i}") for i in range(5)]
        diffs += [_make_diff("falling_edge", f"f{i}") for i in range(5)]
        result = rapid_toggle(diffs, min_transitions=10)
        assert result.fired is True
        assert result.rule_name == "rapid_toggle"
        assert result.transition_count == 10

    def test_does_not_fire_below_threshold(self):
        """9 edge events < threshold of 10 → must NOT fire."""
        diffs = [_make_diff("rising_edge", f"e{i}") for i in range(5)]
        diffs += [_make_diff("falling_edge", f"f{i}") for i in range(4)]
        result = rapid_toggle(diffs, min_transitions=10)
        assert result.fired is False

    def test_control_non_edge_diffs_ignored(self):
        """quality_degraded diffs are not edges; 10 of them must NOT fire rapid_toggle."""
        diffs = [_make_diff("quality_degraded", f"q{i}") for i in range(10)]
        result = rapid_toggle(diffs, min_transitions=10)
        assert result.fired is False

    def test_confidence_low_at_threshold(self):
        """Exactly at the threshold → low confidence."""
        diffs = [_make_diff("rising_edge", f"e{i}") for i in range(10)]
        result = rapid_toggle(diffs, min_transitions=10)
        assert result.fired is True
        assert result.confidence == "low"

    def test_confidence_medium(self):
        """count >= 1.5× threshold (15 events) → medium."""
        diffs = [_make_diff("rising_edge", f"e{i}") for i in range(15)]
        result = rapid_toggle(diffs, min_transitions=10)
        assert result.fired is True
        assert result.confidence == "medium"

    def test_confidence_high(self):
        """count >= 2× threshold (20 events) → high."""
        diffs = [_make_diff("rising_edge", f"e{i}") for i in range(20)]
        result = rapid_toggle(diffs, min_transitions=10)
        assert result.fired is True
        assert result.confidence == "high"

    def test_evidence_ids_populated(self):
        """Fired result carries non-empty evidence_event_ids."""
        diffs = [_make_diff("rising_edge", f"e{i}") for i in range(10)]
        result = rapid_toggle(diffs)
        assert result.fired is True
        assert len(result.evidence_event_ids) == 10

    def test_metadata_counts_rising_falling(self):
        """metadata.rising + metadata.falling must equal transition_count."""
        diffs = [_make_diff("rising_edge", f"e{i}") for i in range(6)]
        diffs += [_make_diff("falling_edge", f"f{i}") for i in range(5)]
        result = rapid_toggle(diffs, min_transitions=10)
        assert result.fired is True
        assert result.metadata["rising"] == 6
        assert result.metadata["falling"] == 5


# ---------------------------------------------------------------------------
# brown_out
# ---------------------------------------------------------------------------


class TestBrownOut:
    def test_fires_at_threshold(self):
        """3 quality_degraded events is exactly min_events=3 → must fire."""
        diffs = [_make_diff("quality_degraded", f"q{i}") for i in range(3)]
        result = brown_out(diffs, min_events=3)
        assert result.fired is True
        assert result.rule_name == "brown_out"
        assert result.transition_count == 3

    def test_does_not_fire_below_threshold(self):
        """2 quality_degraded events < threshold of 3 → must NOT fire."""
        diffs = [_make_diff("quality_degraded", f"q{i}") for i in range(2)]
        result = brown_out(diffs, min_events=3)
        assert result.fired is False

    def test_control_other_diff_types_ignored(self):
        """3 rising_edge diffs do not trigger brown_out."""
        diffs = [_make_diff("rising_edge", f"e{i}") for i in range(3)]
        result = brown_out(diffs, min_events=3)
        assert result.fired is False

    def test_quality_recovered_not_counted(self):
        """quality_recovered is NOT a brownout event; only quality_degraded counts."""
        diffs = [_make_diff("quality_degraded", "q0"), _make_diff("quality_recovered", "r0")]
        result = brown_out(diffs, min_events=3)
        assert result.fired is False

    def test_confidence_band(self):
        """6 events = 2× threshold → high."""
        diffs = [_make_diff("quality_degraded", f"q{i}") for i in range(6)]
        result = brown_out(diffs, min_events=3)
        assert result.confidence == "high"


# ---------------------------------------------------------------------------
# intermittent_disc
# ---------------------------------------------------------------------------


class TestIntermittentDisc:
    def _disc_cycle(self, cycle_id: str) -> list[dict]:
        return [
            _make_diff("quality_degraded", f"{cycle_id}-deg"),
            _make_diff("quality_recovered", f"{cycle_id}-rec"),
        ]

    def test_fires_at_threshold(self):
        """2 degrade→recover cycles exactly equals min_cycles=2 → must fire."""
        diffs = self._disc_cycle("c0") + self._disc_cycle("c1")
        result = intermittent_disc(diffs, min_cycles=2)
        assert result.fired is True
        assert result.rule_name == "intermittent_disc"
        assert result.transition_count == 2

    def test_does_not_fire_below_threshold(self):
        """1 cycle < threshold of 2 → must NOT fire."""
        diffs = self._disc_cycle("c0")
        result = intermittent_disc(diffs, min_cycles=2)
        assert result.fired is False

    def test_degrade_without_recover_not_counted(self):
        """Two consecutive degrades with no recovers = 0 cycles → not fired."""
        diffs = [
            _make_diff("quality_degraded", "d0"),
            _make_diff("quality_degraded", "d1"),
        ]
        result = intermittent_disc(diffs, min_cycles=2)
        assert result.fired is False

    def test_recover_without_prior_degrade_ignored(self):
        """A recover that has no preceding degrade does not count as a cycle."""
        diffs = [
            _make_diff("quality_recovered", "r0"),
            _make_diff("quality_degraded", "d1"),
            _make_diff("quality_recovered", "r1"),
        ]
        result = intermittent_disc(diffs, min_cycles=2)
        assert result.fired is False
        assert result.transition_count == 1

    def test_control_non_quality_diffs_ignored(self):
        """10 rising_edge diffs produce 0 cycles."""
        diffs = [_make_diff("rising_edge", f"e{i}") for i in range(10)]
        result = intermittent_disc(diffs, min_cycles=2)
        assert result.fired is False

    def test_confidence_band(self):
        """4 cycles = 2× threshold of 2 → high."""
        diffs = sum((self._disc_cycle(f"c{i}") for i in range(4)), [])
        result = intermittent_disc(diffs, min_cycles=2)
        assert result.confidence == "high"


# ---------------------------------------------------------------------------
# value_spike
# ---------------------------------------------------------------------------


class TestValueSpike:
    def _spike_diff(self, value: float, event_id: str = "sp0") -> dict:
        d = _make_diff("value_changed", event_id, value=str(value))
        d["value_type"] = "float"
        return d

    def test_fires_on_spike(self):
        """A value > 3×stddev from the mean (50 + 3*5 = 65) → must fire."""
        bl = _baseline(mean=50.0, stddev=5.0, event_count=100)
        diffs = [self._spike_diff(70.0, "sp0")]
        result = value_spike(diffs, bl)
        assert result.fired is True
        assert result.rule_name == "value_spike"
        assert result.transition_count == 1

    def test_does_not_fire_within_range(self):
        """A value within 3×stddev (50 + 3*5 = 65; value=64) → must NOT fire."""
        bl = _baseline(mean=50.0, stddev=5.0, event_count=100)
        diffs = [self._spike_diff(64.0, "sp0")]
        result = value_spike(diffs, bl)
        assert result.fired is False

    def test_does_not_fire_shallow_baseline(self):
        """Fewer than min_baseline_events (20) → must NOT fire regardless of value."""
        bl = _baseline(mean=50.0, stddev=5.0, event_count=10)
        diffs = [self._spike_diff(999.0, "sp0")]
        result = value_spike(diffs, bl, min_baseline_events=20)
        assert result.fired is False

    def test_does_not_fire_zero_stddev(self):
        """stddev=0 → rule returns unfired (division guard)."""
        bl = _baseline(mean=50.0, stddev=0.0, event_count=100)
        diffs = [self._spike_diff(999.0, "sp0")]
        result = value_spike(diffs, bl)
        assert result.fired is False

    def test_does_not_fire_no_value_changed(self):
        """No value_changed diffs → no spikes possible."""
        bl = _baseline()
        diffs = [_make_diff("rising_edge", "e0"), _make_diff("quality_degraded", "q0")]
        result = value_spike(diffs, bl)
        assert result.fired is False

    def test_does_not_fire_non_numeric_value_type(self):
        """value_type='bool' diffs are skipped."""
        bl = _baseline()
        d = _make_diff("value_changed", "sp0", value="999")
        d["value_type"] = "bool"
        result = value_spike([d], bl)
        assert result.fired is False

    def test_confidence_low_at_one_spike(self):
        bl = _baseline()
        diffs = [self._spike_diff(100.0, "sp0")]
        result = value_spike(diffs, bl)
        assert result.fired is True
        assert result.confidence == "low"

    def test_confidence_medium_at_two_spikes(self):
        bl = _baseline()
        diffs = [self._spike_diff(100.0, f"sp{i}") for i in range(2)]
        result = value_spike(diffs, bl)
        assert result.fired is True
        assert result.confidence == "medium"

    def test_confidence_high_at_three_spikes(self):
        bl = _baseline()
        diffs = [self._spike_diff(100.0, f"sp{i}") for i in range(3)]
        result = value_spike(diffs, bl)
        assert result.fired is True
        assert result.confidence == "high"

    def test_negative_spike(self):
        """A value far BELOW the mean (50 - 20 = 30 — well below 3×5=15 threshold) → fires."""
        bl = _baseline(mean=50.0, stddev=5.0, event_count=100)
        diffs = [self._spike_diff(30.0, "sp0")]
        result = value_spike(diffs, bl)
        assert result.fired is True

    def test_missing_baseline_keys(self):
        """Empty baseline dict → no-fire (all keys default to 0/None)."""
        result = value_spike([self._spike_diff(999.0)], {})
        assert result.fired is False

    def test_evidence_ids_populated(self):
        bl = _baseline()
        diffs = [self._spike_diff(100.0, f"sp{i}") for i in range(3)]
        result = value_spike(diffs, bl)
        assert len(result.evidence_event_ids) == 3


# ---------------------------------------------------------------------------
# RuleResult invariants
# ---------------------------------------------------------------------------


class TestRuleResult:
    def test_unfired_result_has_empty_evidence(self):
        """An unfired result carries no evidence_event_ids."""
        diffs = [_make_diff("rising_edge", f"e{i}") for i in range(2)]
        result = rapid_toggle(diffs, min_transitions=10)
        assert result.fired is False
        assert result.evidence_event_ids == []

    def test_detection_window_propagated(self):
        """window kwarg is reflected in the result."""
        diffs = [_make_diff("quality_degraded", f"q{i}") for i in range(5)]
        result = brown_out(diffs, window="30m", min_events=3)
        assert result.detection_window == "30m"
