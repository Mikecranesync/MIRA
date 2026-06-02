"""Unit tests for mira-bots/shared/flaky_rules.py.

Pure CPython, no DB. Each test exercises one rule sub-case.
Fixtures mimic the `conveyor_flicker.yaml` scenario shape where noted.

Run:
    cd mira-bots && python3 -m pytest tests/test_flaky_rules.py -q
"""

from __future__ import annotations

import os
import sys

# Ensure `shared` package is on the path (mirrors the convention in the rest of
# this test suite — see test_admin_commands.py)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "shared"))

import pytest
from flaky_rules import (
    RuleHit,
    TagConfig,
    TagEvent,
    _check_brown_out,
    _check_intermittent_disc,
    _check_rapid_toggle,
    _check_value_spike,
    check_flaky,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _bool_cfg(
    tag_id: str = "PE_B16_2",
    baseline_established: bool = True,
    baseline_rate: float = 4.0,
    floor: int = 10,
) -> TagConfig:
    return TagConfig(
        tag_id=tag_id,
        tenant_id="test-tenant",
        data_type="bool",
        baseline_established=baseline_established,
        baseline_transitions_per_hour=baseline_rate,
        min_toggle_floor=floor,
    )


def _float_cfg(
    tag_id: str = "MOTOR_CURRENT",
    baseline_established: bool = True,
    threshold: float = 2.0,
    brown_out_low: float = 0.0,
) -> TagConfig:
    return TagConfig(
        tag_id=tag_id,
        tenant_id="test-tenant",
        data_type="float",
        baseline_established=baseline_established,
        threshold=threshold,
        brown_out_low=brown_out_low,
    )


def _rising_events(n: int) -> list[TagEvent]:
    """n rising_edge events with good quality."""
    return [
        TagEvent(event_type="rising_edge", ts=i, raw_quality="good")
        for i in range(n)
    ]


def _falling_events(n: int) -> list[TagEvent]:
    return [
        TagEvent(event_type="falling_edge", ts=i, raw_quality="good")
        for i in range(n)
    ]


def _value_changed(new_val: float, delta: float) -> TagEvent:
    return TagEvent(
        event_type="value_changed",
        ts=0,
        delta=delta,
        new_value=new_val,
        raw_quality="good",
    )


# ── Baseline suppression ──────────────────────────────────────────────────────

class TestBaselineSuppression:
    def test_suppressed_when_baseline_not_established(self) -> None:
        """All checks must return [] when baseline is not yet established."""
        cfg = _bool_cfg(baseline_established=False)
        # 20 rising edges — would normally fire rapid_toggle
        events = _rising_events(20)
        result = check_flaky(events, cfg)
        assert result == [], (
            "Alerts must be suppressed during the calibration period"
        )

    def test_suppressed_enum_type(self) -> None:
        """No rule defined for 'enum' data_type — always returns []."""
        cfg = TagConfig(
            tag_id="STATUS_ENUM",
            tenant_id="test-tenant",
            data_type="enum",
            baseline_established=True,
        )
        events = [TagEvent(event_type="value_changed", ts=0)]
        result = check_flaky(events, cfg)
        assert result == []

    def test_empty_events_no_hit(self) -> None:
        cfg = _bool_cfg()
        result = check_flaky([], cfg)
        assert result == []


# ── rapid_toggle ─────────────────────────────────────────────────────────────

class TestRapidToggle:
    """conveyor_flicker.yaml scenario shape: stable peers, ≥5 drops / hr."""

    def test_fires_when_above_floor(self) -> None:
        """14 rising edges/hr vs baseline 4 → expected_max=max(4*1.5,10)=10 → fires."""
        cfg = _bool_cfg(baseline_rate=4.0, floor=10)
        events = _rising_events(14)
        hits = _check_rapid_toggle(events, cfg)
        assert len(hits) == 1
        h = hits[0]
        assert h.rule_id == "rapid_toggle"
        assert h.transitions == 14
        assert h.expected_max == 10  # floor=10 dominates over 4*1.5=6
        assert h.severity == "warning"  # 14 < 10*2=20

    def test_fires_alert_severity_at_double_threshold(self) -> None:
        """Rising edges > 2× expected_max → severity='alert'."""
        cfg = _bool_cfg(baseline_rate=4.0, floor=10)
        events = _rising_events(25)  # > 10*2
        hits = _check_rapid_toggle(events, cfg)
        assert len(hits) == 1
        assert hits[0].severity == "alert"

    def test_no_hit_when_below_expected_max(self) -> None:
        """8 rising edges, floor=10 → expected_max=10, 8 ≤ 10 → no hit."""
        cfg = _bool_cfg(baseline_rate=4.0, floor=10)
        events = _rising_events(8)
        hits = _check_rapid_toggle(events, cfg)
        assert hits == []

    def test_at_exactly_expected_max_no_hit(self) -> None:
        """Exactly at expected_max should not fire (must exceed, not equal)."""
        cfg = _bool_cfg(baseline_rate=4.0, floor=10)
        events = _rising_events(10)
        hits = _check_rapid_toggle(events, cfg)
        assert hits == []

    def test_zero_rising_edges_no_hit(self) -> None:
        cfg = _bool_cfg()
        events = _falling_events(20)  # all falling, no rising
        hits = _check_rapid_toggle(events, cfg)
        assert hits == []

    def test_baseline_rate_dominates_over_floor(self) -> None:
        """High baseline: 100/hr × 1.5 = 150 → floor=10 irrelevant; only fires at 151+."""
        cfg = _bool_cfg(baseline_rate=100.0, floor=10)
        events = _rising_events(149)
        hits = _check_rapid_toggle(events, cfg)
        assert hits == [], "149 should not exceed expected_max=150"

        events = _rising_events(151)
        hits = _check_rapid_toggle(events, cfg)
        assert len(hits) == 1

    def test_no_baseline_rate_uses_floor(self) -> None:
        """When baseline_transitions_per_hour is None, floor=10 governs."""
        cfg = TagConfig(
            tag_id="TAG_X",
            tenant_id="test-tenant",
            data_type="bool",
            baseline_established=True,
            baseline_transitions_per_hour=None,
            min_toggle_floor=10,
        )
        events = _rising_events(11)
        hits = _check_rapid_toggle(events, cfg)
        assert len(hits) == 1
        assert hits[0].expected_max == 10

    def test_commissioning_churn_suppressed_pre_baseline(self) -> None:
        """Commissioning scenario: lots of toggles but baseline not established."""
        cfg = _bool_cfg(baseline_established=False)
        events = _rising_events(50)  # extreme churn during commissioning
        # check_flaky sees baseline_established=False → suppresses
        result = check_flaky(events, cfg)
        assert result == []


# ── intermittent_disc ─────────────────────────────────────────────────────────

class TestIntermittentDisc:
    def test_fires_at_three_bad_runs(self) -> None:
        """Three consecutive bad-quality runs (interspersed with good) → fires."""
        events = [
            # Run 1
            TagEvent(event_type="rising_edge", ts=0, raw_quality="bad"),
            TagEvent(event_type="falling_edge", ts=1, raw_quality="stale"),
            # Good gap
            TagEvent(event_type="rising_edge", ts=2, raw_quality="good"),
            # Run 2
            TagEvent(event_type="rising_edge", ts=3, raw_quality="bad"),
            # Good gap
            TagEvent(event_type="rising_edge", ts=4, raw_quality="good"),
            # Run 3
            TagEvent(event_type="falling_edge", ts=5, raw_quality="stale"),
        ]
        cfg = _bool_cfg()
        hits = _check_intermittent_disc(events, cfg)
        assert len(hits) == 1
        h = hits[0]
        assert h.rule_id == "intermittent_disc"
        assert h.transitions == 3  # 3 runs
        assert h.extra["bad_quality_runs"] == 3

    def test_no_hit_with_two_runs(self) -> None:
        events = [
            TagEvent(event_type="rising_edge", ts=0, raw_quality="bad"),
            TagEvent(event_type="rising_edge", ts=1, raw_quality="good"),
            TagEvent(event_type="rising_edge", ts=2, raw_quality="stale"),
        ]
        cfg = _bool_cfg()
        hits = _check_intermittent_disc(events, cfg)
        assert hits == []

    def test_all_good_quality_no_hit(self) -> None:
        events = [
            TagEvent(event_type="rising_edge", ts=i, raw_quality="good")
            for i in range(10)
        ]
        cfg = _bool_cfg()
        hits = _check_intermittent_disc(events, cfg)
        assert hits == []

    def test_none_quality_counts_as_bad(self) -> None:
        """raw_quality=None should count as bad (missing quality signal)."""
        events = [
            TagEvent(event_type="rising_edge", ts=0, raw_quality=None),
            TagEvent(event_type="rising_edge", ts=1, raw_quality="good"),
            TagEvent(event_type="rising_edge", ts=2, raw_quality=None),
            TagEvent(event_type="rising_edge", ts=3, raw_quality="good"),
            TagEvent(event_type="rising_edge", ts=4, raw_quality=None),
        ]
        cfg = _bool_cfg()
        hits = _check_intermittent_disc(events, cfg)
        assert len(hits) == 1
        assert hits[0].transitions == 3

    def test_consecutive_bad_is_one_run(self) -> None:
        """Multiple consecutive bad events = one run, not multiple."""
        events = [
            TagEvent(event_type="rising_edge", ts=0, raw_quality="bad"),
            TagEvent(event_type="rising_edge", ts=1, raw_quality="bad"),
            TagEvent(event_type="rising_edge", ts=2, raw_quality="bad"),
            # Only 1 run; needs ≥ 3 runs → no hit
        ]
        cfg = _bool_cfg()
        hits = _check_intermittent_disc(events, cfg)
        assert hits == []


# ── brown_out ─────────────────────────────────────────────────────────────────

class TestBrownOut:
    def test_fires_at_two_excursions(self) -> None:
        """Value drops below threshold twice and recovers → fires."""
        cfg = _float_cfg(brown_out_low=10.0)
        events = [
            _value_changed(20.0, 0),  # above
            _value_changed(8.0, -12.0),   # drop below → start excursion 1
            _value_changed(22.0, 14.0),   # recover → excursion 1 complete
            _value_changed(7.0, -15.0),   # drop below → start excursion 2
            _value_changed(21.0, 14.0),   # recover → excursion 2 complete
        ]
        hits = _check_brown_out(events, cfg)
        assert len(hits) == 1
        h = hits[0]
        assert h.rule_id == "brown_out"
        assert h.severity == "alert"
        assert h.extra["crossings"] == 2

    def test_no_hit_with_one_excursion(self) -> None:
        cfg = _float_cfg(brown_out_low=10.0)
        events = [
            _value_changed(20.0, 0),
            _value_changed(5.0, -15.0),   # drop
            _value_changed(25.0, 20.0),   # recover → only 1 excursion
        ]
        hits = _check_brown_out(events, cfg)
        assert hits == []

    def test_off_when_brown_out_low_zero(self) -> None:
        """brown_out_low=0.0 disables the rule."""
        cfg = _float_cfg(brown_out_low=0.0)
        events = [
            _value_changed(-5.0, -25.0),  # well below zero
            _value_changed(20.0, 25.0),
            _value_changed(-3.0, -23.0),
            _value_changed(20.0, 23.0),
        ]
        hits = _check_brown_out(events, cfg)
        assert hits == [], "Feature must be off when brown_out_low=0.0"

    def test_no_recovery_no_hit(self) -> None:
        """Tag stays below low threshold — no recovery → no completed excursion."""
        cfg = _float_cfg(brown_out_low=10.0)
        events = [
            _value_changed(8.0, -12.0),
            _value_changed(7.0, -1.0),
            _value_changed(6.0, -1.0),
        ]
        hits = _check_brown_out(events, cfg)
        assert hits == []

    def test_ignores_non_value_changed_events(self) -> None:
        """Brown-out rule only looks at value_changed events."""
        cfg = _float_cfg(brown_out_low=10.0)
        events = [
            TagEvent(event_type="rising_edge", ts=0),
            _value_changed(5.0, -15.0),
            TagEvent(event_type="fault_window_open", ts=2),
            _value_changed(20.0, 15.0),
            _value_changed(4.0, -16.0),
            _value_changed(20.0, 16.0),
        ]
        hits = _check_brown_out(events, cfg)
        assert len(hits) == 1  # 2 complete excursions in value_changed events


# ── value_spike ───────────────────────────────────────────────────────────────

class TestValueSpike:
    def test_fires_when_delta_exceeds_5x_threshold(self) -> None:
        """delta > 5 × cfg.threshold → fires."""
        cfg = _float_cfg(threshold=2.0)
        events = [
            _value_changed(50.0, 12.0),  # delta=12 > 5*2=10 → spike
        ]
        hits = _check_value_spike(events, cfg)
        assert len(hits) == 1
        h = hits[0]
        assert h.rule_id == "value_spike"
        assert h.extra["max_delta"] == pytest.approx(12.0)
        assert h.extra["spike_threshold"] == pytest.approx(10.0)

    def test_no_hit_when_delta_below_threshold(self) -> None:
        cfg = _float_cfg(threshold=2.0)
        events = [_value_changed(8.0, 3.0)]  # delta=3 ≤ 10
        hits = _check_value_spike(events, cfg)
        assert hits == []

    def test_off_when_threshold_zero(self) -> None:
        cfg = _float_cfg(threshold=0.0)
        events = [_value_changed(1000.0, 9999.0)]  # extreme delta, feature off
        hits = _check_value_spike(events, cfg)
        assert hits == [], "Feature must be off when threshold=0.0"

    def test_negative_delta_abs_taken(self) -> None:
        """Negative deltas (drops) should also trigger the spike rule."""
        cfg = _float_cfg(threshold=2.0)
        events = [_value_changed(-50.0, -15.0)]  # abs(-15) > 10
        hits = _check_value_spike(events, cfg)
        assert len(hits) == 1

    def test_picks_max_delta(self) -> None:
        """Only the largest delta in the window determines if spike fires."""
        cfg = _float_cfg(threshold=2.0)
        events = [
            _value_changed(5.0, 3.0),   # small
            _value_changed(4.0, 1.0),   # small
            _value_changed(20.0, 15.0), # spike: 15 > 10
        ]
        hits = _check_value_spike(events, cfg)
        assert len(hits) == 1
        assert hits[0].extra["max_delta"] == pytest.approx(15.0)


# ── check_flaky dispatcher ─────────────────────────────────────────────────────

class TestCheckFlakyDispatcher:
    def test_bool_routes_to_toggle_and_disc(self) -> None:
        """check_flaky with data_type='bool' uses toggle + disc rules."""
        cfg = _bool_cfg(baseline_established=True, baseline_rate=0.0, floor=10)
        events = _rising_events(15)  # triggers rapid_toggle
        hits = check_flaky(events, cfg)
        rule_ids = {h.rule_id for h in hits}
        assert "rapid_toggle" in rule_ids

    def test_float_routes_to_brown_out_and_spike(self) -> None:
        """check_flaky with data_type='float' uses brown_out + spike rules."""
        cfg = _float_cfg(baseline_established=True, threshold=2.0, brown_out_low=10.0)
        events = [_value_changed(50.0, 15.0)]  # spike
        hits = check_flaky(events, cfg)
        rule_ids = {h.rule_id for h in hits}
        assert "value_spike" in rule_ids

    def test_multiple_hits_possible(self) -> None:
        """Both spike and brown_out can fire in the same window."""
        cfg = _float_cfg(threshold=2.0, brown_out_low=10.0)
        events = [
            _value_changed(8.0, -12.0),  # below low
            _value_changed(20.0, 12.0),  # recover → excursion 1
            _value_changed(7.0, -13.0),  # below low
            _value_changed(50.0, 43.0),  # recover + spike (43 > 10)
        ]
        hits = check_flaky(events, cfg)
        rule_ids = {h.rule_id for h in hits}
        assert "brown_out" in rule_ids
        assert "value_spike" in rule_ids

    def test_conveyor_flicker_scenario(self) -> None:
        """
        conveyor_flicker.yaml signature: prox PE_B16_2 sees ≥5 bad-quality
        drops + 14 rising edges in 1 hour vs. stable-peer baseline of 4/hr.

        Expect: rapid_toggle fires (14 > floor=10) AND
                intermittent_disc fires (5 bad-quality runs).
        """
        cfg = _bool_cfg(
            tag_id="PE_B16_2",
            baseline_established=True,
            baseline_rate=4.0,
            floor=10,
        )

        # Build events: 14 rising edges interspersed with 5 bad-quality runs
        events: list[TagEvent] = []
        # 5 bad-quality runs separated by good events
        for i in range(5):
            events.append(TagEvent(event_type="rising_edge", ts=i * 4, raw_quality="bad"))
            events.append(TagEvent(event_type="falling_edge", ts=i * 4 + 1, raw_quality="good"))

        # Remaining 9 rising edges (to reach 14 total; 5 already counted above)
        for i in range(9):
            events.append(TagEvent(event_type="rising_edge", ts=100 + i, raw_quality="good"))

        hits = check_flaky(events, cfg)
        rule_ids = {h.rule_id for h in hits}

        assert "rapid_toggle" in rule_ids, (
            "Should detect rapid toggle when rising edges exceed baseline"
        )
        assert "intermittent_disc" in rule_ids, (
            "Should detect intermittent disconnect from bad-quality runs"
        )


# ── RuleHit dataclass ─────────────────────────────────────────────────────────

class TestRuleHit:
    def test_default_extra_is_empty_dict(self) -> None:
        h = RuleHit(rule_id="rapid_toggle")
        assert h.extra == {}
        # Ensure default factory is per-instance (not shared)
        h2 = RuleHit(rule_id="value_spike")
        h.extra["x"] = 1
        assert h2.extra == {}, "extra dict must not be shared between instances"
