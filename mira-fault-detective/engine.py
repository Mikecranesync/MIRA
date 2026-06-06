"""MIRA Fault Detective — MQTT-driven rule engine.

Subscribes to every UNS topic under $UNS_PREFIX/#, maintains a rolling
state snapshot, evaluates the rules in rules.py every TICK_MS, and:

  - publishes the current diagnosis (or "ok") to
    {prefix}/diagnostics/current_fault
  - writes a row to conveyor_events whenever the fault changes.

Designed to share the mira-bridge SQLite WAL — mira-bridge owns the write
lock, so we use short transactions with retries.
"""
from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
import os
import sqlite3
import time
from typing import Optional

import aiomqtt
import rules

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s %(levelname)s engine: %(message)s")
log = logging.getLogger("fault-detective")

MQTT_HOST = os.getenv("MQTT_HOST", "mosquitto")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
UNS_PREFIX = os.getenv("UNS_PREFIX", "demo/cell1/conveyor/cv101").rstrip("/")
DB_PATH = os.getenv("DB_PATH", "/mira-db/mira.db")
TICK_MS = int(os.getenv("TICK_MS", "200"))

# Read-only HTTP API exposing the latest diagnosis (off by default so the running
# service is unchanged until ops opts in). Consumed by the chat engine's
# _build_live_data_context. Optional bearer token for internal-network auth.
HTTP_ENABLED = os.getenv("FAULT_DETECTIVE_HTTP_ENABLED", "0") == "1"
HTTP_HOST = os.getenv("FAULT_DETECTIVE_HTTP_HOST", "0.0.0.0")
HTTP_PORT = int(os.getenv("FAULT_DETECTIVE_HTTP_PORT", "8077"))
HTTP_TOKEN = os.getenv("FAULT_DETECTIVE_HTTP_TOKEN", "")


def _open_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=5.0, isolation_level=None)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS conveyor_events (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            ts              TEXT    NOT NULL,
            fault           TEXT    NOT NULL,
            confidence      REAL    NOT NULL,
            evidence_json   TEXT    NOT NULL DEFAULT '[]',
            affected_json   TEXT    NOT NULL DEFAULT '[]',
            resolved_ts     TEXT
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_conveyor_events_ts ON conveyor_events(ts DESC)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_conveyor_events_fault ON conveyor_events(fault)"
    )
    return conn


def _record_event(conn: sqlite3.Connection, diag: rules.Diagnosis) -> None:
    evidence = [
        {"topic": e.topic, "value": e.value, "note": e.note}
        for e in diag.evidence
    ]
    ts_iso = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
    for attempt in range(5):
        try:
            conn.execute(
                "INSERT INTO conveyor_events (ts, fault, confidence, evidence_json, affected_json) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    ts_iso,
                    diag.fault,
                    diag.confidence,
                    json.dumps(evidence, default=str),
                    json.dumps(diag.affected_components),
                ),
            )
            return
        except sqlite3.OperationalError as e:
            if attempt == 4:
                log.warning("DB write failed after retries: %s", e)
                return
            time.sleep(0.2 * (attempt + 1))


def _mark_resolved(conn: sqlite3.Connection) -> None:
    ts_iso = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
    for attempt in range(5):
        try:
            conn.execute(
                "UPDATE conveyor_events SET resolved_ts = ? "
                "WHERE resolved_ts IS NULL",
                (ts_iso,),
            )
            return
        except sqlite3.OperationalError:
            if attempt == 4:
                return
            time.sleep(0.2 * (attempt + 1))


_TRUE_STRINGS = {"true", "1", "ok", "on", "running", "present"}
_FALSE_STRINGS = {"false", "0", "blown", "off", "stopped", "absent"}


def _coerce_bool(value: object) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        v = value.strip().lower()
        if v in _TRUE_STRINGS:
            return True
        if v in _FALSE_STRINGS:
            return False
    return None


