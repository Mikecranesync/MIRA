"""Tests for the Phase-5 tag diff / event-stream logger.

compute_diffs is pure over an injected store, so these tests feed plain
TagReading lists and assert the meaningful-change output without a live NeonDB.
An InMemoryDiffStore exercises the TagDiffLogger orchestration + carry-forward.

Covered behaviours (PLAN.md P5):
  - digital rising / falling edges (0↔1)
  - no edge on the first observation of a tag (no prior to transition from)
  - no edge when a digital value repeats
  - analog threshold crossings (high on entry, low on exit), once per crossing
  - quality good→bad (degraded) and bad→good (recovered)
  - bad-quality readings don't spawn phantom value edges
  - value_changed catch-all for strings/enums
  - fault windows group diffs within ±N s of a fault-trigger rising edge
  - simulated provenance carried through, never recomputed
  - carry-forward state across batches (incremental)
"""

from __future__ import annotations

from tag_diff_logger import (
    FALLING_EDGE,
    QUALITY_DEGRADED,
    QUALITY_RECOVERED,
    RISING_EDGE,
    THRESHOLD_CROSS_HIGH,
    THRESHOLD_CROSS_LOW,
    VALUE_CHANGED,
    DiffConfig,
    TagDiff,
    TagDiffLogger,
    TagReading,
    compute_diffs,
)

TENANT = "t-1"


def _r(tag, value, ts, *, vt="bool", quality="good", simulated=False, eid=None, uns=None):
    return TagReading(
        tag_path=tag,
        value=str(value) if value is not None else None,
        value_type=vt,
        quality=quality,
        event_timestamp=float(ts),
        event_id=eid,
        uns_path=uns,
        source_system="plc_bridge",
        simulated=simulated,
    )


def _types(diffs: list[TagDiff]) -> list[str]:
    return [d.diff_type for d in diffs]


# ── digital edges ────────────────────────────────────────────────────────────


def test_first_observation_emits_no_edge():
    diffs, state = compute_diffs([_r("PE-101", "false", 1)], DiffConfig(), tenant_id=TENANT)
    assert diffs == []
    assert state["PE-101"].last_value == "false"


def test_rising_then_falling_edge():
    readings = [
        _r("PE-101", "false", 1, eid="e1"),
        _r("PE-101", "true", 2, eid="e2"),
        _r("PE-101", "false", 3, eid="e3"),
    ]
    diffs, _ = compute_diffs(readings, DiffConfig(), tenant_id=TENANT)
    assert _types(diffs) == [RISING_EDGE, FALLING_EDGE]
    # Edge carries the anchor event ids (from → to).
    assert diffs[0].from_event_id == "e1" and diffs[0].to_event_id == "e2"


def test_repeated_value_emits_no_edge():
    readings = [_r("PE-101", "true", 1), _r("PE-101", "true", 2), _r("PE-101", "true", 3)]
    diffs, _ = compute_diffs(readings, DiffConfig(), tenant_id=TENANT)
    assert diffs == []


def test_int_tag_marked_digital_by_config():
    cfg = DiffConfig(digital_tags={"Motor_Running"})
    readings = [_r("Motor_Running", 0, 1, vt="int"), _r("Motor_Running", 1, 2, vt="int")]
    diffs, _ = compute_diffs(readings, cfg, tenant_id=TENANT)
    assert _types(diffs) == [RISING_EDGE]


# ── analog thresholds ────────────────────────────────────────────────────────


def test_analog_threshold_cross_high_then_low():
    cfg = DiffConfig(analog_thresholds={"Motor_Current_A": {"overcurrent": 10.0}})
    readings = [
        _r("Motor_Current_A", 8.0, 1, vt="float"),   # baseline (below)
        _r("Motor_Current_A", 11.0, 2, vt="float"),  # cross high
        _r("Motor_Current_A", 12.0, 3, vt="float"),  # still above — no repeat
        _r("Motor_Current_A", 9.0, 4, vt="float"),   # cross low
    ]
    diffs, _ = compute_diffs(readings, cfg, tenant_id=TENANT)
    assert _types(diffs) == [THRESHOLD_CROSS_HIGH, THRESHOLD_CROSS_LOW]
    assert diffs[0].threshold == 10.0


def test_analog_no_threshold_config_emits_value_changed():
    readings = [_r("VFD_Hz", 60.0, 1, vt="float"), _r("VFD_Hz", 45.0, 2, vt="float")]
    diffs, _ = compute_diffs(readings, DiffConfig(), tenant_id=TENANT)
    assert _types(diffs) == [VALUE_CHANGED]


# ── quality ──────────────────────────────────────────────────────────────────


