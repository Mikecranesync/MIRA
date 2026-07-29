from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import sqlite3
from datetime import datetime, timezone

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket

from auth import verify_hmac
from historian import TimeAggregation

logger = logging.getLogger("mira-relay")

DB_PATH = os.getenv("MIRA_DB_PATH", "/mira-db/mira.db")
RELAY_API_KEY = os.getenv("RELAY_API_KEY", "")
# Set RELAY_LEGACY_BEARER=1 to accept the old "Authorization: Bearer <key>" path.
# Keep enabled until plc/live-plc-bridge and mira-fault-detective migrate to HMAC.
RELAY_LEGACY_BEARER = os.getenv("RELAY_LEGACY_BEARER", "0") == "1"
MIRA_IGNITION_HMAC_KEY = os.getenv("MIRA_IGNITION_HMAC_KEY", "")

# Historian Query API (#2339). Backend is swappable via env; postgres is prod
# over the existing Hub tables. The WS poll loop is OPT-IN (off in tests so the
# Starlette TestClient never blocks on a background broadcaster).
MIRA_HISTORIAN_BACKEND = os.getenv("MIRA_HISTORIAN_BACKEND", "postgres")
MIRA_HISTORIAN_WS_POLL = os.getenv("MIRA_HISTORIAN_WS_POLL", "0") == "1"
MIRA_HISTORIAN_WS_POLL_INTERVAL = float(os.getenv("MIRA_HISTORIAN_WS_POLL_INTERVAL", "2.0"))

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
    logger.info(
        "Ingested %d equipment rows from %s (tenant=%s)",
        count,
        payload.get("agent_id", "unknown"),
        tenant_id or "legacy",
    )
    return JSONResponse({"status": "ok", "equipment_count": count})


def _get_tag_store():
    """Factory for the Phase-2 tag store. Overridable in tests."""
    from tag_ingest import NeonTagStore

    return NeonTagStore(os.getenv("NEON_DATABASE_URL", ""))


async def tags_ingest(request: Request) -> JSONResponse:
    """POST /api/v1/tags/ingest — production tag ingestion.

    The successor to /ingest: HMAC auth, approved_tags allowlist enforcement
    (fail-closed), UNS resolution, append to tag_events + upsert
    live_signal_cache (current_tag_state), with simulated/real provenance kept
    strictly separated. See tag_ingest.ingest_batch.
    """
    from tag_ingest import IngestError, ingest_batch

    body = await request.body()

    ok, hmac_tenant, detail = await _authenticate_http(request, body)
    if not ok:
        return JSONResponse({"error": "auth_failed", "detail": detail}, status_code=401)

    try:
        payload = json.loads(body)
    except Exception:
        return JSONResponse({"error": "invalid json"}, status_code=400)

    # HMAC tenant is authoritative; fall back to the body tenant only in the
    # non-HMAC dev/bench path. Never trust a caller-supplied tenant over HMAC.
    tenant_id = hmac_tenant or payload.get("tenant_id")
    if not tenant_id:
        return JSONResponse({"error": "tenant_required"}, status_code=400)

    try:
        result = ingest_batch(payload, tenant_id, _get_tag_store())
    except IngestError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception:
        logger.exception("tags_ingest failed (tenant=%s)", tenant_id)
        return JSONResponse({"error": "ingest_failed"}, status_code=500)

    logger.info(
        "tags_ingest tenant=%s source=%s accepted=%d rejected=%d cache_skipped=%d sim=%s",
        tenant_id,
        result.source_system,
        result.accepted,
        len(result.rejected),
        result.cache_skipped,
        result.simulated,
    )
    return JSONResponse(result.as_dict())


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


# ──────────────────────────────────────────────────────────────────────────
# Historian Query API (#2339): live values, tag history, trends, evidence.
# Thin routes — parse/validate → adapter call → JSON. The adapter is the single
# DB boundary; tests inject an InMemoryHistorianAdapter via _get_historian.
# ──────────────────────────────────────────────────────────────────────────