class State:
    def __init__(self) -> None:
        self.snap = rules.Snapshot()
        self.pe101_dropouts_window = 0
        self.pe102_dropouts_window = 0
        self.px101_dropouts_window = 0
        self._last_pe101_dropouts = 0
        self._last_pe102_dropouts = 0
        self._last_px101_dropouts = 0
        self._pe101_window_anchor = 0
        self._pe102_window_anchor = 0
        self._px101_window_anchor = 0
        self._window_start = time.time()
        self._window_s = 1.5

    def apply(self, topic: str, payload: dict) -> None:
        rel = topic[len(UNS_PREFIX) + 1:] if topic.startswith(UNS_PREFIX + "/") else topic
        value = payload.get("value", payload)
        s = self.snap
        s.now = time.time()

        if rel == "sensors/pe101/debounced":
            was = s.pe101_blocked
            s.pe101_blocked = bool(_coerce_bool(value) or False)
            if s.pe101_blocked and not was:
                s.pe101_blocked_since = s.now
            elif not s.pe101_blocked:
                s.pe101_blocked_since = None
        elif rel == "sensors/pe102/debounced":
            was = s.pe102_blocked
            s.pe102_blocked = bool(_coerce_bool(value) or False)
            if s.pe102_blocked and not was:
                s.pe102_blocked_since = s.now
            elif not s.pe102_blocked:
                s.pe102_blocked_since = None
        elif rel == "sensors/px101/debounced":
            s.px101_present = bool(_coerce_bool(value) or False)
        elif rel == "sensors/pe101/dropout_count":
            self._last_pe101_dropouts = int(value or 0)
        elif rel == "sensors/pe102/dropout_count":
            self._last_pe102_dropouts = int(value or 0)
        elif rel == "sensors/px101/dropout_count":
            self._last_px101_dropouts = int(value or 0)
        elif rel == "power/fuse_f2/status":
            s.fuse_f2_ok = (_coerce_bool(value) is True)
        elif rel == "power/fuse_f3/status":
            s.fuse_f3_ok = (_coerce_bool(value) is True)
        elif rel == "vision/zone2/object_present":
            s.vision_object_present = bool(_coerce_bool(value) or False)
        elif rel == "vision/zone2/object_motion":
            s.vision_object_motion = bool(_coerce_bool(value) or False)
        elif rel == "vfd/vfd101/status":
            s.vfd_running = isinstance(value, str) and value.lower() == "running"
        elif rel == "vfd/vfd101/freq":
            s.vfd_running = float(value or 0) > 0.1
        elif rel == "motor/m101/running":
            s.motor_running = bool(_coerce_bool(value) or False)
        elif rel == "safety/estop":
            s.estop_active = bool(_coerce_bool(value) or False)
        elif rel == "safety/contactor_q1":
            s.contactor_q1 = bool(_coerce_bool(value) or False)
        elif rel == "sim/active_mode":
            if isinstance(value, str):
                s.sim_mode = value

    def refresh_dropout_windows(self) -> None:
        """Compute delta-per-window so chatter detection isn't fooled by the
        sim's cumulative counters (a normal product traversal ticks them too)."""
        s = self.snap
        now = time.time()
        elapsed = now - self._window_start
        if elapsed >= self._window_s:
            self.pe101_dropouts_window = max(0, self._last_pe101_dropouts - self._pe101_window_anchor)
            self.pe102_dropouts_window = max(0, self._last_pe102_dropouts - self._pe102_window_anchor)
            self.px101_dropouts_window = max(0, self._last_px101_dropouts - self._px101_window_anchor)
            self._pe101_window_anchor = self._last_pe101_dropouts
            self._pe102_window_anchor = self._last_pe102_dropouts
            self._px101_window_anchor = self._last_px101_dropouts
            self._window_start = now
        s.pe101_dropouts = self.pe101_dropouts_window
        s.pe102_dropouts = self.pe102_dropouts_window
        s.px101_dropouts = self.px101_dropouts_window


def _diagnosis_dict(diag: Optional[rules.Diagnosis]) -> dict:
    """Structured current-diagnosis payload. `None` diag == healthy/no fault."""
    if diag is None:
        return {
            "fault": "ok",
            "confidence": 1.0,
            "evidence": [],
            "affected_components": [],
            "recommended_first_check": "",
            "safety_note": "",
            "ts": time.time(),
        }
    return {
        "fault": diag.fault,
        "confidence": diag.confidence,
        "evidence": [dataclasses.asdict(e) for e in diag.evidence],
        "affected_components": diag.affected_components,
        "recommended_first_check": diag.recommended_first_check,
        "safety_note": diag.safety_note,
        "ts": time.time(),
    }