def test_quality_degraded_and_recovered():
    readings = [
        _r("PE-101", "true", 1, quality="good"),
        _r("PE-101", "true", 2, quality="bad"),
        _r("PE-101", "true", 3, quality="good"),
    ]
    diffs, _ = compute_diffs(readings, DiffConfig(), tenant_id=TENANT)
    assert _types(diffs) == [QUALITY_DEGRADED, QUALITY_RECOVERED]


def test_bad_quality_reading_does_not_spawn_value_edge():
    # A dropout (good→bad) must not also read as a falling edge from the
    # untrustworthy value.
    readings = [
        _r("PE-101", "true", 1, quality="good"),
        _r("PE-101", "false", 2, quality="bad"),
    ]
    diffs, _ = compute_diffs(readings, DiffConfig(), tenant_id=TENANT)
    assert _types(diffs) == [QUALITY_DEGRADED]


# ── value_changed catch-all ──────────────────────────────────────────────────


def test_string_value_changed():
    readings = [
        _r("State", "RUN", 1, vt="string"),
        _r("State", "FAULT", 2, vt="string"),
    ]
    diffs, _ = compute_diffs(readings, DiffConfig(), tenant_id=TENANT)
    assert _types(diffs) == [VALUE_CHANGED]
    assert diffs[0].prev_value == "RUN" and diffs[0].new_value == "FAULT"


# ── fault windows ────────────────────────────────────────────────────────────


def test_fault_window_groups_nearby_diffs():
    cfg = DiffConfig(fault_trigger_tags={"Fault_Alarm"}, fault_window_seconds=5.0)
    readings = [
        _r("Motor_Current_A", 8.0, 0.0, vt="float"),
        _r("Motor_Current_A", 9.0, 2.0, vt="float"),   # value_changed @2s (in window)
        _r("Fault_Alarm", "false", 1.0),
        _r("Fault_Alarm", "true", 3.0),                 # fault trigger @3s
        _r("Motor_Running", "true", 100.0),             # baseline far away
        _r("Motor_Running", "false", 101.0),            # falling edge @101s (out of window)
    ]
    diffs, _ = compute_diffs(readings, cfg, tenant_id=TENANT)
    by_type = {(d.tag_path, d.diff_type): d for d in diffs}
    fault = by_type[("Fault_Alarm", RISING_EDGE)]
    near = by_type[("Motor_Current_A", VALUE_CHANGED)]
    far = by_type[("Motor_Running", FALLING_EDGE)]
    assert fault.fault_window_id is not None
    assert near.fault_window_id == fault.fault_window_id  # within ±5s
    assert far.fault_window_id is None                    # 101s ≫ window


# ── provenance ───────────────────────────────────────────────────────────────


def test_simulated_carried_through():
    readings = [_r("PE-101", "false", 1, simulated=True), _r("PE-101", "true", 2, simulated=True)]
    diffs, _ = compute_diffs(readings, DiffConfig(), tenant_id=TENANT)
    assert diffs and all(d.simulated for d in diffs)


def test_real_provenance_not_flipped():
    readings = [_r("PE-101", "false", 1, simulated=False), _r("PE-101", "true", 2, simulated=False)]
    diffs, _ = compute_diffs(readings, DiffConfig(), tenant_id=TENANT)
    assert diffs and not any(d.simulated for d in diffs)


# ── incremental carry-forward via the logger + in-memory store ───────────────


class InMemoryDiffStore:
    def __init__(self):
        self.state: dict[str, "object"] = {}
        self.diffs: list[TagDiff] = []

    def load_state(self, tenant_id, tag_paths):
        return {t: self.state[t] for t in tag_paths if t in self.state}

    def persist_diffs(self, diffs):
        self.diffs.extend(diffs)
        return len(diffs)


def test_logger_no_cross_batch_edge_without_state():
    # Batch 1 ends "true"; batch 2 starts "false". Without carry-forward the
    # logger would miss the falling edge. With the store returning state it
    # detects it. We simulate carry-forward by seeding the store from batch 1.
    store = InMemoryDiffStore()
    logger = TagDiffLogger(store)

    b1 = [_r("PE-101", "false", 1), _r("PE-101", "true", 2)]
    out1 = logger.process_batch(b1, DiffConfig(), tenant_id=TENANT)
    assert _types(out1) == [RISING_EDGE]

    # Seed carry-forward state (prod NeonDiffStore reads this from tag_events).
    _, state = compute_diffs(b1, DiffConfig(), tenant_id=TENANT)
    store.state.update(state)

    b2 = [_r("PE-101", "false", 3)]
    out2 = logger.process_batch(b2, DiffConfig(), tenant_id=TENANT)
    assert _types(out2) == [FALLING_EDGE]


def test_logger_requires_tenant():
    store = InMemoryDiffStore()
    logger = TagDiffLogger(store)
    try:
        logger.process_batch([_r("PE-101", "true", 1)], DiffConfig(), tenant_id="")
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "tenant" in str(exc)
