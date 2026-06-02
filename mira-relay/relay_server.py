from __future__ import annotations

import asyncio
import json
import logging
import os
import sqlite3
import uuid
from datetime import datetime, timezone

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket

logger = logging.getLogger("mira-relay")

DB_PATH = os.getenv("MIRA_DB_PATH", "/mira-db/mira.db")
RELAY_API_KEY = os.getenv("RELAY_API_KEY", "")

# ---------------------------------------------------------------------------
# Phase 5 / §D4 — Tag diff & event stream (gated behind RELAY_TAG_EVENTS=1).
#
# When RELAY_TAG_EVENTS is NOT set (default), the diff logger and Neon writer
# are never imported — the bench bridge is completely unaffected.
# ---------------------------------------------------------------------------
RELAY_TAG_EVENTS: bool = os.getenv("RELAY_TAG_EVENTS", "0").strip() == "1"

# Module-level singletons; only initialised when RELAY_TAG_EVENTS=1.
_diff_logger = None
if RELAY_TAG_EVENTS:
    try:
        from diff_logger import DiffLogger
        _diff_logger = DiffLogger()
        logger.info("Phase 5 tag-event stream ENABLED (RELAY_TAG_EVENTS=1)")
    except Exception as _exc:
        logger.warning("Failed to initialise DiffLogger — tag events disabled: %s", _exc)

TAG_COLUMN_MAP = {
    "speed_rpm": "speed_rpm",
    "speedRPM": "speed_rpm",
    "outputFrequency": "speed_rpm",
    "temperature_c": "temperature_c",
    "temperatureC": "temperature_c",
    "heatsinkTemp": "temperature_c",
    "current_amps": "current_amps",
    "currentAmps": "current_amps",
    "motorCurrent": "current_amps",
    "outputCurrent": "current_amps",
    "pressure_psi": "pressure_psi",
    "pressurePSI": "pressure_psi",
}

FAULT_TAG_NAMES = {"faultCode", "fault_code", "errorCode", "alarmCode"}