def _diagnosis_payload(diag: Optional[rules.Diagnosis]) -> str:
    return json.dumps(_diagnosis_dict(diag), default=str)


# Latest diagnosis, updated every tick. Served read-only over HTTP (when
# FAULT_DETECTIVE_HTTP_ENABLED=1) so the chat engine can pull live equipment
# status without subscribing to MQTT itself.
_LATEST_DIAGNOSIS: dict = _diagnosis_dict(None)


async def run() -> None:
    conn = _open_db()
    state = State()
    last_fault_key: Optional[str] = None
    log.info("engine starting — MQTT=%s:%d prefix=%s db=%s", MQTT_HOST, MQTT_PORT, UNS_PREFIX, DB_PATH)

    backoff = 1.0
    while True:
        try:
            async with aiomqtt.Client(MQTT_HOST, port=MQTT_PORT, identifier="mira-fault-detective") as client:
                await client.subscribe(f"{UNS_PREFIX}/#")
                log.info("subscribed to %s/#", UNS_PREFIX)
                backoff = 1.0

                async def ticker():
                    nonlocal last_fault_key
                    while True:
                        state.refresh_dropout_windows()
                        diag = rules.evaluate(state.snap)
                        payload_dict = _diagnosis_dict(diag)
                        # Refresh the HTTP-served snapshot in place (same object the
                        # web handler reads — single event loop, no lock needed).
                        _LATEST_DIAGNOSIS.clear()
                        _LATEST_DIAGNOSIS.update(payload_dict)
                        await client.publish(
                            f"{UNS_PREFIX}/diagnostics/current_fault",
                            json.dumps(payload_dict, default=str),
                            qos=0,
                            retain=True,
                        )
                        key = diag.fault if diag else "ok"
                        if key != last_fault_key:
                            if diag is not None:
                                _record_event(conn, diag)
                                log.info("FAULT %s conf=%.2f affected=%s", diag.fault, diag.confidence, diag.affected_components)
                            else:
                                _mark_resolved(conn)
                                log.info("FAULT cleared")
                            last_fault_key = key
                        await asyncio.sleep(TICK_MS / 1000.0)

                tick_task = asyncio.create_task(ticker())
                try:
                    async for msg in client.messages:
                        try:
                            payload = json.loads(msg.payload.decode("utf-8"))
                        except (json.JSONDecodeError, UnicodeDecodeError):
                            continue
                        if not isinstance(payload, dict):
                            continue
                        state.apply(str(msg.topic), payload)
                finally:
                    tick_task.cancel()
        except aiomqtt.MqttError as e:
            log.warning("MQTT down: %s — retrying in %.1fs", e, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 15.0)
        except Exception as e:
            log.exception("unexpected error: %s", e)
            await asyncio.sleep(2.0)


def _http_unauthorized(request) -> bool:
    """True when a token is configured and the request doesn't present it."""
    if not HTTP_TOKEN:
        return False
    return request.headers.get("Authorization") != f"Bearer {HTTP_TOKEN}"


async def _http_health(_request):
    from aiohttp import web

    return web.json_response({"ok": True})


async def _http_current_fault(request):
    """Serve the latest diagnosis snapshot (+ the monitored asset prefix)."""
    from aiohttp import web

    if _http_unauthorized(request):
        return web.json_response({"error": "unauthorized"}, status=401)
    return web.json_response({"asset_prefix": UNS_PREFIX, **_LATEST_DIAGNOSIS})


async def serve_http() -> None:
    """Read-only HTTP API: GET /health and GET /current_fault (latest diagnosis)."""
    from aiohttp import web

    app = web.Application()
    app.add_routes(
        [web.get("/health", _http_health), web.get("/current_fault", _http_current_fault)]
    )
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, HTTP_HOST, HTTP_PORT)
    await site.start()
    log.info("http api listening on %s:%d", HTTP_HOST, HTTP_PORT)
    while True:  # keep the task alive alongside the MQTT loop
        await asyncio.sleep(3600)


async def main() -> None:
    tasks = [run()]
    if HTTP_ENABLED:
        tasks.append(serve_http())
    await asyncio.gather(*tasks)


if __name__ == "__main__":
    asyncio.run(main())
