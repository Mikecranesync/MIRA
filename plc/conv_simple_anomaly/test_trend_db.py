"""Offline unit tests for the trend SQLite data layer (no bench, no Modbus)."""
from __future__ import annotations

import trend_db


def _mem():
    # ":memory:" is fine here (single connection); WAL pragma is a no-op on memory DBs.
    return trend_db.init_db(":memory:")


def test_insert_and_query_window():
    conn = _mem()
    rows = [("dc_bus", float(t), 320.0 + t, "good") for t in range(10)]
    trend_db.insert_readings(conn, rows)
    got = trend_db.query_window(conn, "dc_bus", 2.0, 6.0)
    assert [r["ts"] for r in got] == [2.0, 3.0, 4.0, 5.0, 6.0]      # inclusive, ascending
    assert got[0]["value"] == 322.0 and got[-1]["value"] == 326.0


def test_query_window_filters_tag():
    conn = _mem()
    trend_db.insert_readings(conn, [("a", 1.0, 1.0, "good"), ("b", 1.0, 9.0, "good")])
    assert [r["value"] for r in trend_db.query_window(conn, "a", 0, 5)] == [1.0]


def test_query_window_limit_keeps_newest():
    conn = _mem()
    trend_db.insert_readings(conn, [("t", float(i), float(i), "good") for i in range(100)])
    got = trend_db.query_window(conn, "t", 0, 99, limit=10)
    assert len(got) == 10
    assert [r["ts"] for r in got] == [float(i) for i in range(90, 100)]  # newest 10, ascending


def test_downsample_halves_and_keeps_endpoints_and_spike():
    rows = [{"ts": float(i), "value": 10.0, "quality": "good"} for i in range(100)]
    rows[50]["value"] = 999.0  # a spike that must survive downsampling
    out = trend_db.downsample_lttb(rows, 20)
    assert len(out) <= 20
    assert out[0]["ts"] == 0.0 and out[-1]["ts"] == 99.0           # endpoints kept
    assert any(r["value"] == 999.0 for r in out)                   # spike preserved


def test_downsample_noop_when_small():
    rows = [{"ts": float(i), "value": float(i), "quality": "good"} for i in range(5)]
    assert trend_db.downsample_lttb(rows, 50) == rows


def test_downsample_all_bad_bucket_keeps_gap_marker():
    rows = [{"ts": float(i), "value": (None if 40 <= i < 60 else 1.0), "quality": "good"}
            for i in range(100)]
    out = trend_db.downsample_lttb(rows, 10)
    assert any(r["value"] is None for r in out)                    # gap survives


def test_prune_old_trims_ring():
    conn = _mem()
    trend_db.insert_readings(conn, [("t", float(i), float(i), "good") for i in range(100)])
    deleted = trend_db.prune_old(conn, retention_s=10.0, now=100.0)  # keep ts >= 90
    assert deleted == 90
    remaining = trend_db.query_window(conn, "t", 0, 1000)
    assert len(remaining) == 10 and remaining[0]["ts"] == 90.0


def test_get_latest_and_distinct_tags():
    conn = _mem()
    trend_db.insert_readings(conn, [("a", 1.0, 1.0, "good"), ("a", 2.0, 2.0, "good"),
                                    ("b", 1.0, 5.0, "stale")])
    assert trend_db.get_latest(conn, "a") == {"ts": 2.0, "value": 2.0, "quality": "good"}
    assert trend_db.get_latest(conn, "missing") is None
    assert trend_db.distinct_tags(conn) == ["a", "b"]
