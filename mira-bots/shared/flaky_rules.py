"""Flaky-input detection rules (master plan D6, Phase 9 / issue #1661).

Pure functions — no I/O, no DB. All rules accept a list of tag_event_diffs dicts
(columns from migration 037) and return a RuleResult. The detector
(mira-bots/agents/flaky_input_detector.py) owns the DB reads and writes; these
functions own only the signal recognition.

Rules
─────
  rapid_toggle       — digital input chattering (many rising/falling edges in 1h)
  brown_out          — repeated quality_degraded events (power instability)
  intermittent_disc  — quality_degraded/quality_recovered cycles (disconnect)
  value_spike        — analog value > N×stddev from the 7-day baseline mean

Thresholds are parameterised so tests can override them without env-var gymnastics.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Default thresholds.
RAPID_TOGGLE_MIN_TRANSITIONS: int = 10  # edge events per window to fire
BROWN_OUT_MIN_EVENTS: int = 3  # quality_degraded events per window
INTERMITTENT_DISC_MIN_CYCLES: int = 2  # degrade+recover cycles per window
VALUE_SPIKE_STDDEV_MULTIPLIER: float = 3.0
VALUE_SPIKE_MIN_BASELINE_EVENTS: int = 20  # minimum events for a reliable baseline


@dataclass
class RuleResult:
    fired: bool
    rule_name: str
    detection_window: str
    transition_count: int
    confidence: str  # 'low' | 'medium' | 'high'
    evidence_event_ids: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


def _confidence_band(count: int, low_threshold: int) -> str:
    if count >= low_threshold * 2:
        return "high"
    if count >= int(low_threshold * 1.5):
        return "medium"
    return "low"


def rapid_toggle(
    diffs: list[dict[str, Any]],
    *,
    window: str = "1h",
    min_transitions: int = RAPID_TOGGLE_MIN_TRANSITIONS,
) -> RuleResult:
    """Fire when a digital input toggles more than min_transitions times in window.

    Counts rising_edge + falling_edge diffs. The alternating pattern (1→0→1→0…)
    is what distinguishes chattering from a one-time flip.
    """
    edge_diffs = [d for d in diffs if d.get("diff_type") in ("rising_edge", "falling_edge")]
    count = len(edge_diffs)
    if count < min_transitions:
        return RuleResult(
            fired=False,
            rule_name="rapid_toggle",
            detection_window=window,
            transition_count=count,
            confidence="low",
        )
    ids = [str(d.get("to_event_id") or d.get("diff_id") or "") for d in edge_diffs]
    return RuleResult(
        fired=True,
        rule_name="rapid_toggle",
        detection_window=window,
        transition_count=count,
        confidence=_confidence_band(count, min_transitions),
        evidence_event_ids=[i for i in ids if i],
        metadata={
            "rising": sum(1 for d in edge_diffs if d.get("diff_type") == "rising_edge"),
            "falling": sum(1 for d in edge_diffs if d.get("diff_type") == "falling_edge"),
        },
    )


def brown_out(
    diffs: list[dict[str, Any]],
    *,
    window: str = "1h",
    min_events: int = BROWN_OUT_MIN_EVENTS,
) -> RuleResult:
    """Fire when quality degrades repeatedly (power or signal brownout pattern).

    Counts quality_degraded diffs. A single degrade followed by recovery is not a
    brownout; recurrent degradation is.
    """
    degrade = [d for d in diffs if d.get("diff_type") == "quality_degraded"]
    count = len(degrade)
    if count < min_events:
        return RuleResult(
            fired=False,
            rule_name="brown_out",
            detection_window=window,
            transition_count=count,
            confidence="low",
        )
    ids = [str(d.get("to_event_id") or d.get("diff_id") or "") for d in degrade]
    return RuleResult(
        fired=True,
        rule_name="brown_out",
        detection_window=window,
        transition_count=count,
        confidence=_confidence_band(count, min_events),
        evidence_event_ids=[i for i in ids if i],
        metadata={"quality_degraded_count": count},
    )


def intermittent_disc(
    diffs: list[dict[str, Any]],
    *,
    window: str = "1h",
    min_cycles: int = INTERMITTENT_DISC_MIN_CYCLES,
) -> RuleResult:
    """Fire when quality oscillates between good and bad (disconnect cycling).

    Counts degrade→recover pairs. A single pair may be a momentary glitch;
    multiple cycles indicate a loose cable or intermittent connection.
    """
    qual_events = [
        d.get("diff_type")
        for d in diffs
        if d.get("diff_type") in ("quality_degraded", "quality_recovered")
    ]
    cycles = 0
    pending = False
    for evt in qual_events:
        if evt == "quality_degraded":
            pending = True
        elif evt == "quality_recovered" and pending:
            cycles += 1
            pending = False

    if cycles < min_cycles:
        return RuleResult(
            fired=False,
            rule_name="intermittent_disc",
            detection_window=window,
            transition_count=cycles,
            confidence="low",
        )
    disc_diffs = [
        d for d in diffs if d.get("diff_type") in ("quality_degraded", "quality_recovered")
    ]
    ids = [str(d.get("to_event_id") or d.get("diff_id") or "") for d in disc_diffs]
    return RuleResult(
        fired=True,
        rule_name="intermittent_disc",
        detection_window=window,
        transition_count=cycles,
        confidence=_confidence_band(cycles, min_cycles),
        evidence_event_ids=[i for i in ids if i],
        metadata={"degrade_recover_cycles": cycles},
    )


def value_spike(
    diffs: list[dict[str, Any]],
    baseline: dict[str, Any],
    *,
    window: str = "1h",
    stddev_multiplier: float = VALUE_SPIKE_STDDEV_MULTIPLIER,
    min_baseline_events: int = VALUE_SPIKE_MIN_BASELINE_EVENTS,
) -> RuleResult:
    """Fire when an analog value deviates > N×stddev from the 7-day baseline mean.

    baseline must contain: 'mean' (float), 'stddev' (float), 'event_count' (int).
    Returns unfired (no-op) when the baseline is too shallow, stddev is zero, or
    no value_changed diffs exist for numeric types.
    """
    empty = RuleResult(
        fired=False,
        rule_name="value_spike",
        detection_window=window,
        transition_count=0,
        confidence="low",
    )
    if int(baseline.get("event_count") or 0) < min_baseline_events:
        return empty

    mean = baseline.get("mean")
    stddev = baseline.get("stddev")
    if mean is None or stddev is None or float(stddev) == 0.0:
        return empty

    threshold = float(stddev) * stddev_multiplier
    spikes: list[dict[str, Any]] = []
    for d in diffs:
        if d.get("diff_type") != "value_changed":
            continue
        if d.get("value_type") not in ("int", "float"):
            continue
        try:
            val = float(d["new_value"])
        except (TypeError, ValueError, KeyError):
            continue
        if abs(val - float(mean)) > threshold:
            spikes.append(d)

    count = len(spikes)
    if count == 0:
        return empty

    ids = [str(d.get("to_event_id") or d.get("diff_id") or "") for d in spikes]
    confidence = "high" if count >= 3 else "medium" if count >= 2 else "low"
    return RuleResult(
        fired=True,
        rule_name="value_spike",
        detection_window=window,
        transition_count=count,
        confidence=confidence,
        evidence_event_ids=[i for i in ids if i],
        metadata={
            "baseline_mean": float(mean),
            "baseline_stddev": float(stddev),
            "threshold": threshold,
            "spike_count": count,
        },
    )
