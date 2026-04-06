"""FSM model builder.

Takes a time-ordered list of StateVector observations and builds a
statistical FSMModel by computing transition durations between
consecutive states.

Anomaly markers:
  is_accepting — transitions whose stddev exceeds 3× the median stddev
                 across all transitions (unusually variable, worth flagging)
  is_rare      — transitions where count / total_transitions < rare_threshold
                 (default 0.005 — less than 0.5% of all observed transitions)
"""

from __future__ import annotations

import logging
import statistics
from collections import defaultdict
from datetime import datetime, timezone

from .models import FSMModel, StateVector, TransitionEnvelope

logger = logging.getLogger("mira-sidecar")

# Default rarity threshold — can be overridden via settings
_DEFAULT_RARE_THRESHOLD = 0.005


def _stddev(values: list[float]) -> float:
    """Population stddev; returns 0.0 for single-sample lists."""
    if len(values) < 2:
        return 0.0
    return statistics.stdev(values)


def build_fsm(
    asset_id: str,
    history: list[StateVector],
    rare_threshold: float = _DEFAULT_RARE_THRESHOLD,
) -> FSMModel:
    """Build an FSMModel from a time-ordered sequence of state observations.

    Args:
        asset_id: Equipment identifier.
        history: Ordered list of StateVector items (must have ≥2 entries to
                 compute any transitions).
        rare_threshold: Fraction of total transitions below which a transition
                        is considered rare (default 0.005).

    Returns:
        FSMModel with populated transitions dict and cycle/anomaly metadata.
    """
    if len(history) < 2:
        logger.warning(
            "build_fsm: asset_id=%s — history too short (%d items), returning empty model",
            asset_id,
            len(history),
        )
        return FSMModel(
            asset_id=asset_id,
            transitions={},
            cycle_count=0,
            created_at=datetime.now(timezone.utc).isoformat(),
        )

    # Sort by timestamp to guarantee ordering
    sorted_history = sorted(history, key=lambda sv: sv.timestamp_ms)

    # Accumulate raw durations per (from_state, to_state) pair
    raw: dict[tuple[str, str], list[float]] = defaultdict(list)
    for prev, curr in zip(sorted_history, sorted_history[1:]):
        delta_ms = float(curr.timestamp_ms - prev.timestamp_ms)
        if delta_ms < 0:
            logger.warning(
                "build_fsm: negative delta_ms (%f) for %s→%s, skipping",
                delta_ms,
                prev.state,
                curr.state,
            )
            continue
        raw[(prev.state, curr.state)].append(delta_ms)

    total_transitions = sum(len(v) for v in raw.values())
    if total_transitions == 0:
        logger.warning("build_fsm: asset_id=%s — no valid transitions", asset_id)
        return FSMModel(
            asset_id=asset_id,
            transitions={},
            cycle_count=0,
            created_at=datetime.now(timezone.utc).isoformat(),
        )

    # Build TransitionEnvelope for each pair (without anomaly flags yet)
    envelopes: dict[tuple[str, str], TransitionEnvelope] = {}
    for (from_s, to_s), durations in raw.items():
        envelopes[(from_s, to_s)] = TransitionEnvelope(
            mean_ms=statistics.mean(durations),
            stddev_ms=_stddev(durations),
            min_ms=min(durations),
            max_ms=max(durations),
            count=len(durations),
        )

    # ------------------------------------------------------------------
    # Flag accepting states (high-variance transitions)
    # ------------------------------------------------------------------
    all_stddevs = [e.stddev_ms for e in envelopes.values()]
    # median_stddev guards against outliers dominating the threshold
    median_stddev = statistics.median(all_stddevs) if all_stddevs else 0.0
    accepting_threshold = 3.0 * median_stddev

    # ------------------------------------------------------------------
    # Flag rare transitions
    # ------------------------------------------------------------------
    for key, env in envelopes.items():
        fraction = env.count / total_transitions
        is_rare = fraction < rare_threshold
        is_accepting = env.stddev_ms > accepting_threshold if median_stddev > 0 else False
        envelopes[key] = TransitionEnvelope(
            mean_ms=env.mean_ms,
            stddev_ms=env.stddev_ms,
            min_ms=env.min_ms,
            max_ms=env.max_ms,
            count=env.count,
            is_accepting=is_accepting,
            is_rare=is_rare,
        )

    # ------------------------------------------------------------------
    # Assemble nested dict[from_state][to_state]
    # ------------------------------------------------------------------
    nested: dict[str, dict[str, TransitionEnvelope]] = defaultdict(dict)
    for (from_s, to_s), env in envelopes.items():
        nested[from_s][to_s] = env

    # Convert defaultdict to plain dict for JSON serialisation
    transitions = {k: dict(v) for k, v in nested.items()}

    accepting_count = sum(1 for e in envelopes.values() if e.is_accepting)
    rare_count = sum(1 for e in envelopes.values() if e.is_rare)
    logger.info(
        "build_fsm: asset_id=%s transitions=%d total_obs=%d accepting=%d rare=%d",
        asset_id,
        len(envelopes),
        total_transitions,
        accepting_count,
        rare_count,
    )

    return FSMModel(
        asset_id=asset_id,
        transitions=transitions,
        cycle_count=total_transitions,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
