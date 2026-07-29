"""Flaky-input / sensor-anomaly detection rules (Phase 9, issue #1661).

Pure functions: take a list of tag_event_diffs rows for a single
(tenant_id, tag_path) and return FlakySignal | None.  No DB access here.

Four rules (master plan D6):
  rapid_toggle     — boolean tag alternates too many times in the window
  brown_out        — numeric dips below threshold then recovers, repeatedly
  intermittent_disc — quality degrades then recovers, repeatedly
  value_spike      — a numeric reading deviates > N σ from the rolling mean

Usage (by flaky_detector_runner.py):
    from shared.detection.flaky_input import run_all_rules, FlakySignal
    signals = run_all_rules(diffs, tag_path)
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field

logger = logging.getLogger("mira-flaky-input")

# ── Config (override via env if needed; sensible defaults for 1h window) ──────

RAPID_TOGGLE_MEDIUM_THRESHOLD = 10   # transitions/window → medium confidence
RAPID_TOGGLE_HIGH_THRESHOLD = 20     # transitions/window → high confidence
BROWNOUT_CYCLE_THRESHOLD = 3         # dip+recover cycles to flag
INTERMITTENT_DISC_CYCLE_THRESHOLD = 3  # degrade+recover cycles to flag
VALUE_SPIKE_MIN_SAMPLES = 10         # minimum samples before stddev is reliable
VALUE_SPIKE_STDDEV_FACTOR = 3.0      # how many σ above mean qualifies as spike


@dataclass
class FlakySignal:
    rule: str                   # 'rapid_toggle' | 'brown_out' | 'intermittent_disc' | 'value_spike'
    tag_path: str
    transition_count: int       # number of relevant events that triggered this
    detection_window: str       # human-readable window, e.g. '1h'
    evidence_diff_ids: list[str] = field(default_factory=list)
    confidence: str = "medium"  # 'low' | 'medium' | 'high'
    metadata: dict = field(default_factory=dict)


# ── Rule: rapid_toggle ────────────────────────────────────────────────────────

def rapid_toggle(diffs: list[dict], detection_window: str = "1h") -> FlakySignal | None:
    """Flag a boolean/discrete tag that alternates direction too many times.

    Counts all rising_edge and falling_edge events; a high count for a single
    tag in the detection window indicates a flickering sensor (loose wiring,
    vibration, marginal threshold, or a genuinely faulting actuator).
    """
    edge_events = [
        d for d in diffs if d.get("diff_type") in ("rising_edge", "falling_edge")
    ]
    count = len(edge_events)
    if count < RAPID_TOGGLE_MEDIUM_THRESHOLD:
        return None

    confidence = "high" if count >= RAPID_TOGGLE_HIGH_THRESHOLD else "medium"
    tag_path = diffs[0]["tag_path"] if diffs else ""
    evidence = [str(d["diff_id"]) for d in edge_events]

    logger.debug("rapid_toggle tag=%s count=%d confidence=%s", tag_path, count, confidence)
    return FlakySignal(
        rule="rapid_toggle",
        tag_path=tag_path,
        transition_count=count,
        detection_window=detection_window,
        evidence_diff_ids=evidence,
        confidence=confidence,
        metadata={"rising": sum(1 for d in edge_events if d["diff_type"] == "rising_edge"),
                  "falling": sum(1 for d in edge_events if d["diff_type"] == "falling_edge")},
    )


# ── Rule: brown_out ───────────────────────────────────────────────────────────

def brown_out(diffs: list[dict], detection_window: str = "1h") -> FlakySignal | None:
    """Flag an analog tag that dips below threshold then recovers, repeatedly.

    Counts threshold_cross_low (dip) → threshold_cross_high (recovery) cycles.
    A transient dip that persists is a real fault; rapid cycling is a brown_out
    pattern (intermittent supply, marginal sensor, vibration at the threshold).
    """
    relevant = [
        d for d in diffs
        if d.get("diff_type") in ("threshold_cross_low", "threshold_cross_high")
    ]
    if not relevant:
        return None

    # Count complete dip→recover cycles
    cycles = 0
    evidence: list[str] = []
    in_dip = False
    for d in relevant:
        if d["diff_type"] == "threshold_cross_low" and not in_dip:
            in_dip = True
            evidence.append(str(d["diff_id"]))
        elif d["diff_type"] == "threshold_cross_high" and in_dip:
            in_dip = False
            cycles += 1
            evidence.append(str(d["diff_id"]))

    if cycles < BROWNOUT_CYCLE_THRESHOLD:
        return None

    tag_path = diffs[0]["tag_path"] if diffs else ""
    confidence = "high" if cycles >= BROWNOUT_CYCLE_THRESHOLD * 2 else "medium"

    logger.debug("brown_out tag=%s cycles=%d", tag_path, cycles)
    return FlakySignal(
        rule="brown_out",
        tag_path=tag_path,
        transition_count=cycles,
        detection_window=detection_window,
        evidence_diff_ids=evidence,
        confidence=confidence,
        metadata={"cycles": cycles},
    )


# ── Rule: intermittent_disc ───────────────────────────────────────────────────

def intermittent_disc(diffs: list[dict], detection_window: str = "1h") -> FlakySignal | None:
    """Flag a tag whose quality signal degrades and recovers repeatedly.

    Counts quality_degraded → quality_recovered cycles. An intermittent
    disconnection (bad cable, corroded terminal, loose plug) produces exactly
    this pattern: brief loss of quality that self-corrects.
    """
    relevant = [
        d for d in diffs
        if d.get("diff_type") in ("quality_degraded", "quality_recovered")
    ]
    if not relevant:
        return None

    cycles = 0
    evidence: list[str] = []
    degraded = False
    for d in relevant:
        if d["diff_type"] == "quality_degraded" and not degraded:
            degraded = True
            evidence.append(str(d["diff_id"]))
        elif d["diff_type"] == "quality_recovered" and degraded:
            degraded = False
            cycles += 1
            evidence.append(str(d["diff_id"]))

    if cycles < INTERMITTENT_DISC_CYCLE_THRESHOLD:
        return None

    tag_path = diffs[0]["tag_path"] if diffs else ""
    confidence = "high" if cycles >= INTERMITTENT_DISC_CYCLE_THRESHOLD * 2 else "medium"

    logger.debug("intermittent_disc tag=%s cycles=%d", tag_path, cycles)
    return FlakySignal(
        rule="intermittent_disc",
        tag_path=tag_path,
        transition_count=cycles,
        detection_window=detection_window,
        evidence_diff_ids=evidence,
        confidence=confidence,
        metadata={"cycles": cycles},
    )


# ── Rule: value_spike ─────────────────────────────────────────────────────────

def value_spike(diffs: list[dict], detection_window: str = "1h") -> FlakySignal | None:
    """Flag an analog tag with readings that deviate beyond N σ from the mean.

    Only runs on value_changed diffs with parseable float values.  Requires
    at least VALUE_SPIKE_MIN_SAMPLES readings for a reliable stddev.
    """
    readings = []
    for d in diffs:
        if d.get("diff_type") != "value_changed":
            continue
        try:
            readings.append((float(d["new_value"]), str(d["diff_id"])))
        except (TypeError, ValueError):
            continue

    if len(readings) < VALUE_SPIKE_MIN_SAMPLES:
        return None

    values = [v for v, _ in readings]
    mean = sum(values) / len(values)
    variance = sum((v - mean) ** 2 for v in values) / len(values)
    stddev = math.sqrt(variance)

    if stddev == 0:
        return None

    spikes = [
        (v, diff_id)
        for v, diff_id in readings
        if abs(v - mean) > VALUE_SPIKE_STDDEV_FACTOR * stddev
    ]
    if not spikes:
        return None

    tag_path = diffs[0]["tag_path"] if diffs else ""
    max_deviation = max(abs(v - mean) / stddev for v, _ in spikes)
    confidence = "high" if max_deviation >= VALUE_SPIKE_STDDEV_FACTOR * 2 else "medium"

    logger.debug("value_spike tag=%s spikes=%d max_dev=%.1fσ", tag_path, len(spikes), max_deviation)
    return FlakySignal(
        rule="value_spike",
        tag_path=tag_path,
        transition_count=len(spikes),
        detection_window=detection_window,
        evidence_diff_ids=[diff_id for _, diff_id in spikes],
        confidence=confidence,
        metadata={"mean": round(mean, 4), "stddev": round(stddev, 4),
                  "max_deviation_sigma": round(max_deviation, 2), "spike_count": len(spikes)},
    )


# ── Dispatcher ────────────────────────────────────────────────────────────────

def run_all_rules(diffs: list[dict], detection_window: str = "1h") -> list[FlakySignal]:
    """Run all four rules against a list of diffs for ONE (tenant, tag_path).

    Returns a (possibly empty) list of FlakySignal — caller writes each to DB.
    Diffs must be pre-sorted by event_timestamp ASC.
    """
    if not diffs:
        return []
    results: list[FlakySignal] = []
    for rule_fn in (rapid_toggle, brown_out, intermittent_disc, value_spike):
        try:
            sig = rule_fn(diffs, detection_window)
            if sig:
                results.append(sig)
        except Exception as exc:
            logger.warning("rule %s failed for tag %s: %s", rule_fn.__name__,
                           diffs[0].get("tag_path"), exc)
    return results
