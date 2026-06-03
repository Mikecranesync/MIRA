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

from auth import verify_hmac

logger = logging.getLogger("mira-relay")

DB_PATH = os.getenv("MIRA_DB_PATH", "/mira-db/mira.db")
RELAY_API_KEY = os.getenv("RELAY_API_KEY", "")
# Set RELAY_LEGACY_BEARER=1 to accept the old "Authorization: Bearer <key>" path.
# Keep enabled until plc/live-plc-bridge and mira-fault-detective migrate to HMAC.
RELAY_LEGACY_BEARER = os.getenv("RELAY_LEGACY_BEARER", "0") == "1"
MIRA_IGNITION_HMAC_KEY = os.getenv("MIRA_IGNITION_HMAC_KEY", "")

# ── Phase 5 / §D4 — Tag diff & event stream (gated behind RELAY_TAG_EVENTS=1) ──
# Default OFF: the diff logger + Neon writer are never imported, so the bench
# bridge and main's HMAC ingest path are completely unaffected. When enabled,
# meaningful tag diffs are written to NeonDB tag_events after the SQLite upsert.
RELAY_TAG_EVENTS = os.getenv("RELAY_TAG_EVENTS", "0").strip() == "1"
_diff_logger = None
if RELAY_TAG_EVENTS:
    try:
        from diff_logger import DiffLogger

        _diff_logger = DiffLogger()
        logger.info("Phase 5 tag-event stream ENABLED (RELAY_TAG_EVENTS=1)")
    except Exception as _exc:  # pragma: no cover - import/init guard
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
            metadata TEXT,
            tenant_id TEXT
        )
    """)
    # Migrate: add tenant_id column if it doesn't exist yet (idempotent)
    try:
        conn.execute("ALTER TABLE equipment_status ADD COLUMN tenant_id TEXT")
    except sqlite3.OperationalError:
        pass  # Column already exists

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
            tenant_id TEXT,
            FOREIGN KEY (equipment_id) REFERENCES equipment_status(equipment_id)
        )
    """)
    # Migrate: add tenant_id column to faults if missing
    try:
        conn.execute("ALTER TABLE faults ADD COLUMN tenant_id TEXT")
    except sqlite3.OperationalError:
        pass  # Column already exists

    conn.commit()


