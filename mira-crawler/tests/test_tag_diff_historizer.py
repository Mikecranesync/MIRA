"""Tests for the tag-diff historizer Celery task (issue #2343).

The task is split into a pure core (`run_historize_batch`) over an injected
store + event reader, mirroring the relay's logic/store boundary. These tests
exercise the core with an in-memory store and a fake reader, so the scheduling
wiring is verified without a live NeonDB or Redis broker.

`tag_diff_logger` resolves because mira-crawler/conftest.py puts mira-relay/ on
sys.path (the same dir the relay's own tests import it from).
"""

from __future__ import annotations

from tag_diff_logger import (
    FALLING_EDGE,
    RISING_EDGE,
    DiffConfig,
    TagDiff,
    TagReading,
)

from tasks.tag_diff_historizer import run_historize_batch

TENANT = "t-hist-1"


# In-memory store mirroring the InMemoryDiffStore shape from the relay tests.
class InMemoryDiffStore:
    def __init__(self):
        self.state: dict = {}
        self.diffs: list[TagDiff] = []

    def load_state(self, tenant_id, tag_paths):
        return {t: self.state[t] for t in tag_paths if t in self.state}

    def persist_diffs(self, diffs):
        self.diffs.extend(diffs)
        return len(diffs)


def _r(tag, value, ts, *, vt="bool", quality="good", eid=None):
    return TagReading(
        tag_path=tag,
        value=str(value) if value is not None else None,
        value_type=vt,
        quality=quality,
        event_timestamp=float(ts),
        event_id=eid,
        source_system="plc_bridge",
    )


def test_happy_path_writes_diffs_and_returns_summary():
    readings = [
        _r("PE-101", "false", 1, eid="e1"),
        _r("PE-101", "true", 2, eid="e2"),
        _r("PE-101", "false", 3, eid="e3"),
    ]
    captured = {}

    def fake_reader(tenant_id, since_ts, batch_size):
        captured["args"] = (tenant_id, since_ts, batch_size)
        return readings

    store = InMemoryDiffStore()
    summary = run_historize_batch(
        store=store,
        read_events=fake_reader,
        config=DiffConfig(),
        tenant_id=TENANT,
        batch_size=500,
    )

    assert summary["status"] == "ok"
    assert summary["tenant_id"] == TENANT
    assert summary["tag_events_read"] == 3
    assert summary["diffs_written"] == 2  # rising + falling
    assert summary["last_processed_ts"] == 3.0
    # Diffs were persisted via the injected store.
    assert [d.diff_type for d in store.diffs] == [RISING_EDGE, FALLING_EDGE]
    # The core asks the reader for the implicit cursor (since_ts=None) + batch_size.
    assert captured["args"] == (TENANT, None, 500)


def test_empty_batch_is_ok_with_zero_diffs():
    store = InMemoryDiffStore()
    summary = run_historize_batch(
        store=store,
        read_events=lambda *a: [],
        config=DiffConfig(),
        tenant_id=TENANT,
        batch_size=100,
    )
    assert summary["status"] == "ok"
    assert summary["tag_events_read"] == 0
    assert summary["diffs_written"] == 0
    assert summary["last_processed_ts"] is None
    assert store.diffs == []


def test_cursor_advances_to_max_event_timestamp_of_batch():
    readings = [
        _r("A", "true", 10.0, eid="a1"),
        _r("A", "false", 42.5, eid="a2"),   # falling edge
        _r("B", "RUN", 5.0, vt="string", eid="b1"),
    ]
    store = InMemoryDiffStore()
    summary = run_historize_batch(
        store=store,
        read_events=lambda *a: readings,
        config=DiffConfig(),
        tenant_id=TENANT,
        batch_size=100,
    )
    assert summary["last_processed_ts"] == 42.5
    assert summary["tag_events_read"] == 3


def test_missing_tenant_returns_error_status():
    store = InMemoryDiffStore()
    summary = run_historize_batch(
        store=store,
        read_events=lambda *a: [],
        config=DiffConfig(),
        tenant_id="",
        batch_size=100,
    )
    assert summary["status"] == "error"
    assert summary["diffs_written"] == 0