def _get_historian():
    """Factory for the Historian adapter. Overridable in tests. Backend chosen
    by MIRA_HISTORIAN_BACKEND (default 'postgres' over the existing Hub tables;
    Timescale/Influx adapters land behind this same seam in #2344)."""
    backend = MIRA_HISTORIAN_BACKEND
    if backend == "postgres":
        from historian_postgres import PostgresHistorianAdapter

        return PostgresHistorianAdapter(os.getenv("NEON_DATABASE_URL", ""))
    raise RuntimeError(f"unknown MIRA_HISTORIAN_BACKEND: {backend}")


def _latest_values_for(tenant_id: str) -> dict[str, dict]:
    """Latest live value per tag for a tenant, as JSON-serializable dicts. The
    WS poll path reads from here; tests monkeypatch it to a deterministic fake."""
    adapter = _get_historian()
    return {s.tag_path: s.to_dict() for s in adapter.list_tags(tenant_id)}


def _parse_dt(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError as exc:
        raise ValueError(f"bad datetime: {raw}") from exc


async def _auth_read(request: Request) -> tuple[JSONResponse | None, str | None, bytes]:
    """Authenticate a Historian read request, reusing the existing HMAC flow.

    Returns (error_response_or_None, tenant_id, body). The Historian read
    surface is strictly tenant-scoped, so a verified-but-tenantless request
    (legacy bearer / open instance) is refused 401 — there is no tenant to
    scope RLS to."""
    body = await request.body()
    ok, tenant_id, detail = await _authenticate_http(request, body)
    if not ok:
        return JSONResponse({"error": "auth_failed", "detail": detail}, status_code=401), None, body
    if not tenant_id:
        return JSONResponse({"error": "tenant_required"}, status_code=401), None, body
    return None, tenant_id, body


async def tags_live(request: Request) -> JSONResponse:
    err, tenant_id, _ = await _auth_read(request)
    if err:
        return err
    samples = _get_historian().list_tags(tenant_id)
    return JSONResponse({"tags": [s.to_dict() for s in samples]})


async def tag_history(request: Request) -> JSONResponse:
    err, tenant_id, _ = await _auth_read(request)
    if err:
        return err
    tag_path = request.path_params["tag_id"]
    interval = request.query_params.get("interval")
    try:
        start = _parse_dt(request.query_params.get("start"))
        end = _parse_dt(request.query_params.get("end"))
        TimeAggregation.parse(interval)  # validate early → 400 on garbage
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    points = _get_historian().get_history(
        tenant_id, tag_path, start=start, end=end, interval=interval
    )
    return JSONResponse({"tag_path": tag_path, "points": [p.to_dict() for p in points]})


async def trends(request: Request) -> JSONResponse:
    err, tenant_id, body = await _auth_read(request)
    if err:
        return err
    try:
        payload = json.loads(body)
    except Exception:
        return JSONResponse({"error": "invalid json"}, status_code=400)
    tag_paths = payload.get("tag_paths")
    if not isinstance(tag_paths, list) or not tag_paths:
        return JSONResponse({"error": "tag_paths_required"}, status_code=400)
    interval = payload.get("interval")
    try:
        start = _parse_dt(payload.get("start"))
        end = _parse_dt(payload.get("end"))
        TimeAggregation.parse(interval)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    buckets = _get_historian().get_trends(
        tenant_id, tag_paths, start=start, end=end, interval=interval
    )
    return JSONResponse({"buckets": [b.to_dict() for b in buckets]})


async def evidence(request: Request) -> JSONResponse:
    err, tenant_id, _ = await _auth_read(request)
    if err:
        return err
    fault_window_id = request.path_params["fault_window_id"]
    try:
        window = _get_historian().get_evidence(tenant_id, fault_window_id)
    except Exception:
        logger.exception("evidence query failed (tenant=%s)", tenant_id)
        return JSONResponse({"error": "evidence_failed"}, status_code=500)
    return JSONResponse(window.to_dict())


async def runs(request: Request) -> JSONResponse:
    """Runs are DEFERRED to #2341. Auth still applies, then 501."""
    err, _tenant_id, _ = await _auth_read(request)
    if err:
        return err
    return JSONResponse(
        {"error": "not_implemented", "detail": "runs tables land in #2341"},
        status_code=501,
    )


# ── WS subscription manager — tenant-scoped, keyed by (tenant_id, tag_path) ───


class SubscriptionManager:
    """Routes tag_update broadcasts to subscribed sockets. The key always
    includes tenant_id, so a tenant's values can ONLY ever reach that tenant's
    own authenticated sockets — cross-tenant leakage is structurally impossible.
    The tenant_id is the socket's HMAC-derived identity, never client-supplied."""

    def __init__(self) -> None:
        self._subs: dict[tuple[str | None, str], set] = {}        # (tenant, tag) → sockets
        self._by_socket: dict[int, set[tuple[str | None, str]]] = {}
        self._last_sent: dict[tuple[str | None, str], object] = {}

    def clear(self) -> None:
        self._subs.clear()
        self._by_socket.clear()
        self._last_sent.clear()

    def subscribe(self, ws, tenant_id: str | None, tag_path: str) -> None:
        key = (tenant_id, tag_path)
        self._subs.setdefault(key, set()).add(ws)
        self._by_socket.setdefault(id(ws), set()).add(key)

    def unsubscribe(self, ws, tenant_id: str | None, tag_path: str) -> None:
        key = (tenant_id, tag_path)
        self._subs.get(key, set()).discard(ws)
        if not self._subs.get(key):
            self._subs.pop(key, None)
            self._last_sent.pop(key, None)
        self._by_socket.get(id(ws), set()).discard(key)

    def remove(self, ws) -> None:
        for key in self._by_socket.pop(id(ws), set()):
            self._subs.get(key, set()).discard(ws)
            if not self._subs.get(key):
                self._subs.pop(key, None)
                self._last_sent.pop(key, None)

    def is_subscribed(self, tenant_id: str | None, tag_path: str) -> bool:
        return bool(self._subs.get((tenant_id, tag_path)))

    def tenants(self) -> set[str | None]:
        return {tenant for (tenant, _tag) in self._subs}

    def subscribed_tags(self, tenant_id: str | None) -> set[str]:
        return {tag for (tenant, tag) in self._subs if tenant == tenant_id}

    def note_change(self, tenant_id: str | None, tag_path: str, value) -> bool:
        """Return True if value differs from the last broadcast for this key
        (dedup so a steady poll doesn't spam). First observation always emits."""
        key = (tenant_id, tag_path)
        if self._last_sent.get(key) == value:
            return False
        self._last_sent[key] = value
        return True

    async def broadcast(self, tenant_id: str | None, tag_path: str, message: dict) -> None:
        for ws in list(self._subs.get((tenant_id, tag_path), set())):
            try:
                await ws.send_json(message)
            except Exception:
                self.remove(ws)


subscriptions = SubscriptionManager()


async def _ws_authenticate(websocket: WebSocket) -> tuple[bool, str | None]:
    """First-message auth for Historian sockets, mirroring the /ws handler:
    HMAC (auth_hmac) preferred, legacy bearer only when explicitly enabled.
    Returns (authenticated, tenant_id)."""
    if not RELAY_API_KEY and not MIRA_IGNITION_HMAC_KEY:
        return True, None  # open instance (matches /ws behaviour)

    try:
        auth_msg = await asyncio.wait_for(websocket.receive_json(), timeout=10)
    except Exception:
        return False, None

    auth_type = auth_msg.get("type")
    if auth_type == "auth_hmac":
        if not MIRA_IGNITION_HMAC_KEY:
            return False, None
        tenant = auth_msg.get("tenant", "")
        nonce = auth_msg.get("nonce", "")
        timestamp = str(auth_msg.get("timestamp", ""))
        signature = auth_msg.get("signature", "")
        body_for_signing = json.dumps(
            {"type": "auth_hmac", "tenant": tenant, "nonce": nonce,
             "timestamp": auth_msg.get("timestamp", "")},
            separators=(",", ":"),
        ).encode()
        synthetic_headers = {
            "x-mira-tenant": tenant,
            "x-mira-nonce": nonce,
            "x-mira-timestamp": timestamp,
            "x-mira-signature": signature,
        }
        try:
            tenant_id = verify_hmac(synthetic_headers, body_for_signing, MIRA_IGNITION_HMAC_KEY)
            return True, tenant_id
        except ValueError:
            return False, None

    if auth_type == "auth" and RELAY_LEGACY_BEARER:
        if auth_msg.get("token") == RELAY_API_KEY:
            return True, None
        return False, None

    return False, None


async def _poll_tenant(tenant_id: str | None) -> None:
    """Read latest values for a tenant and broadcast tag_update to its
    subscribers (deduped). Tenant-scoped: only this tenant's sockets are
    touched."""
    subscribed = subscriptions.subscribed_tags(tenant_id)
    if not subscribed:
        return
    try:
        latest = _latest_values_for(tenant_id)
    except Exception:
        logger.exception("ws poll failed (tenant=%s)", tenant_id)
        return
    for tag_path, sample in latest.items():
        if tag_path not in subscribed:
            continue
        marker = sample.get("value") if isinstance(sample, dict) else sample
        if subscriptions.note_change(tenant_id, tag_path, marker):
            await subscriptions.broadcast(
                tenant_id, tag_path,
                {"type": "tag_update", "tag_path": tag_path, "sample": sample},
            )


async def ws_tags(websocket: WebSocket) -> None:
    """Tenant-scoped tag subscription socket. Reuses the /ws HMAC handshake,
    then handles subscribe / unsubscribe / poll / ping. tag_update messages are
    only ever delivered to the subscribing tenant's own sockets."""
    await websocket.accept()
    authenticated, ws_tenant_id = await _ws_authenticate(websocket)
    if not authenticated:
        try:
            await websocket.send_json({"error": "unauthorized"})
        except Exception:
            pass
        await websocket.close(code=4001)
        return

    if RELAY_API_KEY or MIRA_IGNITION_HMAC_KEY:
        await websocket.send_json({"type": "auth_ok"})

    logger.info("ws/tags client connected (tenant=%s)", ws_tenant_id or "open")
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            if msg_type == "subscribe":
                tag_path = data.get("tag_path")
                if not tag_path:
                    await websocket.send_json({"error": "tag_path_required"})
                    continue
                # Always key by the socket's authenticated tenant — never a
                # client-supplied tenant.
                subscriptions.subscribe(websocket, ws_tenant_id, tag_path)
                await websocket.send_json({"type": "subscribed", "tag_path": tag_path})
            elif msg_type == "unsubscribe":
                tag_path = data.get("tag_path")
                subscriptions.unsubscribe(websocket, ws_tenant_id, tag_path)
                await websocket.send_json({"type": "unsubscribed", "tag_path": tag_path})
            elif msg_type == "poll":
                await _poll_tenant(ws_tenant_id)
            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})
            else:
                await websocket.send_json({"error": f"unknown type: {msg_type}"})
    except Exception:
        logger.info("ws/tags client disconnected")
    finally:
        subscriptions.remove(websocket)


