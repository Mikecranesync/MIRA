"""Pure, in-memory tests for the Historian adapter (issue #2339).

These exercise the adapter CONTRACT against the reference InMemoryHistorianAdapter
— no DB, no Redis. The Postgres adapter mirrors this same logic in SQL (untested
here without a live NeonDB, by design — see issue notes).

Behaviours under test:
  - list_tags returns the latest live value per tag (live_signal_cache shape)
  - get_history range-filters tag_events by [start, end] for one tag
  - get_history buckets via date_trunc when an interval is given
  - get_trends buckets per date_trunc(interval) across tag_paths and guards the
    numeric cast: non-numeric values yield null min/max/avg but still count+latest
  - get_evidence joins tag_event_diffs (by fault_window_id) with related
    decision_traces (by time overlap)
  - list_runs is deferred → NotImplementedError (#2341)
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from historian import (
    EvidenceWindow,
    HistorianAdapter,
    HistoryPoint,
    InMemoryHistorianAdapter,
    Run,
    Sample,
    TagMeta,
    TimeAggregation,
    TrendBucket,
)

T = "t-1"
OTHER = "t-2"


def _dt(minute: int, second: int = 0) -> datetime:
    return datetime(2026, 6, 1, 12, minute, second, tzinfo=timezone.utc)


@pytest.fixture
def adapter() -> InMemoryHistorianAdapter:
    return InMemoryHistorianAdapter()


# ── DTOs ──────────────────────────────────────────────────────────────────────


def test_dtos_are_json_serializable():
    s = Sample(tag_path="a", value="1", last_seen_at=_dt(0))
    d = s.to_dict()
    assert d["tag_path"] == "a"
    assert d["value"] == "1"
    # ISO8601 timestamp
    assert d["last_seen_at"].startswith("2026-06-01T12:00:00")
    assert isinstance(TagMeta(tag_path="a").to_dict(), dict)
    assert isinstance(HistoryPoint(tag_path="a", timestamp=_dt(0), value="1").to_dict(), dict)
    assert isinstance(
        TrendBucket(tag_path="a", bucket_start=_dt(0), count=1, min=1.0, max=1.0, avg=1.0, latest="1").to_dict(),
        dict,
    )
    assert isinstance(EvidenceWindow(fault_window_id="fw", diffs=[], traces=[]).to_dict(), dict)
    assert isinstance(Run(run_id="r1").to_dict(), dict)


def test_inmemory_is_a_historian_adapter(adapter):
    assert isinstance(adapter, HistorianAdapter)


# ── TimeAggregation ─────────────────────────────────────────────────────────


def test_time_aggregation_parse_and_truncate():
    assert TimeAggregation.parse(None) is None
    assert TimeAggregation.parse("") is None
    assert TimeAggregation.parse("minute") is TimeAggregation.MINUTE
    assert TimeAggregation.parse("HOUR") is TimeAggregation.HOUR
    with pytest.raises(ValueError):
        TimeAggregation.parse("fortnight")
    # truncation
    assert TimeAggregation.MINUTE.truncate(_dt(5, 37)) == _dt(5, 0)
    assert TimeAggregation.HOUR.truncate(_dt(5, 37)) == datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc)


# ── list_tags (live) ─────────────────────────────────────────────────────────


def test_list_tags_returns_latest_live_values(adapter):
    adapter.add_live(T, Sample(tag_path="rpm", value="1500", numeric=1500.0, last_seen_at=_dt(1)))
    adapter.add_live(T, Sample(tag_path="state", value="RUN", last_seen_at=_dt(1)))
    adapter.add_live(OTHER, Sample(tag_path="rpm", value="999", numeric=999.0, last_seen_at=_dt(1)))

    tags = adapter.list_tags(T)
    by_path = {s.tag_path: s for s in tags}
    assert set(by_path) == {"rpm", "state"}
    assert by_path["rpm"].value == "1500"
    # tenant isolation: t-2's rpm value never leaks into t-1
    assert all(s.value != "999" for s in tags)


# ── get_history range filtering ──────────────────────────────────────────────


def test_get_history_filters_by_range_and_tag(adapter):
    for i in range(5):
        adapter.add_event(T, "rpm", str(1000 + i), "float", _dt(i))
    adapter.add_event(T, "other", "x", "string", _dt(2))

    pts = adapter.get_history(T, "rpm", start=_dt(1), end=_dt(3))
    ts = [p.timestamp for p in pts]
    assert ts == [_dt(1), _dt(2), _dt(3)]
    assert all(isinstance(p, HistoryPoint) for p in pts)
    assert all(p.tag_path == "rpm" for p in pts)


def test_get_history_open_range_returns_all_for_tag(adapter):
    for i in range(3):
        adapter.add_event(T, "rpm", str(i), "int", _dt(i))
    pts = adapter.get_history(T, "rpm")
    assert len(pts) == 3


def test_get_history_tenant_scoped(adapter):
    adapter.add_event(T, "rpm", "1", "int", _dt(0))
    adapter.add_event(OTHER, "rpm", "2", "int", _dt(0))
    pts = adapter.get_history(T, "rpm")
    assert len(pts) == 1
    assert pts[0].value == "1"


def test_get_history_buckets_when_interval_given(adapter):
    # 4 samples across two minute-buckets → 2 bucketed points
    adapter.add_event(T, "rpm", "10", "float", _dt(1, 10))
    adapter.add_event(T, "rpm", "20", "float", _dt(1, 50))
    adapter.add_event(T, "rpm", "30", "float", _dt(2, 5))
    adapter.add_event(T, "rpm", "40", "float", _dt(2, 40))

    raw = adapter.get_history(T, "rpm")
    assert len(raw) == 4

    bucketed = adapter.get_history(T, "rpm", interval="minute")
    assert len(bucketed) == 2
    assert [p.timestamp for p in bucketed] == [_dt(1, 0), _dt(2, 0)]
    assert all(p.bucketed for p in bucketed)


# ── get_trends bucketing + numeric guard ─────────────────────────────────────


def test_get_trends_numeric_aggregation(adapter):
    adapter.add_event(T, "rpm", "10", "float", _dt(1, 10))
    adapter.add_event(T, "rpm", "20", "float", _dt(1, 40))
    adapter.add_event(T, "rpm", "30", "float", _dt(2, 5))

    buckets = adapter.get_trends(T, ["rpm"], interval="minute")
    by_start = {b.bucket_start: b for b in buckets}
    b1 = by_start[_dt(1, 0)]
    assert b1.count == 2
    assert b1.min == 10.0
    assert b1.max == 20.0
    assert b1.avg == 15.0
    assert b1.latest == "20"
    b2 = by_start[_dt(2, 0)]
    assert b2.count == 1
    assert b2.avg == 30.0


def test_get_trends_non_numeric_tag_yields_null_aggregates(adapter):
    adapter.add_event(T, "state", "RUN", "string", _dt(1, 10))
    adapter.add_event(T, "state", "STOP", "string", _dt(1, 40))

    buckets = adapter.get_trends(T, ["state"], interval="minute")
    assert len(buckets) == 1
    b = buckets[0]
    assert b.count == 2
    assert b.min is None
    assert b.max is None
    assert b.avg is None
    assert b.latest == "STOP"  # still returns count + latest


def test_get_trends_mixed_numeric_and_string_batch(adapter):
    # A tag whose bucket holds both numeric and non-numeric values: aggregates
    # are computed over the numeric subset only; count covers all rows.
    adapter.add_event(T, "mix", "10", "float", _dt(1, 5))
    adapter.add_event(T, "mix", "20", "float", _dt(1, 15))
    adapter.add_event(T, "mix", "oops", "string", _dt(1, 50))

    buckets = adapter.get_trends(T, ["mix"], interval="minute")
    assert len(buckets) == 1
    b = buckets[0]
    assert b.count == 3
    assert b.min == 10.0
    assert b.max == 20.0
    assert b.avg == 15.0
    assert b.latest == "oops"


def test_get_trends_multi_tag(adapter):
    adapter.add_event(T, "a", "1", "int", _dt(1, 1))
    adapter.add_event(T, "b", "2", "int", _dt(1, 1))
    buckets = adapter.get_trends(T, ["a", "b"], interval="minute")
    assert {b.tag_path for b in buckets} == {"a", "b"}


def test_get_trends_tenant_scoped(adapter):
    adapter.add_event(T, "a", "1", "int", _dt(1, 1))
    adapter.add_event(OTHER, "a", "999", "int", _dt(1, 1))
    buckets = adapter.get_trends(T, ["a"], interval="minute")
    assert len(buckets) == 1
    assert buckets[0].count == 1
    assert buckets[0].latest == "1"


# ── get_evidence (diffs + traces) ────────────────────────────────────────────


def test_get_evidence_joins_diffs_and_traces(adapter):
    fw = "fault-window-1"
    adapter.add_diff(T, fw, tag_path="estop", diff_type="rising_edge",
                     prev_value="0", new_value="1", event_timestamp=_dt(10, 0))
    adapter.add_diff(T, fw, tag_path="motor", diff_type="falling_edge",
                     prev_value="1", new_value="0", event_timestamp=_dt(10, 3))
    # unrelated diff in a different window — must NOT appear
    adapter.add_diff(T, "other-window", tag_path="x", diff_type="value_changed",
                     prev_value="a", new_value="b", event_timestamp=_dt(20, 0))
    # a trace inside the window's time span → related
    adapter.add_trace(T, ts=_dt(10, 2), user_question="why stop?",
                      recommendation="check estop", outcome="resolved")
    # a trace far outside the window → not related
    adapter.add_trace(T, ts=_dt(40, 0), user_question="unrelated", recommendation="n/a")

    ev = adapter.get_evidence(T, fw)
    assert isinstance(ev, EvidenceWindow)
    assert ev.fault_window_id == fw
    assert len(ev.diffs) == 2
    assert {d["tag_path"] for d in ev.diffs} == {"estop", "motor"}
    assert len(ev.traces) == 1
    assert ev.traces[0]["user_question"] == "why stop?"


def test_get_evidence_empty_when_unknown_window(adapter):
    ev = adapter.get_evidence(T, "nope")
    assert ev.diffs == []
    assert ev.traces == []


def test_get_evidence_tenant_scoped(adapter):
    fw = "shared-fw"
    adapter.add_diff(T, fw, tag_path="a", diff_type="rising_edge",
                     prev_value="0", new_value="1", event_timestamp=_dt(1, 0))
    adapter.add_diff(OTHER, fw, tag_path="a", diff_type="rising_edge",
                     prev_value="0", new_value="1", event_timestamp=_dt(1, 0))
    ev = adapter.get_evidence(T, fw)
    assert len(ev.diffs) == 1


# ── list_runs deferred ───────────────────────────────────────────────────────


def test_list_runs_not_implemented(adapter):
    with pytest.raises(NotImplementedError):
        adapter.list_runs(T, "run-1")
