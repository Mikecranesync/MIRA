"""Tag diff / event-stream logger — Walker DT "historize" step (Phase 5).

The raw tag_events stream (migration 033) is every accepted reading. That is
faithful but noisy: a poller pushing the same prox value 10×/s writes 10 rows
that say nothing changed. This module turns that raw stream into the
*meaningful-change* stream (migration 037 `tag_event_diffs`) — the queryable
history of what actually transitioned:

  - rising_edge / falling_edge          : a digital input crossed 0↔1
  - threshold_cross_high / _low         : an analog value crossed a configured
                                          limit (entered / left an alarm band)
  - quality_degraded / quality_recovered: OPC quality good↔bad
  - value_changed                       : any other non-edge value change
  - fault windows                       : diffs within ±N s of a fault-trigger
                                          edge share a fault_window_id, so
                                          "everything around fault X" is one
                                          indexed query

Design mirrors tag_ingest.py: a pure orchestration function (`compute_diffs`)
over an injected, store-agnostic boundary (`DiffStore`). `NeonDiffStore` is the
prod implementation (SQLAlchemy NullPool, RLS-bound); tests inject an in-memory
store and a plain event list, so the transition logic is verified without a
live NeonDB.

The logger is INCREMENTAL and STATELESS across process restarts: callers pass
the prior per-tag state (last value + quality) in and get the updated state
back, so a long stream can be processed batch-by-batch without re-reading the
whole of tag_events. The first observation of a tag emits no edge (there is no
"previous" to transition from) — only a quality/value baseline is recorded.

Provenance: `simulated` is carried through from each source reading, never
recomputed and never mixed. A diff derived from a simulated reading is
simulated=true.

Runtime trigger (cron / worker that calls this on the live stream) is a
documented Phase-5 follow-up — see PLAN.md / HANDOFF. This module ships the
logic + store boundary + tests; wiring it to a schedule is additive.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Optional, Protocol

logger = logging.getLogger("mira-relay.tag_diff_logger")

DIGITAL_VALUE_TYPES = {"bool"}
ANALOG_VALUE_TYPES = {"int", "float"}

# Diff-type vocabulary — must match migration 037's CHECK constraint.
RISING_EDGE = "rising_edge"
FALLING_EDGE = "falling_edge"
THRESHOLD_CROSS_HIGH = "threshold_cross_high"
THRESHOLD_CROSS_LOW = "threshold_cross_low"
QUALITY_DEGRADED = "quality_degraded"
QUALITY_RECOVERED = "quality_recovered"
VALUE_CHANGED = "value_changed"

_GOOD_QUALITY = "good"


# ── Inputs / outputs ─────────────────────────────────────────────────────────


@dataclass
class TagReading:
    """One raw reading, as it lands in tag_events. The logger reads these in
    event_timestamp order per tag."""

    tag_path: str
    value: Optional[str]            # canonical TEXT form (as tag_events.value)
    value_type: str                 # bool | int | float | string | enum
    quality: str                    # good | bad | stale | uncertain
    event_timestamp: float          # epoch seconds (sortable, window math)
    event_id: Optional[str] = None  # tag_events.event_id (replay anchor)
    uns_path: Optional[str] = None
    source_system: Optional[str] = None
    simulated: bool = False
    metadata: dict = field(default_factory=dict)


@dataclass
class TagState:
    """Per-tag carry-forward state so the logger is incremental."""

    last_value: Optional[str] = None
    last_quality: Optional[str] = None
    last_event_id: Optional[str] = None
    # Which alarm band the analog value last sat in, per threshold key, so a
    # crossing fires once on entry, not every sample inside the band.
    above_threshold: dict[str, bool] = field(default_factory=dict)


@dataclass
class TagDiff:
    tenant_id: str
    tag_path: str
    diff_type: str
    prev_value: Optional[str]
    new_value: Optional[str]
    value_type: str
    event_timestamp: float
    uns_path: Optional[str] = None
    threshold: Optional[float] = None
    from_event_id: Optional[str] = None
    to_event_id: Optional[str] = None
    fault_window_id: Optional[str] = None
    source_system: Optional[str] = None
    simulated: bool = False
    metadata: dict = field(default_factory=dict)


@dataclass
class DiffConfig:
    """What counts as 'meaningful'.

    digital_tags         : tag paths whose 0↔1 transitions emit edges. A tag
                           with value_type 'bool' is treated as digital even if
                           not listed; this set lets int/enum tags be coerced
                           to digital explicitly.
    analog_thresholds    : {tag_path: {threshold_key: limit}} — each limit emits
                           threshold_cross_high on upward crossing and
                           threshold_cross_low on downward crossing.
    fault_trigger_tags   : tag paths whose RISING edge opens a fault window.
    fault_window_seconds : ±N seconds grouped around a fault trigger.
    emit_value_changed   : if True, non-edge string/enum value changes emit a
                           value_changed diff (default True).
    """

    digital_tags: set[str] = field(default_factory=set)
    analog_thresholds: dict[str, dict[str, float]] = field(default_factory=dict)
    fault_trigger_tags: set[str] = field(default_factory=set)
    fault_window_seconds: float = 5.0
    emit_value_changed: bool = True

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "DiffConfig":
        return cls(
            digital_tags=set(raw.get("digital_tags") or []),
            analog_thresholds={
                k: {tk: float(tv) for tk, tv in (v or {}).items()}
                for k, v in (raw.get("analog_thresholds") or {}).items()
            },
            fault_trigger_tags=set(raw.get("fault_trigger_tags") or []),
            fault_window_seconds=float(raw.get("fault_window_seconds", 5.0)),
            emit_value_changed=bool(raw.get("emit_value_changed", True)),
        )


# ── Value coercion ───────────────────────────────────────────────────────────


def _as_bool(value: Optional[str]) -> Optional[bool]:
    if value is None:
        return None
    v = value.strip().lower()
    if v in ("true", "1", "on", "1.0"):
        return True
    if v in ("false", "0", "off", "0.0"):
        return False
    return None


def _as_float(value: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# ── Core: compute diffs ──────────────────────────────────────────────────────


def compute_diffs(
    readings: list[TagReading],
    config: DiffConfig,
    prev_state: Optional[dict[str, TagState]] = None,
    *,
    tenant_id: str,
    fault_window_id_factory=None,
) -> tuple[list[TagDiff], dict[str, TagState]]:
    """Derive meaningful diffs from a batch of raw readings.

    `readings` are processed in (event_timestamp, then input) order, grouped per
    tag for transition detection. Returns (diffs, updated_state). The caller
    persists the diffs and carries `updated_state` into the next batch.

    `fault_window_id_factory` mints fault-window ids; defaults to a deterministic
    counter so tests are stable (Math.random/uuid are avoided for reproducible
    output — the prod store can re-stamp real UUIDs on insert).
    """
    state: dict[str, TagState] = {
        k: TagState(
            last_value=v.last_value,
            last_quality=v.last_quality,
            last_event_id=v.last_event_id,
            above_threshold=dict(v.above_threshold),
        )
        for k, v in (prev_state or {}).items()
    }

    ordered = sorted(
        enumerate(readings), key=lambda pair: (pair[1].event_timestamp, pair[0])
    )

    diffs: list[TagDiff] = []
    for _, r in ordered:
        st = state.setdefault(r.tag_path, TagState())
        diffs.extend(_diffs_for_reading(r, st, config, tenant_id))
        # Advance state AFTER computing diffs for this reading.
        st.last_value = r.value
        st.last_quality = r.quality
        st.last_event_id = r.event_id

    _assign_fault_windows(diffs, config, fault_window_id_factory)
    return diffs, state


def _diffs_for_reading(
    r: TagReading, st: TagState, config: DiffConfig, tenant_id: str
) -> list[TagDiff]:
    out: list[TagDiff] = []

    def _mk(diff_type: str, threshold: Optional[float] = None) -> TagDiff:
        return TagDiff(
            tenant_id=tenant_id,
            tag_path=r.tag_path,
            diff_type=diff_type,
            prev_value=st.last_value,
            new_value=r.value,
            value_type=r.value_type,
            event_timestamp=r.event_timestamp,
            uns_path=r.uns_path,
            threshold=threshold,
            from_event_id=st.last_event_id,
            to_event_id=r.event_id,
            source_system=r.source_system,
            simulated=r.simulated,
            metadata=dict(r.metadata),
        )

    # 1) Quality transitions (independent of value).
    prev_q = st.last_quality
    if prev_q is not None and prev_q != r.quality:
        if prev_q == _GOOD_QUALITY and r.quality != _GOOD_QUALITY:
            out.append(_mk(QUALITY_DEGRADED))
        elif prev_q != _GOOD_QUALITY and r.quality == _GOOD_QUALITY:
            out.append(_mk(QUALITY_RECOVERED))

    # Bad-quality readings carry no trustworthy value — don't derive value
    # transitions from them (avoids phantom edges on a dropout).
    if r.quality != _GOOD_QUALITY:
        return out

    first_seen = st.last_value is None

    # 2) Digital edges.
    is_digital = r.value_type in DIGITAL_VALUE_TYPES or r.tag_path in config.digital_tags
    if is_digital:
        new_b = _as_bool(r.value)
        old_b = _as_bool(st.last_value)
        if not first_seen and old_b is not None and new_b is not None and old_b != new_b:
            out.append(_mk(RISING_EDGE if new_b else FALLING_EDGE))
        return out

    # 3) Analog threshold crossings.
    thresholds = config.analog_thresholds.get(r.tag_path)
    if thresholds:
        new_f = _as_float(r.value)
        if new_f is not None:
            for key, limit in thresholds.items():
                was_above = st.above_threshold.get(key)
                now_above = new_f >= limit
                if was_above is not None and was_above != now_above:
                    out.append(
                        _mk(
                            THRESHOLD_CROSS_HIGH if now_above else THRESHOLD_CROSS_LOW,
                            threshold=limit,
                        )
                    )
                st.above_threshold[key] = now_above
        return out

    # 4) Catch-all value change (strings / enums / unconfigured analogs).
    if config.emit_value_changed and not first_seen and st.last_value != r.value:
        out.append(_mk(VALUE_CHANGED))
    return out


def _assign_fault_windows(
    diffs: list[TagDiff], config: DiffConfig, factory=None
) -> None:
    """Group diffs within ±fault_window_seconds of a fault-trigger rising edge
    under a shared fault_window_id (mutates diffs in place)."""
    if not config.fault_trigger_tags:
        return
    triggers = [
        d
        for d in diffs
        if d.tag_path in config.fault_trigger_tags and d.diff_type == RISING_EDGE
    ]
    if not triggers:
        return

    _counter = {"n": 0}

    def _default_mint():  # deterministic, test-stable ids
        _counter["n"] += 1
        return f"fault-window-{_counter['n']}"

    mint = factory or _default_mint

    window = config.fault_window_seconds
    for trig in triggers:
        wid = mint()
        lo = trig.event_timestamp - window
        hi = trig.event_timestamp + window
        for d in diffs:
            if lo <= d.event_timestamp <= hi and d.fault_window_id is None:
                d.fault_window_id = wid


# ── Store boundary ───────────────────────────────────────────────────────────


class DiffStore(Protocol):
    """Persistence boundary. NeonDiffStore is prod; tests inject in-memory."""

    def load_state(
        self, tenant_id: str, tag_paths: list[str], before_ts: float
    ) -> dict[str, TagState]:
        """Return the latest TagState per tag strictly before ``before_ts``."""
        ...

    def persist_diffs(self, diffs: list[TagDiff]) -> int:
        """Append diffs to tag_event_diffs. Returns rows written."""
        ...


class TagDiffLogger:
    """Orchestrates compute_diffs over an injected store."""

    def __init__(self, store: DiffStore) -> None:
        self.store = store
        self.last_written_count = 0

    def process_batch(
        self, readings: list[TagReading], config: DiffConfig, *, tenant_id: str
    ) -> list[TagDiff]:
        self.last_written_count = 0
        if not tenant_id:
            raise ValueError("tenant_required")
        if not readings:
            return []
        tag_paths = sorted({r.tag_path for r in readings})
        batch_start = min(r.event_timestamp for r in readings)
        prev_state = self.store.load_state(tenant_id, tag_paths, batch_start)
        diffs, _ = compute_diffs(readings, config, prev_state, tenant_id=tenant_id)
        if diffs:
            self.last_written_count = self.store.persist_diffs(diffs)
            logger.info(
                "TAG_DIFFS tenant=%s readings=%d diffs=%d written=%d",
                tenant_id,
                len(readings),
                len(diffs),
                self.last_written_count,
            )
        return diffs


def _resolve_existing_fault_window_id(
    existing_ids: list[Optional[str]],
) -> Optional[str]:
    """Return one persisted window id, or fail closed on fractured evidence."""
    if not existing_ids:
        return None
    if any(window_id is None for window_id in existing_ids):
        raise ValueError("missing_existing_fault_window_id")
    distinct = set(existing_ids)
    if len(distinct) != 1:
        raise ValueError("conflicting_existing_fault_windows")
    return next(iter(distinct))


# ──────────────────────────────────────────────────────────────────────────
# NeonDiffStore — prod persistence (SQLAlchemy NullPool + RLS), same pattern
# as tag_ingest.NeonTagStore. Lazy imports keep the in-memory test path free of
# sqlalchemy. Real UUIDs for fault windows are minted here via gen_random_uuid()
# at insert time (the in-memory path uses the deterministic counter).
# ──────────────────────────────────────────────────────────────────────────


class NeonDiffStore:
    """Writes tag_event_diffs to NeonDB (Hub schema) and reads carry-forward
    state from the latest tag_events per tag."""

    def __init__(self, neon_url: str) -> None:
        self.neon_url = neon_url

    def _engine(self):
        from sqlalchemy import NullPool, create_engine

        return create_engine(
            self.neon_url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )

    def load_state(
        self, tenant_id: str, tag_paths: list[str], before_ts: float
    ) -> dict[str, TagState]:
        if not tag_paths:
            return {}
        from sqlalchemy import text

        # The carry-forward baseline is the most recent raw reading per tag.
        engine = self._engine()
        with engine.connect() as conn:
            conn.execute(text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id})
            rows = conn.execute(
                text(
                    """
                    SELECT DISTINCT ON (tag_path)
                           tag_path, value, quality, event_id::text AS event_id
                      FROM tag_events
                     WHERE tenant_id = :tid AND tag_path = ANY(:tags)
                       AND event_timestamp < to_timestamp(:before_ts)
                     ORDER BY tag_path, event_timestamp DESC
                    """
                ),
                {"tid": tenant_id, "tags": tag_paths, "before_ts": before_ts},
            ).mappings().all()
        return {
            r["tag_path"]: TagState(
                last_value=r["value"],
                last_quality=r["quality"],
                last_event_id=r["event_id"],
            )
            for r in rows
        }

    def persist_diffs(self, diffs: list[TagDiff]) -> int:
        if not diffs:
            return 0
        import json

        from sqlalchemy import text

        tenant_id = diffs[0].tenant_id
        if any(d.tenant_id != tenant_id for d in diffs):
            raise ValueError("mixed_tenant_diff_batch")
        params = [
            {
                "tenant_id": d.tenant_id,
                "uns_path": d.uns_path,
                "tag_path": d.tag_path,
                "diff_type": d.diff_type,
                "prev_value": d.prev_value,
                "new_value": d.new_value,
                "value_type": d.value_type,
                "threshold": d.threshold,
                "from_event_id": d.from_event_id,
                "to_event_id": d.to_event_id,
                # Local string ids map to one DB UUID per distinct window.
                "fw_key": d.fault_window_id,
                "source_system": d.source_system,
                "simulated": d.simulated,
                "event_timestamp": d.event_timestamp,
                "metadata": json.dumps(d.metadata),
            }
            for d in diffs
        ]
        # Map each distinct local fault-window key to a real UUID so DB rows get
        # proper UUIDs while the in-batch grouping is preserved.
        window_uuids: dict[str, Optional[str]] = {}
        inserted = 0
        with self._engine().begin() as conn:
            conn.execute(text("SET LOCAL app.current_tenant_id = :tid"), {"tid": tenant_id})
            # Cursor save is a later transaction. Serialize a tenant's diff
            # writes here so concurrent retries cannot race the duplicate
            # check even though the schema has no matching UNIQUE constraint.
            conn.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:tid, 0))"),
                {"tid": tenant_id},
            )
            window_groups: dict[str, list[dict[str, Any]]] = {}
            for p in params:
                if p["fw_key"] is not None:
                    window_groups.setdefault(p["fw_key"], []).append(p)

            existing_window_sql = text(
                """
                WITH members AS (
                    SELECT item
                      FROM jsonb_array_elements(
                           CAST(:semantic_members AS JSONB)
                      ) AS member(item)
                )
                SELECT existing.fault_window_id::text
                  FROM tag_event_diffs existing
                  JOIN members
                    ON existing.to_event_id IS NOT DISTINCT FROM
                       CAST(members.item ->> 'to_event_id' AS UUID)
                   AND existing.diff_type = members.item ->> 'diff_type'
                   AND existing.threshold IS NOT DISTINCT FROM
                       CAST(members.item ->> 'threshold' AS DOUBLE PRECISION)
                 WHERE existing.tenant_id = CAST(:tenant_id AS UUID)
                """
            )
            for key, group in window_groups.items():
                semantic_members = json.dumps(
                    [
                        {
                            "to_event_id": p["to_event_id"],
                            "diff_type": p["diff_type"],
                            "threshold": p["threshold"],
                        }
                        for p in group
                    ]
                )
                existing_ids = (
                    conn.execute(
                        existing_window_sql,
                        {
                            "tenant_id": tenant_id,
                            "semantic_members": semantic_members,
                        },
                    )
                    .scalars()
                    .all()
                )
                existing_window = _resolve_existing_fault_window_id(existing_ids)
                window_uuids[key] = existing_window or conn.execute(
                    text("SELECT gen_random_uuid()::text")
                ).scalar()

            for p in params:
                p["fault_window_id"] = window_uuids.get(p["fw_key"])
            insert_sql = text(
                """
                    INSERT INTO tag_event_diffs
                        (tenant_id, uns_path, tag_path, diff_type,
                         prev_value, new_value, value_type, threshold,
                         from_event_id, to_event_id, fault_window_id,
                         source_system, simulated, event_timestamp, metadata)
                    SELECT
                         CAST(:tenant_id AS UUID), CAST(:uns_path AS LTREE),
                         :tag_path, :diff_type,
                         :prev_value, :new_value, :value_type, :threshold,
                         CAST(:from_event_id AS UUID), CAST(:to_event_id AS UUID),
                         CAST(:fault_window_id AS UUID),
                         :source_system, :simulated,
                         to_timestamp(:event_timestamp), CAST(:metadata AS JSONB)
                     WHERE NOT EXISTS (
                           SELECT 1
                             FROM tag_event_diffs existing
                            WHERE existing.tenant_id = CAST(:tenant_id AS UUID)
                              AND existing.to_event_id IS NOT DISTINCT FROM
                                  CAST(:to_event_id AS UUID)
                              AND existing.diff_type = :diff_type
                              AND existing.threshold IS NOT DISTINCT FROM :threshold
                     )
                    RETURNING 1
                """
            )
            for p in params:
                if conn.execute(insert_sql, p).scalar_one_or_none() is not None:
                    inserted += 1
        return inserted