async def _ws_poll_loop() -> None:
    """Background broadcaster. OPT-IN (MIRA_HISTORIAN_WS_POLL=1) so it never
    starts under the test client. Polls every subscribed tenant on an interval."""
    while True:
        await asyncio.sleep(MIRA_HISTORIAN_WS_POLL_INTERVAL)
        for tenant_id in list(subscriptions.tenants()):
            await _poll_tenant(tenant_id)


@contextlib.asynccontextmanager
async def _lifespan(app):
    """Start the OPT-IN ws/tags poll loop only when explicitly enabled, so the
    TestClient (which runs the lifespan) never spawns a background broadcaster."""
    task = None
    if MIRA_HISTORIAN_WS_POLL:
        task = asyncio.create_task(_ws_poll_loop())
        logger.info("ws/tags background poll loop started")
    try:
        yield
    finally:
        if task is not None:
            task.cancel()


routes = [
    Route("/health", health, methods=["GET"]),
    Route("/ingest", ingest, methods=["POST"]),
    Route("/api/v1/tags/ingest", tags_ingest, methods=["POST"]),
    Route("/api/tags/live", tags_live, methods=["GET"]),
    Route("/api/tags/{tag_id:path}/history", tag_history, methods=["GET"]),
    Route("/api/trends", trends, methods=["POST"]),
    Route("/api/evidence/{fault_window_id}", evidence, methods=["GET"]),
    Route("/api/runs/{run_id}", runs, methods=["GET"]),
    WebSocketRoute("/ws", ws_relay),
    WebSocketRoute("/ws/tags", ws_tags),
]

app = Starlette(routes=routes, lifespan=_lifespan)

if __name__ == "__main__":
    import uvicorn

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    port = int(os.getenv("RELAY_PORT", "8765"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