def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_tables(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS equipment_status (
            equipment_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'unknown',
            last_updated TEXT NOT NULL DEFAULT (datetime('now')),
            speed_rpm REAL,
            temperature_c REAL,
            current_amps REAL,
            pressure_psi REAL,
            metadata TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS faults (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            equipment_id TEXT NOT NULL,
            fault_code TEXT NOT NULL,
            description TEXT,
            severity TEXT NOT NULL DEFAULT 'warning',
            timestamp TEXT NOT NULL DEFAULT (datetime('now')),
            resolved INTEGER NOT NULL DEFAULT 0,
            resolved_at TEXT,
            FOREIGN KEY (equipment_id) REFERENCES equipment_status(equipment_id)
        )
    """)
    conn.commit()


def process_tag_payload(payload: dict) -> int:
    """Process a tag payload and upsert into equipment_status. Returns rows upserted."""
    equipment = payload.get("equipment", {})
    if not equipment:
        return 0

    db = _get_db()
    try:
        _ensure_tables(db)
        count = 0
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

        for eq_id, tags in equipment.items():
            columns: dict[str, float | None] = {
                "speed_rpm": None,
                "temperature_c": None,
                "current_amps": None,
                "pressure_psi": None,
            }
            fault_codes: list[str] = []

            for tag_name, tag_data in tags.items():
                value = tag_data.get("v") if isinstance(tag_data, dict) else tag_data

                col = TAG_COLUMN_MAP.get(tag_name)
                if col and isinstance(value, (int, float)):
                    columns[col] = value

                if tag_name in FAULT_TAG_NAMES and value and value != 0:
                    fault_codes.append(str(value))

            status = "faulted" if fault_codes else "running"
            metadata_json = json.dumps(tags)

            db.execute(
                """
                INSERT INTO equipment_status
                    (equipment_id, name, status, last_updated,
                     speed_rpm, temperature_c, current_amps, pressure_psi, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(equipment_id) DO UPDATE SET
                    status = excluded.status,
                    last_updated = excluded.last_updated,
                    speed_rpm = COALESCE(excluded.speed_rpm, equipment_status.speed_rpm),
                    temperature_c = COALESCE(excluded.temperature_c, equipment_status.temperature_c),
                    current_amps = COALESCE(excluded.current_amps, equipment_status.current_amps),
                    pressure_psi = COALESCE(excluded.pressure_psi, equipment_status.pressure_psi),
                    metadata = excluded.metadata
                """,
                (
                    eq_id, eq_id, status, now,
                    columns["speed_rpm"], columns["temperature_c"],
                    columns["current_amps"], columns["pressure_psi"],
                    metadata_json,
                ),
            )

            for fc in fault_codes:
                existing = db.execute(
                    "SELECT id FROM faults WHERE equipment_id = ? AND fault_code = ? AND resolved = 0",
                    (eq_id, fc),
                ).fetchone()
                if not existing:
                    db.execute(
                        "INSERT INTO faults (equipment_id, fault_code, severity, timestamp) "
                        "VALUES (?, ?, 'warning', ?)",
                        (eq_id, fc, now),
                    )

            count += 1

        db.commit()
        return count
    finally:
        db.close()


def _emit_tag_events(payload: dict, relay_batch_id: uuid.UUID) -> None:
    """Detect diffs and write to NeonDB tag_events (Phase 5).

    Called after the SQLite upsert. Fail-soft — any exception is caught and
    logged so the relay response is never blocked by Neon unavailability.

    tag_id convention: "{equipment_id}.{tag_name}" composite key so that it
    matches how approved_tags.tag_id should be populated (e.g., "CONV-001.motor_running").
    This allows per-equipment-per-tag allowlist and threshold entries.
    """
    try:
        import neon as _neon

        tenant_id = payload.get("tenant_id", "")
        equipment = payload.get("equipment", {})

        # Build a flat tag dict keyed "eq_id.tag_name" for the diff logger.
        flat_tags: dict = {}
        for eq_id, tags in equipment.items():
            for tag_name, tag_data in tags.items():
                composite_id = f"{eq_id}.{tag_name}"
                flat_tags[composite_id] = tag_data

        if not flat_tags:
            return

        # Load approved_tags from NeonDB (fail-soft — returns {} if unavailable).
        # Empty approved = pass-all (bench mode / table not yet populated).
        approved = _neon.load_approved_tags(tenant_id) if tenant_id else {}

        rows = _diff_logger.process_batch(
            tenant_id=tenant_id,
            approved=approved,
            tags=flat_tags,
            relay_batch_id=relay_batch_id,
        )

        if rows:
            inserted = _neon.insert_tag_events(rows)
            logger.debug(
                "tag_events: batch=%s tenant=%s events=%d inserted=%d",
                str(relay_batch_id)[:8], tenant_id, len(rows), inserted,
            )
    except Exception as exc:
        logger.warning("_emit_tag_events failed (batch=%s): %s", str(relay_batch_id)[:8], exc)


def _check_auth(request: Request) -> bool:
    if not RELAY_API_KEY:
        return True
    auth = request.headers.get("Authorization", "")
    return auth == f"Bearer {RELAY_API_KEY}"


async def health(request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok", "service": "mira-relay"})


async def ingest(request: Request) -> JSONResponse:
    if not _check_auth(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    try:
        payload = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid json"}, status_code=400)

    msg_type = payload.get("type")
    if msg_type != "tags":
        return JSONResponse({"error": f"unsupported type: {msg_type}"}, status_code=400)

    # 1. SQLite upsert — keeps equipment_status as latest-value cache.
    count = process_tag_payload(payload)
    logger.info("Ingested %d equipment rows from %s", count, payload.get("agent_id", "unknown"))

    # 2. Phase 5 diff stream (env-gated; fail-soft; never blocks the 200 OK).
    if RELAY_TAG_EVENTS and _diff_logger is not None:
        relay_batch_id = uuid.uuid4()
        _emit_tag_events(payload, relay_batch_id)

    return JSONResponse({"status": "ok", "equipment_count": count})


async def ws_relay(websocket: WebSocket) -> None:
    await websocket.accept()

    if RELAY_API_KEY:
        try:
            auth_msg = await asyncio.wait_for(websocket.receive_json(), timeout=10)
            if auth_msg.get("type") != "auth" or auth_msg.get("token") != RELAY_API_KEY:
                await websocket.send_json({"error": "unauthorized"})
                await websocket.close(code=4001)
                return
            await websocket.send_json({"type": "auth_ok"})
        except Exception:
            await websocket.close(code=4001)
            return

    logger.info("WebSocket client connected")
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            if msg_type == "tags":
                count = process_tag_payload(data)
                await websocket.send_json({"type": "ack", "equipment_count": count})
            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})
            else:
                await websocket.send_json({"error": f"unknown type: {msg_type}"})
    except Exception:
        logger.info("WebSocket client disconnected")


routes = [
    Route("/health", health, methods=["GET"]),
    Route("/ingest", ingest, methods=["POST"]),
    WebSocketRoute("/ws", ws_relay),
]

app = Starlette(routes=routes)

if __name__ == "__main__":
    import uvicorn

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    port = int(os.getenv("RELAY_PORT", "8765"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
