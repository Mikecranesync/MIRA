"""
Trend data layer — a SQLite WAL ring-buffer time-series store for the Conv_Simple bench.

The trend historian (trend_historian.py) writes every poll here; the HTTP /trend endpoint
reads windows back for the chart. Pure data layer: no Modbus, no HTTP, stdlib only — so it's
fully unit-testable offline (test_trend_db.py).

Schema (one table):
    tag_readings(id, tag TEXT, ts_utc REAL, value REAL NULL, quality TEXT)
    index (tag, ts_utc DESC)   -- the only query shape: WHERE tag=? AND ts_utc BETWEEN ?..?

WAL mode lets the HTTP reader query concurrently while the poll loop writes (single writer).
Retention is a ring buffer: prune_old() deletes rows past the window. value is NULL when
quality != 'good' (a comms miss records the gap without a misleading number).
"""
from __future__ import annotations
import sqlite3
import time

DDL = """
CREATE TABLE IF NOT EXISTS tag_readings (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    tag     TEXT NOT NULL,
    ts_utc  REAL NOT NULL,
    value   REAL,
    quality TEXT NOT NULL DEFAULT 'good'
);
CREATE INDEX IF NOT EXISTS idx_tr_tag_ts ON tag_readings(tag, ts_utc DESC);
"""


def init_db(db_path: str) -> sqlite3.Connection:
    """Open (creating if needed) the trend DB in WAL mode and ensure the schema exists."""
    conn = sqlite3.connect(db_path, timeout=5.0, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")  # WAL + NORMAL is the durable-enough/fast combo
    conn.executescript(DDL)
    conn.commit()
    return conn


def insert_readings(conn: sqlite3.Connection,
                    rows: list[tuple[str, float, float | None, str]]) -> None:
    """Append a batch of (tag, ts_utc, value, quality) rows in one transaction."""
    if not rows:
        return
    conn.executemany(
        "INSERT INTO tag_readings (tag, ts_utc, value, quality) VALUES (?, ?, ?, ?)", rows
    )
    conn.commit()


def query_window(conn: sqlite3.Connection, tag: str, start_ts: float, end_ts: float,
                 limit: int = 5000) -> list[dict]:
    """Return readings for one tag in [start_ts, end_ts], oldest first (chart order).

    limit caps the raw rows pulled before any downsampling; the newest `limit` rows in the
    window are returned (then re-sorted ascending) so a long window never loads unbounded.
    """
    cur = conn.execute(
        "SELECT ts_utc, value, quality FROM tag_readings "
        "WHERE tag = ? AND ts_utc >= ? AND ts_utc <= ? "
        "ORDER BY ts_utc DESC LIMIT ?",
        (tag, start_ts, end_ts, limit),
    )
    rows = [{"ts": r[0], "value": r[1], "quality": r[2]} for r in cur.fetchall()]
    rows.reverse()  # DESC fetch (newest-capped) -> ascending for the chart
    return rows


def downsample_lttb(rows: list[dict], n_points: int) -> list[dict]:
    """Reduce `rows` to ~n_points buckets, keeping the point FURTHEST from each bucket's mean.

    Not true LTTB, but the spike-preserving idea: equal-time buckets, one representative per
    bucket = the sample whose value deviates most from the bucket mean. This keeps excursions
    visible instead of averaging them away. Endpoints are always kept. Rows with value=None
    (bad quality) are preserved as gap markers if they're the bucket's only/extreme sample.
    """
    if n_points <= 2 or len(rows) <= n_points:
        return rows
    first, last = rows[0], rows[-1]
    inner = rows[1:-1]
    t0, t1 = first["ts"], last["ts"]
    span = (t1 - t0) or 1.0
    n_buckets = n_points - 2
    buckets: list[list[dict]] = [[] for _ in range(n_buckets)]
    for r in inner:
        idx = int((r["ts"] - t0) / span * n_buckets)
        idx = min(max(idx, 0), n_buckets - 1)
        buckets[idx].append(r)
    out = [first]
    for b in buckets:
        if not b:
            continue
        nums = [r["value"] for r in b if r["value"] is not None]
        if not nums:
            out.append(b[0])  # all-bad bucket: keep one gap marker
            continue
        mean = sum(nums) / len(nums)
        rep = max(b, key=lambda r: abs((r["value"] if r["value"] is not None else mean) - mean))
        out.append(rep)
    out.append(last)
    return out


def prune_old(conn: sqlite3.Connection, retention_s: float, now: float | None = None) -> int:
    """Delete rows older than retention_s seconds. Returns rows deleted (ring-buffer trim)."""
    cutoff = (now if now is not None else time.time()) - retention_s
    cur = conn.execute("DELETE FROM tag_readings WHERE ts_utc < ?", (cutoff,))
    conn.commit()
    return cur.rowcount


def get_latest(conn: sqlite3.Connection, tag: str) -> dict | None:
    """Most recent reading for a tag, or None if the tag has no rows."""
    cur = conn.execute(
        "SELECT ts_utc, value, quality FROM tag_readings WHERE tag = ? "
        "ORDER BY ts_utc DESC LIMIT 1",
        (tag,),
    )
    r = cur.fetchone()
    return {"ts": r[0], "value": r[1], "quality": r[2]} if r else None


def distinct_tags(conn: sqlite3.Connection) -> list[str]:
    """All tag names currently present (for the chart's signal discovery)."""
    cur = conn.execute("SELECT DISTINCT tag FROM tag_readings ORDER BY tag")
    return [r[0] for r in cur.fetchall()]
