"""Pure flaky-input detection rules for Phase 9 FlakyInputDetector.

NO database access here. All DB interaction lives in
`mira-bots/agents/flaky_input_detector.py`. These functions take plain
event lists and a config object and return `RuleHit` instances.

Rule spec: docs/plans/2026-06-01-mira-master-architecture-plan.md §D6

Four sub-cases:
  rapid_toggle      — bool tag toggles far more than its baseline cadence
  intermittent_disc — bool tag sees ≥3 runs of bad signal quality
  brown_out         — numeric tag crosses a low threshold and recovers ≥2 times
  value_spike       — numeric tag delta exceeds 5× the approved threshold

Baseline gate: when `cfg.baseline_established` is False, check_flaky() always
returns []. The worker is responsible for setting this flag after the tag has
been observed for at least `cfg.baseline_period_days` days.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger("mira-flaky-rules")


# ── Data types ────────────────────────────────────────────────────────────────

@dataclass
class TagEvent:
    """Minimal event row from tag_events; worker populates from NeonDB rows."""
    event_type: str           # rising_edge|falling_edge|value_changed|…
    ts: object                # datetime or comparable — only used for ordering
    delta: Optional[float] = None
    raw_quality: Optional[str] = None   # good|bad|stale|None
    prev_value: Optional[object] = None
    new_value: Optional[object] = None


@dataclass
class TagConfig:
    """Per-tag configuration populated by the worker from approved_tags rows.

    The worker reads approved_tags for the tag, computes baseline fields from
    historical tag_events, and constructs this object before calling
    check_flaky().  Rules stay pure — no DB leaks in.
    """
    tag_id: str
    tenant_id: str
    data_type: str              # 'bool' | 'int' | 'float' | 'enum'

    # Baseline gate — set to True once the tag has accumulated
    # >= baseline_period_days worth of events (worker responsibility).
    baseline_established: bool = False

    # Learned average rising-edge transitions per hour over the baseline window.
    # None when baseline is not yet established.
    baseline_transitions_per_hour: Optional[float] = None

    # Rapid-toggle: minimum absolute transitions/hr floor (never go below this
    # even if the baseline is very low).
    min_toggle_floor: int = 10

    # Brown-out: the low threshold value for numeric tags.
    # Typically 15-20% of nominal for voltage/current; 0 means feature off.
    brown_out_low: float = 0.0

    # Value-spike: the "normal" delta / change threshold for numeric tags.
    # Sourced from approved_tags.threshold; 0 means feature off.
    threshold: float = 0.0

    # Intermittent-disconnect: consecutive bad-quality event runs needed to fire.
    bad_quality_run_min: int = 3


@dataclass
class RuleHit:
    """A detection result returned by a rule function.

    The worker maps fields to flaky_input_signals columns:
      rule_id          → flaky_input_signals.rule_id
      transitions      → flaky_input_signals.transitions_count
      expected_max     → flaky_input_signals.expected_max
      Everything else  → flaky_input_signals.metadata JSONB
    """
    rule_id: str                                 # 'rapid_toggle' | …
    severity: str = "warning"                   # 'warning' | 'alert'
    transitions: int = 0                         # observed count (bool: rising edges)
    expected_max: int = 0                        # threshold that was exceeded
    # Extra evidence — serialised into metadata JSONB by the worker.
    extra: dict = field(default_factory=dict)


# ── Individual rule functions ─────────────────────────────────────────────────

def _check_rapid_toggle(events: list[TagEvent], cfg: TagConfig) -> list[RuleHit]:
    """Fire when rising-edge count exceeds learned baseline * 1.5, floor 10.

    Baseline must be established before this fires (caller guarantees it).
    """
    rising = sum(1 for e in events if e.event_type == "rising_edge")
    if rising == 0:
        return []

    baseline_rate = cfg.baseline_transitions_per_hour or 0.0
    expected_max = max(baseline_rate * 1.5, float(cfg.min_toggle_floor))
    expected_max_int = max(int(expected_max), cfg.min_toggle_floor)

    if rising <= expected_max_int:
        return []

    severity = "alert" if rising > expected_max_int * 2 else "warning"
    logger.debug(
        "RAPID_TOGGLE tag=%s rising=%d expected_max=%d severity=%s",
        cfg.tag_id, rising, expected_max_int, severity,
    )
    return [
        RuleHit(
            rule_id="rapid_toggle",
            severity=severity,
            transitions=rising,
            expected_max=expected_max_int,
            extra={"baseline_rate_per_hour": baseline_rate},
        )
    ]


def _check_intermittent_disc(events: list[TagEvent], cfg: TagConfig) -> list[RuleHit]:
    """Fire when there are >= bad_quality_run_min runs of bad/stale quality events.

    A "run" is a consecutive sequence of bad-quality events (raw_quality in
    ('bad', 'stale', None)). Each gap (good quality) between bad sequences
    counts as a separate run.

    Applies to bool tags only (caller's responsibility). Signal-quality
    issues on numeric tags are handled by value_spike / brown_out.
    """
    bad_quality_set = {"bad", "stale", None}
    runs = 0
    in_bad_run = False
    for e in events:
        q = e.raw_quality
        if q in bad_quality_set:
            if not in_bad_run:
                runs += 1
                in_bad_run = True
        else:
            in_bad_run = False

    if runs < cfg.bad_quality_run_min:
        return []

    transitions = runs  # use "transitions" field for the generic count
    logger.debug(
        "INTERMITTENT_DISC tag=%s bad_runs=%d min=%d",
        cfg.tag_id, runs, cfg.bad_quality_run_min,
    )
    return [
        RuleHit(
            rule_id="intermittent_disc",
            severity="warning",
            transitions=transitions,
            expected_max=cfg.bad_quality_run_min - 1,
            extra={"bad_quality_runs": runs},
        )
    ]


def _check_brown_out(events: list[TagEvent], cfg: TagConfig) -> list[RuleHit]:
    """Fire when a numeric tag crosses the low threshold and recovers >= 2 times.

    A "crossing" is a value_changed event where the new_value drops at or
    below cfg.brown_out_low. A "recovery" is when the next value_changed
    event rises above the threshold. Each drop+recovery pair = 1 excursion.

    Feature is off if cfg.brown_out_low == 0.0 (returns []).
    """
    if cfg.brown_out_low == 0.0:
        return []

    low = cfg.brown_out_low
    excursions = 0
    below = False

    for e in events:
        if e.event_type != "value_changed":
            continue
        try:
            val = float(e.new_value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if not below and val <= low:
            below = True
        elif below and val > low:
            below = False
            excursions += 1

    if excursions < 2:
        return []

    logger.debug(
        "BROWN_OUT tag=%s excursions=%d threshold=%.4f",
        cfg.tag_id, excursions, low,
    )
    return [
        RuleHit(
            rule_id="brown_out",
            severity="alert",
            transitions=excursions,
            expected_max=1,  # threshold: fewer than 2 excursions is okay
            extra={"crossings": excursions, "brown_out_low": low},
        )
    ]


def _check_value_spike(events: list[TagEvent], cfg: TagConfig) -> list[RuleHit]:
    """Fire when a value_changed event has delta > 5x the normal threshold.

    Feature is off if cfg.threshold == 0.0 (returns []).
    """
    if cfg.threshold == 0.0:
        return []

    spike_threshold = cfg.threshold * 5.0
    max_delta: float = 0.0

    for e in events:
        if e.event_type != "value_changed":
            continue
        d = e.delta if e.delta is not None else 0.0
        if abs(d) > max_delta:
            max_delta = abs(d)

    if max_delta <= spike_threshold:
        return []

    logger.debug(
        "VALUE_SPIKE tag=%s max_delta=%.4f spike_threshold=%.4f",
        cfg.tag_id, max_delta, spike_threshold,
    )
    return [
        RuleHit(
            rule_id="value_spike",
            severity="warning",
            transitions=1,
            expected_max=int(spike_threshold),
            extra={"max_delta": max_delta, "spike_threshold": spike_threshold},
        )
    ]


# ── Dispatcher ────────────────────────────────────────────────────────────────

def check_flaky(events: list[TagEvent], cfg: TagConfig) -> list[RuleHit]:
    """Top-level dispatcher — run relevant rules for cfg.data_type.

    Returns [] when:
      - cfg.baseline_established is False  (calibration period, suppress all)
      - cfg.data_type is 'enum'            (no rule defined for enum tags)
      - events is empty

    Pure function: no I/O, no side effects.
    """
    if not cfg.baseline_established:
        logger.debug(
            "BASELINE_NOT_ESTABLISHED tag=%s — suppressing flaky checks",
            cfg.tag_id,
        )
        return []

    if not events:
        return []

    hits: list[RuleHit] = []

    if cfg.data_type == "bool":
        hits += _check_rapid_toggle(events, cfg)
        hits += _check_intermittent_disc(events, cfg)
    elif cfg.data_type in ("int", "float"):
        hits += _check_brown_out(events, cfg)
        hits += _check_value_spike(events, cfg)
    # 'enum' → no rule, return []

    return hits
