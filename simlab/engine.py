"""Deterministic, seeded tick engine for SimLab.

One tick = one second of simulation time.

Determinism contract
--------------------
- The engine is seeded once in ``__init__`` with ``random.Random(seed)``.
- Each tick is assigned a deterministic sub-stream index: ``tick * len(all_tags) + tag_index``.
  This means the ripple value for tag ``i`` at tick ``T`` is always the same, regardless
  of how many ``advance()`` calls were made to reach tick ``T``.
- ``advance(60)`` produces byte-identical snapshots to 60 × ``advance(1)``.
- ``ts`` on every ``Reading`` is ``BASE_EPOCH + tick`` (an integer epoch second,
  formatted as ISO-8601 UTC). Never uses ``datetime.now()`` or ``time.time()``.

BASE_EPOCH is 2025-01-01 00:00:00 UTC == 1735689600.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Optional

from simlab.models import LineModel, Reading, ValueType
from simlab.packml import PackMLState, run_state_label
from simlab.uns import tag_path

if TYPE_CHECKING:
    from simlab.scenarios import Scenario

logger = logging.getLogger("simlab.engine")

# Deterministic epoch: 2025-01-01 00:00:00 UTC
BASE_EPOCH: int = 1735689600


def _epoch_to_iso(epoch_sec: int) -> str:
    """Convert an integer epoch second to ISO-8601 UTC string."""
    return datetime.fromtimestamp(epoch_sec, tz=timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )


# Healthy-state ripple amplitude for each value type.
# Float tags get ±_RIPPLE_SCALE of their default; bool/string/enum/int get 0.
_RIPPLE_SCALE = 0.03  # ±3% Gaussian noise on float tags


class SimEngine:
    """Deterministic tick engine for a single SimLab line.

    Parameters
    ----------
    line:
        The ``LineModel`` to simulate (from ``simlab.lines``).
    seed:
        RNG seed for deterministic replay. Default 42.
    """

    def __init__(self, line: LineModel, seed: int = 42) -> None:
        self._line = line
        self._seed = seed
        # Pre-build an ordered list of (asset_id, tag_name, TagDef) for indexing.
        self._tag_index: list[tuple[str, str]] = [
            (asset.asset_id, tag_name)
            for asset in line.all_assets()
            for tag_name in sorted(asset.tags.keys())
        ]
        self._tag_pos: dict[tuple[str, str], int] = {
            pair: i for i, pair in enumerate(self._tag_index)
        }
        # Current tag state: {(asset_id, tag_name): value}
        self._state: dict[tuple[str, str], Any] = {}
        # Clean drift value — scenario-driven target without ripple noise.
        # Ripple anchors its noise to this value so healthy tags stay near their
        # baseline and faulted tags show realistic variance around the drift target.
        self._drift_value: dict[tuple[str, str], Any] = {}
        # PackML state per process asset
        self._packml: dict[str, PackMLState] = {}
        # Per-tag history: {(asset_id, tag_name): [(tick, value), ...]}
        self._history: dict[tuple[str, str], list[tuple[int, Any]]] = {}
        # Active alarms: {(asset_id, alarm_code): {info_dict}}
        self._active_alarms: dict[tuple[str, str], dict] = {}
        self._tick: int = 0
        self._scenario: Optional["Scenario"] = None
        self.reset()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def reset(self) -> None:
        """Reset all tags to their defaults, clear tick counter and scenario."""
        self._tick = 0
        self._scenario = None
        self._active_alarms.clear()
        self._history = {pair: [] for pair in self._tag_index}
        # Initialise state + drift-value tracker from tag defaults
        self._state = {}
        self._drift_value = {}
        for asset in self._line.all_assets():
            for tag_name, tag_def in asset.tags.items():
                self._state[(asset.asset_id, tag_name)] = tag_def.default
                self._drift_value[(asset.asset_id, tag_name)] = tag_def.default
            self._packml[asset.asset_id] = asset.packml_default
        # Record tick-0 state
        self._record_tick(0)

    def load_scenario(self, scenario: "Scenario") -> None:
        """Load a scenario.  Applies normal_state overrides; does not advance time."""
        self._scenario = scenario
        # Apply normal_state overrides to primary asset
        asset = self._line.asset(scenario.asset_id)
        for tag_name, value in scenario.normal_state.items():
            if tag_name in asset.tags:
                self._state[(asset.asset_id, tag_name)] = value
                self._drift_value[(asset.asset_id, tag_name)] = value
        # Apply cross-asset initial overrides (secondary_normal_state)
        for other_asset_id, overrides in scenario.secondary_normal_state.items():
            try:
                other_asset = self._line.asset(other_asset_id)
            except KeyError:
                logger.warning(
                    "secondary_normal_state: unknown asset %r in scenario %r",
                    other_asset_id,
                    scenario.id,
                )
                continue
            for tag_name, value in overrides.items():
                if tag_name in other_asset.tags:
                    self._state[(other_asset.asset_id, tag_name)] = value
                    self._drift_value[(other_asset.asset_id, tag_name)] = value
        logger.info("Loaded scenario %r on asset %s", scenario.id, scenario.asset_id)

    def advance(self, ticks: int = 1) -> None:
        """Advance simulation by ``ticks`` seconds.

        Each tick:
        1. Applies scenario drift (if loaded) for that tick.
        2. Applies healthy ripple to all float tags (deterministic).
        3. Evaluates alarms.
        4. Records history.
        """
        for _ in range(ticks):
            self._tick += 1
            self._apply_drift()
            self._apply_ripple()
            self._update_run_states()
            self._evaluate_alarms()
            self._record_tick(self._tick)

    @property
    def tick(self) -> int:
        """Current simulation tick (seconds since reset)."""
        return self._tick

    def snapshot(self) -> list[Reading]:
        """Return a ``Reading`` for every tag at the current tick."""
        ts = _epoch_to_iso(BASE_EPOCH + self._tick)
        readings: list[Reading] = []
        for asset in self._line.all_assets():
            for tag_name, tag_def in asset.tags.items():
                value = self._state[(asset.asset_id, tag_name)]
                readings.append(
                    Reading(
                        asset_id=asset.asset_id,
                        tag=tag_name,
                        category=tag_def.category,
                        value=value,
                        value_type=tag_def.value_type,
                        uns_path=tag_path(asset.asset_id, tag_def.category.value, tag_name),
                        ts=ts,
                        quality="good",
                        simulated=True,
                    )
                )
        return readings

    def snapshot_dict(self) -> dict[str, Any]:
        """Return ``{uns_path: value}`` for every tag at the current tick."""
        return {
            tag_path(
                self._line.asset(asset_id).asset_id,
                self._line.asset(asset_id).tags[tag_name].category.value,
                tag_name,
            ): value
            for (asset_id, tag_name), value in self._state.items()
        }

    def history(self, uns_path: str) -> list[tuple[int, Any]]:
        """Return ``[(tick, value), ...]`` for the given canonical UNS path."""
        # Reverse-map uns_path to (asset_id, tag_name)
        for asset in self._line.all_assets():
            for tag_name, tag_def in asset.tags.items():
                if tag_path(asset.asset_id, tag_def.category.value, tag_name) == uns_path:
                    return list(self._history[(asset.asset_id, tag_name)])
        return []

    def active_alarms(self) -> list[dict]:
        """Return list of active alarm dicts with asset/code/severity/message/since_tick."""
        return list(self._active_alarms.values())

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _rng_value(self, tick: int, tag_idx: int) -> float:
        """Deterministic float in [0, 1) for the given tick + tag position.

        Uses a seeded ``random.Random`` instance built from ``(self._seed, tick, tag_idx)``
        so the value is tick-indexed rather than draw-order-indexed.
        """
        import random

        r = random.Random((self._seed, tick, tag_idx))
        return r.random()

    def _apply_ripple(self) -> None:
        """Apply small deterministic Gaussian-like noise to all float tags.

        Noise is anchored to ``_drift_value`` — the clean scenario-driven value
        (no accumulated noise).  This prevents the random walk that would occur if
        noise were added to the already-noisy ``_state`` value each tick.

        Writable setpoint tags (e.g. fill_level_target_oz, cap_torque_target) are
        excluded so their operator-set values are not perturbed by ripple.
        """
        for i, (asset_id, tag_name) in enumerate(self._tag_index):
            tag_def = self._line.asset(asset_id).tags[tag_name]
            if tag_def.value_type is not ValueType.FLOAT:
                continue
            # Setpoint / writable tags must not be perturbed by noise
            if tag_def.writable:
                continue
            base = self._drift_value.get((asset_id, tag_name), tag_def.default)
            if tag_def.default == 0.0:
                continue
            # Map [0,1) → [-1,1) via u*2-1; scale by _RIPPLE_SCALE * original default.
            # Anchored to _drift_value so tags stay near their current drift target
            # and don't accumulate noise across ticks (no random walk).
            u = self._rng_value(self._tick, i)
            noise = (u * 2.0 - 1.0) * _RIPPLE_SCALE * abs(tag_def.default)
            self._state[(asset_id, tag_name)] = round(base + noise, 4)

    def _apply_drift(self) -> None:
        """Apply scenario-phase drift to the primary asset's tags.

        Ramp calculations use ``_drift_value`` (the noise-free target) so that
        the per-tick noise added by ``_apply_ripple`` does not corrupt the ramp
        trajectory.  Both ``_drift_value`` and ``_state`` are updated here;
        ``_apply_ripple`` will then add noise on top of ``_drift_value``.
        """
        if self._scenario is None:
            return
        active_phase = None
        for phase in reversed(self._scenario.timeline):
            if self._tick >= phase.start_tick:
                active_phase = phase
                break
        if active_phase is None:
            return
        asset_id = self._scenario.asset_id
        for tag_name, target in active_phase.drift.items():
            key = (asset_id, tag_name)
            if key not in self._state:
                continue
            if callable(target):
                new_val = target(self._tick)
                self._drift_value[key] = new_val
                self._state[key] = new_val
            else:
                # Ramp toward target using the clean drift value (not noisy _state)
                clean = self._drift_value.get(key, self._line.asset(asset_id).tags[tag_name].default)
                tag_def = self._line.asset(asset_id).tags.get(tag_name)
                if tag_def and tag_def.value_type is ValueType.FLOAT:
                    # Ramp: move 10% of the gap per tick
                    gap = target - clean
                    step = gap * 0.10
                    if abs(step) < 0.001:
                        step = gap
                    new_val = round(clean + step, 4)
                    self._drift_value[key] = new_val
                    self._state[key] = new_val
                else:
                    self._drift_value[key] = target
                    self._state[key] = target

    def _update_run_states(self) -> None:
        """Sync run_state tags to PackML state labels."""
        for asset in self._line.all_assets():
            if "run_state" not in asset.tags:
                continue
            packml = self._packml.get(asset.asset_id)
            if packml is None:
                continue
            self._state[(asset.asset_id, "run_state")] = run_state_label(packml)

    def _evaluate_alarms(self) -> None:
        """Evaluate declarative alarm predicates against current state."""
        for asset in self._line.all_assets():
            for alarm in asset.alarms:
                key = (asset.asset_id, alarm.code)
                source_value = self._state.get((asset.asset_id, alarm.source_tag))
                if source_value is None:
                    continue
                triggered = False
                if alarm.predicate is not None:
                    try:
                        triggered = bool(alarm.predicate(source_value))
                    except Exception:
                        triggered = False
                if triggered and key not in self._active_alarms:
                    self._active_alarms[key] = {
                        "asset_id": asset.asset_id,
                        "code": alarm.code,
                        "severity": alarm.severity.value,
                        "message": alarm.message,
                        "since_tick": self._tick,
                    }
                    logger.debug("Alarm %s fired at tick %d", alarm.code, self._tick)
                elif not triggered and key in self._active_alarms:
                    del self._active_alarms[key]

    def _record_tick(self, tick: int) -> None:
        """Append current values to per-tag history."""
        for pair in self._tag_index:
            self._history[pair].append((tick, self._state[pair]))
