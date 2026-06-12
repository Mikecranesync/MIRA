"""
Trend historian (Track A — bench bootstrap) — the bench data plane for live trending.

Owns the PLC's single Modbus TCP connection, polls every mapped tag (reusing live_logger's
per-register, device_id, sparse-map-tolerant poll), writes time-series to a SQLite WAL ring
buffer (trend_db), keeps in-memory derived trend summaries (trend_accumulator), and serves
three read-only HTTP endpoints:

    GET /chart                              -> the self-contained ISA-101 trend chart page
    GET /trend?tag=&window=&points=         -> downsampled time-series JSON for the chart
    GET /trends/summary?window=             -> per-tag derived summary (chart intel + MIRA)

Run on the PLC laptop (it is the sole Modbus poller — do NOT run live_logger.py concurrently):

    python plc/conv_simple_anomaly/trend_historian.py
    python plc/conv_simple_anomaly/trend_historian.py --host 192.168.1.100 --bind 0.0.0.0

Read-only on every axis: Modbus FC1/FC3 reads only; SQLite reads in the HTTP layer. Never
writes to the PLC. For the shipped product (Track B) this whole service is replaced by
Ignition's native Modbus driver + Tag Historian + Perspective chart.
"""
from __future__ import annotations
import argparse
import logging
import os
import threading
import time
from contextlib import asynccontextmanager

from pymodbus.client import ModbusTcpClient

import trend_db
from live_logger import poll_once  # the proven per-register sparse-map poll
from trend_accumulator import TrendAccumulator, UNITS

log = logging.getLogger("trend-historian")

PLC_HOST = os.getenv("PLC_HOST", "192.168.1.100")
PLC_PORT = int(os.getenv("PLC_PORT", "502"))
DB_PATH = os.getenv("TREND_DB_PATH", os.path.join(os.path.dirname(__file__), "trend_data.db"))
POLL_HZ = float(os.getenv("TREND_POLL_HZ", "2.0"))
SUMMARY_WINDOW_S = float(os.getenv("TREND_SUMMARY_WINDOW_S", "60.0"))
RETENTION_S = float(os.getenv("TREND_RETENTION_HOURS", "24.0")) * 3600.0
HTTP_HOST = os.getenv("TREND_HTTP_HOST", "127.0.0.1")
HTTP_PORT = int(os.getenv("TREND_HTTP_PORT", "8766"))

# Shared state between the poll thread (writer) and HTTP handlers (readers).
_acc = TrendAccumulator()
_acc_lock = threading.Lock()
_state = {"connection": "starting", "last_poll_ts": 0.0}


def _replay_into_accumulator() -> None:
    """Pre-seed the accumulator from the last summary window of SQLite so trends aren't flat
    for the first minute after a restart."""
    conn = trend_db.init_db(DB_PATH)
    now = time.time()
    for tag in trend_db.distinct_tags(conn):
        for row in trend_db.query_window(conn, tag, now - SUMMARY_WINDOW_S, now):
            _acc.update(tag, row["value"], row["ts"], row["quality"])
    conn.close()


def poll_loop(host: str, port: int) -> None:
    """Sole Modbus owner: poll -> accumulate -> persist. Reconnects with backoff."""
    conn = trend_db.init_db(DB_PATH)
    client = ModbusTcpClient(host, port=port, timeout=2)
    period = 1.0 / max(POLL_HZ, 0.1)
    backoff = 1.0
    last_prune = 0.0
    while True:
        t0 = time.time()
        if not client.connected and not client.connect():
            _state["connection"] = "offline"
            time.sleep(min(backoff, 10.0))
            backoff = min(backoff * 2, 10.0)
            continue
        backoff = 1.0
        row = poll_once(client)
        now = time.time()
        if row:
            _state["connection"] = "ok"
            _state["last_poll_ts"] = now
            batch = [(tag, now, float(val), "good") for tag, val in row.items()]
            with _acc_lock:
                for tag, val in row.items():
                    _acc.update(tag, float(val), now, "good")
            trend_db.insert_readings(conn, batch)
        else:
            _state["connection"] = "offline"
        if now - last_prune > 300:
            trend_db.prune_old(conn, RETENTION_S, now)
            last_prune = now
        dt = period - (time.time() - t0)
        if dt > 0:
            time.sleep(dt)


# ── HTTP app ─────────────────────────────────────────────────────────────────
def build_app():
    from fastapi import FastAPI, Query
    from fastapi.responses import HTMLResponse, JSONResponse
    import trend_chart_page

    app = FastAPI(title="MIRA Trend Historian", docs_url=None, redoc_url=None)

    @app.get("/health")
    def health():
        return {"status": "ok", "connection": _state["connection"],
                "last_poll_ts": _state["last_poll_ts"], "poll_hz": POLL_HZ}

    @app.get("/chart", response_class=HTMLResponse)
    def chart(asset: str = "conveyor_demo"):
        return trend_chart_page.render(asset)

    @app.get("/trends/summary")
    def trends_summary(window: float = Query(SUMMARY_WINDOW_S, ge=5, le=600)):
        now = time.time()
        with _acc_lock:
            sums = _acc.summarize_all(now, window)
        return {"ts": now, "window_s": window, "connection": _state["connection"],
                "summaries": {t: s.to_dict() for t, s in sums.items()}}

    @app.get("/trend")
    def trend(tag: str, window: float = Query(300, ge=5, le=3600),
              points: int = Query(400, ge=10, le=2000)):
        now = time.time()
        conn = trend_db.init_db(DB_PATH)  # WAL allows a concurrent reader; cheap to open
        try:
            rows = trend_db.query_window(conn, tag, now - window, now, limit=5000)
        finally:
            conn.close()
        rows = trend_db.downsample_lttb(rows, points)
        return JSONResponse({
            "tag": tag, "unit": UNITS.get(tag, ""), "window_s": window,
            "n": len(rows), "points": rows, "status": _state["connection"],
        })

    return app


def main():
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser(description="MIRA bench trend historian (read-only).")
    ap.add_argument("--host", default=PLC_HOST, help="PLC Modbus host")
    ap.add_argument("--port", type=int, default=PLC_PORT)
    ap.add_argument("--bind", default=HTTP_HOST, help="HTTP bind addr (0.0.0.0 for remote clients)")
    ap.add_argument("--http-port", type=int, default=HTTP_PORT)
    args = ap.parse_args()

    _replay_into_accumulator()
    threading.Thread(target=poll_loop, args=(args.host, args.port), daemon=True).start()

    import uvicorn
    log.info("trend historian: PLC %s:%d  ->  http://%s:%d/chart",
             args.host, args.port, args.bind, args.http_port)
    uvicorn.run(build_app(), host=args.bind, port=args.http_port, log_level="warning")


if __name__ == "__main__":
    main()