def process_tag_payload(payload: dict, tenant_id: str | None = None) -> int:
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
                     speed_rpm, temperature_c, current_amps, pressure_psi,
                     metadata, tenant_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(equipment_id) DO UPDATE SET
                    status = excluded.status,
                    last_updated = excluded.last_updated,
                    speed_rpm = COALESCE(excluded.speed_rpm, equipment_status.speed_rpm),
                    temperature_c = COALESCE(excluded.temperature_c, equipment_status.temperature_c),
                    current_amps = COALESCE(excluded.current_amps, equipment_status.current_amps),
                    pressure_psi = COALESCE(excluded.pressure_psi, equipment_status.pressure_psi),
                    metadata = excluded.metadata,
                    tenant_id = COALESCE(excluded.tenant_id, equipment_status.tenant_id)
                """,
                (
                    eq_id, eq_id, status, now,
                    columns["speed_rpm"], columns["temperature_c"],
                    columns["current_amps"], columns["pressure_psi"],
                    metadata_json, tenant_id,
                ),
            )

            for fc in fault_codes:
                existing = db.execute(
                    "SELECT id FROM faults WHERE equipment_id = ? AND fault_code = ? AND resolved = 0",
                    (eq_id, fc),
                ).fetchone()
                if not existing:
                    db.execute(
                        "INSERT INTO faults (equipment_id, fault_code, severity, timestamp, tenant_id) "
                        "VALUES (?, ?, 'warning', ?, ?)",
                        (eq_id, fc, now, tenant_id),
                    )

            count += 1

        db.commit()
        return count
    finally:
        db.close()


def _check_bearer(request: Request) -> bool:
    """Legacy bearer-token check. Only used when RELAY_LEGACY_BEARER=1."""
    if not RELAY_API_KEY:
        return True
    auth = request.headers.get("Authorization", "")
    return auth == f"Bearer {RELAY_API_KEY}"


async def _authenticate_http(request: Request, body: bytes) -> tuple[bool, str | None, str | None]:
    """Authenticate an HTTP request.

    Returns (ok, tenant_id, error_detail).
    - ok=True, tenant_id=str → HMAC verified.
    - ok=True, tenant_id=None → legacy bearer verified (no tenant).
    - ok=False → auth failed; error_detail has the reason.
    """
    # Try HMAC first (preferred path)
    if MIRA_IGNITION_HMAC_KEY and request.headers.get("X-MIRA-Signature"):
        try:
            tenant_id = verify_hmac(dict(request.headers), body, MIRA_IGNITION_HMAC_KEY)
            return True, tenant_id, None
        except ValueError as exc:
            return False, None, str(exc)

    # Legacy bearer fallback
    if RELAY_LEGACY_BEARER:
        if _check_bearer(request):
            return True, None, None
        return False, None, "bearer_mismatch"

    # No key configured at all → open (matches original behaviour)
    if not RELAY_API_KEY and not MIRA_IGNITION_HMAC_KEY:
        return True, None, None

    return False, None, "auth_required"


async def health(request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok", "service": "mira-relay"})


def _emit_tag_events(payload: dict, relay_batch_id: uuid.UUID, tenant_id: str | None = None) -> None:
    """Detect meaningful diffs and write them to NeonDB tag_events (Phase 5).

    Called after the SQLite upsert. Fail-soft — any exception is caught and
    logged so the relay response is never blocked by Neon unavailability.

    tag_id convention: "{equipment_id}.{tag_name}" composite key, matching how
    approved_tags.tag_id is populated (e.g. "CONV-001.motor_running").
    """
    try:
        import neon as _neon

        tenant = tenant_id or payload.get("tenant_id", "")
        equipment = payload.get("equipment", {})

        flat_tags: dict = {}
        for eq_id, tags in equipment.items():
            for tag_name, tag_data in tags.items():
                flat_tags[f"{eq_id}.{tag_name}"] = tag_data

        if not flat_tags:
            return

        # Empty approved set = pass-all (bench mode / table not yet populated).
        approved = _neon.load_approved_tags(tenant) if tenant else {}
        rows = _diff_logger.process_batch(
            tenant_id=tenant,
            approved=approved,
            tags=flat_tags,
            relay_batch_id=relay_batch_id,
        )
        if rows:
            inserted = _neon.insert_tag_events(rows)
            logger.debug(
                "tag_events: batch=%s tenant=%s events=%d inserted=%d",
                str(relay_batch_id)[:8], tenant, len(rows), inserted,
            )
    except Exception as exc:  # pragma: no cover - fail-soft guard
        logger.warning("_emit_tag_events failed (batch=%s): %s", str(relay_batch_id)[:8], exc)


async def ingest(request: Request) -> JSONResponse:
    body = await request.body()

    ok, tenant_id, detail = await _authenticate_http(request, body)
    if not ok:
        return JSONResponse({"error": "auth_failed", "detail": detail}, status_code=401)

    try:
        payload = json.loads(body)
    except Exception:
        return JSONResponse({"error": "invalid json"}, status_code=400)

    msg_type = payload.get("type")
    if msg_type != "tags":
        return JSONResponse({"error": f"unsupported type: {msg_type}"}, status_code=400)

    count = process_tag_payload(payload, tenant_id=tenant_id)
    if RELAY_TAG_EVENTS and _diff_logger is not None:
        _emit_tag_events(payload, uuid.uuid4(), tenant_id=tenant_id)
    logger.info(
        "Ingested %d equipment rows from %s (tenant=%s)",
        count,
        payload.get("agent_id", "unknown"),
        tenant_id or "legacy",
    )
    return JSONResponse({"status": "ok", "equipment_count": count})


async def ws_relay(websocket: WebSocket) -> None:
    await websocket.accept()

    authenticated = not RELAY_API_KEY and not MIRA_IGNITION_HMAC_KEY
    ws_tenant_id: str | None = None

    if not authenticated:
        try:
            auth_msg = await asyncio.wait_for(websocket.receive_json(), timeout=10)
        except Exception:
            await websocket.close(code=4001)
            return

        auth_type = auth_msg.get("type")

        if auth_type == "auth_hmac":
            # HMAC auth over WebSocket.
            # The signed payload is the JSON auth message with the signature field removed.
            # Build the signing body from the four required fields.
            tenant = auth_msg.get("tenant", "")
            nonce = auth_msg.get("nonce", "")
            timestamp = str(auth_msg.get("timestamp", ""))
            signature = auth_msg.get("signature", "")
            # Re-construct the canonical signed string directly (avoids JSON serialisation drift).
            # The body bytes are the UTF-8 encoding of the auth message body string.
            body_for_signing = json.dumps(
                {"type": "auth_hmac", "tenant": tenant, "nonce": nonce, "timestamp": auth_msg.get("timestamp", "")},
                separators=(",", ":"),
            ).encode()
            synthetic_headers = {
                "x-mira-tenant": tenant,
                "x-mira-nonce": nonce,
                "x-mira-timestamp": timestamp,
                "x-mira-signature": signature,
            }
            if not MIRA_IGNITION_HMAC_KEY:
                await websocket.send_json({"error": "hmac_not_configured"})
                await websocket.close(code=4001)
                return
            try:
                ws_tenant_id = verify_hmac(synthetic_headers, body_for_signing, MIRA_IGNITION_HMAC_KEY)
                authenticated = True
                await websocket.send_json({"type": "auth_ok"})
            except ValueError as exc:
                await websocket.send_json({"error": "unauthorized", "detail": str(exc)})
                await websocket.close(code=4001)
                return

        elif auth_type == "auth" and RELAY_LEGACY_BEARER:
            # Legacy token path — only allowed when RELAY_LEGACY_BEARER=1
            if auth_msg.get("token") == RELAY_API_KEY:
                authenticated = True
                await websocket.send_json({"type": "auth_ok"})
            else:
                await websocket.send_json({"error": "unauthorized"})
                await websocket.close(code=4001)
                return

        elif auth_type == "auth" and not RELAY_LEGACY_BEARER:
            # Legacy path disabled
            await websocket.send_json({"error": "unauthorized", "detail": "legacy bearer disabled"})
            await websocket.close(code=4001)
            return

        else:
            await websocket.send_json({"error": "unauthorized"})
            await websocket.close(code=4001)
            return

    logger.info("WebSocket client connected (tenant=%s)", ws_tenant_id or "legacy")
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            if msg_type == "tags":
                count = process_tag_payload(data, tenant_id=ws_tenant_id)
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
