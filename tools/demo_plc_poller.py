"""Demo PLC poller — reads Micro820 over Modbus TCP, pushes to mira-relay + NeonDB.

SAFETY
======
This module is **STRICTLY READ-ONLY** with respect to the PLC.

The poller MUST NEVER call ``write_coil``, ``write_register``,
``write_coils``, or ``write_registers`` against the PLC under any
circumstance. Writing to coil 6 (e_stop) or any motion-control coil
without explicit operator approval violates the cluster safety rules in
``/Users/charlienode/factorylm/CLAUDE.md`` (PLC / Factory IO safety
section) and could trigger real machine motion in the garage demo.

If you need to write to the PLC, use the ``factorylm-factory`` MCP
server (``factory_write_coil`` / ``factory_write_register``) which is
gated by per-session approval.

Behaviour
=========
- Connects to a Micro820 at ``--plc-ip:--plc-port`` (default
  192.168.1.100:502).
- Polls coils 0-6 and holding registers 100-105 every ``--poll-interval``
  seconds (default 1.0s).
- Translates raw values to engineering units (current/10, temp/10).
- Pushes each snapshot to ``mira-relay`` ``/ingest`` using the relay's
  ``{type:"tags",equipment:{eq_id:{tag:{v,q,t}}}}`` schema.
- Also writes the snapshot to ``live_signal_cache`` and any detected
  rising/falling/value-changed transitions to ``live_signal_events`` in
  NeonDB (best-effort; both targets are independent and either may be
  disabled by leaving its URL unset).
- Maps each PLC point to a UNS topic and a PLC tag name (see
  ``ADDRESS_MAP`` below).
- ``--dry-run`` short-circuits both relay and DB writes — useful for
  smoke-testing against ``tools/demo_plc_simulator.py``.

CLI
===
    python -m tools.demo_plc_poller \\
        --plc-ip 192.168.1.100 \\
        --poll-interval 1.0 \\
        --relay-url http://localhost:8765 \\
        --db-url "$NEON_DATABASE_URL"
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import signal
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx

try:
    from pymodbus.client import AsyncModbusTcpClient
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "pymodbus is required: pip install pymodbus>=3.0"
    ) from exc

logger = logging.getLogger("mira-plc-poller")


# ---------------------------------------------------------------------------
# Address map — single source of truth for the garage demo conveyor.
#
# MUST match the Micro820 Modbus server map actually deployed on the PLC:
# `plc/MbSrvConf_v4.xml` (22 coils + 17 HRs, v4.1.9 ladder). Modbus PDU address
# = CCW display address − 1, so read_coils(address=0) → coil 000001 = motor_running.
# The variable names below are the ladder globals (also used by the Node-RED
# fault-detective flow), NOT the old "Conveyor.MTR001_*" CCW aliases.
#
# We read the first 7 coils (000001-000007) and HR 100-105 (400101-400106) — the
# subset the live dashboard needs. The v4 map also exposes coils 8-22 and
# HR 107-117 (VFD freq/current/voltage/dc-bus, conv_state, poll-state); surfacing
# those is a follow-up that needs the ladder's scaling documented first.
# Do not edit without updating `plc/MbSrvConf_v4.xml` and `tools/demo_plc_simulator.py`.
# ---------------------------------------------------------------------------


COIL = "coil"
HOLDING = "holding"


@dataclass(frozen=True)
class PLCPoint:
    name: str
    kind: str            # "coil" | "holding"
    address: int
    scale: float         # raw → engineering value (raw / scale, or 1 = passthrough)
    uns_topic: str       # ISA-95 style UNS topic
    plc_tag: str         # ladder global / MbSrvConf variable name
    relay_tag: str | None = None  # name to use in relay payload (uses tag-column map)


ADDRESS_MAP: list[PLCPoint] = [
    # Coils 000001-000007 (read as PDU address 0-6) — booleans, per MbSrvConf_v4.xml
    PLCPoint("motor_running",    COIL, 0, 1, "demo/training/conveyor001/motor/mtr001/running",  "motor_running",    "motor_running"),
    PLCPoint("conveyor_running", COIL, 1, 1, "demo/training/conveyor001/state/running",         "conveyor_running", "conveyor_running"),
    PLCPoint("fault_alarm",      COIL, 2, 1, "demo/training/conveyor001/faults/active",         "fault_alarm",      "fault_alarm"),
    PLCPoint("vfd_comm_ok",      COIL, 3, 1, "demo/training/conveyor001/vfd/vfd001/comm_ok",     "vfd_comm_ok",      "vfd_comm_ok"),
    PLCPoint("system_ready",     COIL, 4, 1, "demo/training/conveyor001/state/ready",           "system_ready",     "system_ready"),
    PLCPoint("e_stop_active",    COIL, 5, 1, "demo/training/conveyor001/safety/estop",          "e_stop_active",    "e_stop_active"),
    PLCPoint("dir_fwd",          COIL, 6, 1, "demo/training/conveyor001/motor/mtr001/dir_fwd",  "dir_fwd",          "dir_fwd"),
    # Holding 400101-400106 (read as PDU address 100-105) — analog, per MbSrvConf_v4.xml
    PLCPoint("motor_speed",      HOLDING, 100, 1.0,  "demo/training/conveyor001/motor/mtr001/speed",       "motor_speed",    "motor_speed"),
    PLCPoint("motor_current",    HOLDING, 101, 10.0, "demo/training/conveyor001/motor/mtr001/current",     "motor_current",  "motor_current"),
    PLCPoint("temperature",      HOLDING, 102, 10.0, "demo/training/conveyor001/motor/mtr001/temperature", "temperature",    "temperature"),
    PLCPoint("pressure",         HOLDING, 103, 1.0,  "demo/training/conveyor001/pneumatic/pressure",       "pressure",       "pressure"),
    PLCPoint("conveyor_speed",   HOLDING, 104, 1.0,  "demo/training/conveyor001/state/speed",              "conveyor_speed", "conveyor_speed"),
    PLCPoint("error_code",       HOLDING, 105, 1.0,  "demo/training/conveyor001/faults/code",              "error_code",     "error_code"),
]

EQUIPMENT_ID = "CONV-001"
DEFAULT_TENANT_ID = "garage-demo"
AGENT_ID = "demo-plc-poller"

# Resilience tuning for the poll loop.
FEED_DOWN_THRESHOLD = 5   # consecutive failures before one loud, actionable warning
ERROR_LOG_EVERY = 30      # after the first, log a one-line error every Nth failure


# ---------------------------------------------------------------------------
# NeonDB DDL — created idempotently on first write.
# ---------------------------------------------------------------------------


SCHEMA_DDL = """
-- live_signal_cache: matches mira-hub migration 020 shape (PRIMARY KEY is
-- (tenant_id, plc_tag)). If mig 020 has already run, CREATE TABLE IF NOT EXISTS
-- no-ops safely. The old shape (topic TEXT PRIMARY KEY) collided: a migrated NeonDB
-- silently skipped DDL then failed on INSERT with mismatched column names.
CREATE TABLE IF NOT EXISTS live_signal_cache (
    tenant_id          UUID        NOT NULL,
    plc_tag            TEXT        NOT NULL,
    component_id       UUID,
    last_value_text    TEXT,
    last_value_numeric DOUBLE PRECISION,
    last_value_bool    BOOLEAN,
    last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_changed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    prev_value_numeric DOUBLE PRECISION,
    prev_value_bool    BOOLEAN,
    simulated          BOOLEAN     NOT NULL DEFAULT true,
    source             TEXT        NOT NULL DEFAULT 'demo_plc_poller',
    properties         JSONB       NOT NULL DEFAULT '{}',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, plc_tag)
);

-- live_signal_events: matches mira-hub migration 019 shape. Poller-specific
-- fields (event_type, prev_value) are stored in properties JSONB.
CREATE TABLE IF NOT EXISTS live_signal_events (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    component_id  UUID,
    plc_tag       TEXT,
    value_numeric DOUBLE PRECISION,
    value_bool    BOOLEAN,
    simulated     BOOLEAN     NOT NULL DEFAULT true,
    source        TEXT        NOT NULL DEFAULT 'demo_plc_poller',
    properties    JSONB       NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_signal_events_tenant_tag
    ON live_signal_events (tenant_id, plc_tag, created_at DESC);
"""


# ---------------------------------------------------------------------------
# Snapshot / events
# ---------------------------------------------------------------------------


@dataclass
class Snapshot:
    timestamp: datetime
    values: dict[str, float] = field(default_factory=dict)  # name -> engineering value

    def get(self, name: str) -> float | None:
        return self.values.get(name)


def detect_events(prev: Snapshot | None, curr: Snapshot) -> list[dict[str, Any]]:
    """Compare two snapshots and emit rising_edge / falling_edge / value_changed events."""
    if prev is None:
        return []

    events: list[dict[str, Any]] = []
    coils = {p.name for p in ADDRESS_MAP if p.kind == COIL}
    point_by_name = {p.name: p for p in ADDRESS_MAP}

    for name, new_val in curr.values.items():
        old_val = prev.values.get(name)
        if old_val is None or old_val == new_val:
            continue

        if name in coils:
            event_type = "rising_edge" if new_val > old_val else "falling_edge"
        else:
            event_type = "value_changed"

        point = point_by_name[name]
        events.append({
            "topic": point.uns_topic,
            "plc_tag": point.plc_tag,
            "equipment_id": EQUIPMENT_ID,
            "event_type": event_type,
            "prev_value": old_val,
            "new_value": new_val,
            "occurred_at": curr.timestamp,
        })

    return events


# ---------------------------------------------------------------------------
# Poller
# ---------------------------------------------------------------------------


class DemoPLCPoller:
    """Polls the demo conveyor PLC and forwards values to mira-relay + NeonDB.

    READ-ONLY: this class never issues a Modbus write. See module docstring.
    """

    def __init__(
        self,
        plc_ip: str,
        plc_port: int,
        poll_interval: float,
        relay_url: str | None,
        relay_api_key: str | None,
        db_url: str | None,
        tenant_id: str,
        dry_run: bool,
    ) -> None:
        self.plc_ip = plc_ip
        self.plc_port = plc_port
        self.poll_interval = poll_interval
        self.relay_url = relay_url.rstrip("/") if relay_url else None
        self.relay_api_key = relay_api_key
        self.db_url = db_url
        self.tenant_id = tenant_id
        self.dry_run = dry_run

        self._modbus: AsyncModbusTcpClient | None = None
        self._http: httpx.AsyncClient | None = None
        self._db_conn = None  # psycopg connection, lazily created
        self._db_schema_ready = False
        self._prev: Snapshot | None = None
        self._stop = asyncio.Event()

    # -- lifecycle ----------------------------------------------------------

    async def start(self) -> None:
        self._modbus = AsyncModbusTcpClient(self.plc_ip, port=self.plc_port)
        await self._modbus.connect()
        if not self._modbus.connected:
            raise RuntimeError(
                f"Could not connect to Modbus PLC at {self.plc_ip}:{self.plc_port}"
            )
        self._http = httpx.AsyncClient(timeout=10.0)
        logger.info(
            "Connected to PLC %s:%d (poll=%.2fs relay=%s db=%s dry_run=%s)",
            self.plc_ip, self.plc_port, self.poll_interval,
            self.relay_url or "disabled",
            "enabled" if self.db_url else "disabled",
            self.dry_run,
        )

    async def stop(self) -> None:
        self._stop.set()
        if self._modbus is not None:
            self._modbus.close()
        if self._http is not None:
            await self._http.aclose()
        if self._db_conn is not None:
            try:
                self._db_conn.close()
            except Exception:
                logger.exception("Failed to close NeonDB connection")
        logger.info("Poller stopped cleanly")

    def request_stop(self) -> None:
        self._stop.set()

    # -- main loop ----------------------------------------------------------

    async def run(self) -> None:
        assert self._modbus is not None
        consecutive_failures = 0
        while not self._stop.is_set():
            cycle_start = asyncio.get_running_loop().time()
            try:
                snapshot = await self._poll_once()
                events = detect_events(self._prev, snapshot)
                self._prev = snapshot

                await asyncio.gather(
                    self._push_relay(snapshot),
                    self._push_neondb(snapshot, events),
                    return_exceptions=False,
                )

                if consecutive_failures:
                    logger.info("PLC feed RECOVERED after %d failed cycle(s)", consecutive_failures)
                consecutive_failures = 0
                logger.debug(
                    "Cycle ok values=%d events=%d",
                    len(snapshot.values), len(events),
                )
            except Exception as exc:
                consecutive_failures += 1
                await self._handle_poll_failure(consecutive_failures, exc)

            elapsed = asyncio.get_running_loop().time() - cycle_start
            sleep_for = max(0.0, self.poll_interval - elapsed)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=sleep_for)
            except asyncio.TimeoutError:
                pass

    async def _handle_poll_failure(self, n: int, exc: Exception) -> None:
        """Rate-limited logging + best-effort reconnect on a failed poll.

        We deliberately do NOT write anything to the relay / cache on failure, so
        downstream freshness (``live_signal_cache.last_seen_at``) decays and the UI
        can flag the feed as stale instead of showing stale data as live.
        """
        # First failure + every Nth after: one clear line, not a traceback-per-tick.
        if n == 1 or n % ERROR_LOG_EVERY == 0:
            logger.error("Poll cycle failed (%d in a row): %s", n, exc)
        # One loud, actionable warning when the feed is clearly down.
        if n == FEED_DOWN_THRESHOLD:
            logger.warning(
                "PLC FEED DOWN — %d consecutive Modbus failures. If these are "
                "ILLEGAL_FUNCTION (exception 1), the Micro820 Modbus map is not "
                "deployed: run `python plc/deploy_modbus_map.py --auto`, then download "
                "to the PLC in CCW and set RUN.",
                n,
            )
        # Reconnect in case the socket dropped (AsyncModbusTcpClient may not auto-heal).
        try:
            if self._modbus is not None and not self._modbus.connected:
                await self._modbus.connect()
        except Exception as reconnect_exc:  # pragma: no cover - best effort
            logger.debug("Reconnect attempt failed: %s", reconnect_exc)

    # -- read path ----------------------------------------------------------

    async def _poll_once(self) -> Snapshot:
        # READ-ONLY: only read_coils / read_holding_registers are called.
        assert self._modbus is not None
        coils_resp = await self._modbus.read_coils(address=0, count=7)
        if coils_resp.isError():
            raise RuntimeError(f"read_coils failed: {coils_resp}")
        hregs_resp = await self._modbus.read_holding_registers(address=100, count=6)
        if hregs_resp.isError():
            raise RuntimeError(f"read_holding_registers failed: {hregs_resp}")

        if len(coils_resp.bits) < 7 or len(hregs_resp.registers) < 6:
            raise RuntimeError(
                f"short Modbus read: {len(coils_resp.bits)} coils / "
                f"{len(hregs_resp.registers)} registers (expected ≥7 / ≥6)"
            )

        values: dict[str, float] = {}
        for p in ADDRESS_MAP:
            if p.kind == COIL:
                raw = coils_resp.bits[p.address]
                values[p.name] = float(1 if raw else 0)
            else:
                raw = hregs_resp.registers[p.address - 100]
                values[p.name] = float(raw) / p.scale

        return Snapshot(timestamp=datetime.now(timezone.utc), values=values)

    # -- relay push ---------------------------------------------------------

    async def _push_relay(self, snapshot: Snapshot) -> None:
        if not self.relay_url or self.dry_run:
            if self.dry_run:
                logger.info("[dry-run] relay payload: %s", self._build_relay_payload(snapshot))
            return
        assert self._http is not None

        payload = self._build_relay_payload(snapshot)
        headers = {}
        if self.relay_api_key:
            headers["Authorization"] = f"Bearer {self.relay_api_key}"

        try:
            resp = await self._http.post(
                f"{self.relay_url}/ingest",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
        except httpx.HTTPError as e:
            logger.warning("relay push failed: %s", e)

    def _build_relay_payload(self, snapshot: Snapshot) -> dict[str, Any]:
        t = snapshot.timestamp.strftime("%Y-%m-%d %H:%M:%S")
        tags: dict[str, dict[str, Any]] = {}
        for p in ADDRESS_MAP:
            if p.relay_tag is None:
                continue
            tags[p.relay_tag] = {
                "v": snapshot.values[p.name],
                "q": "Good",
                "t": t,
            }
        return {
            "type": "tags",
            "tenant_id": self.tenant_id,
            "agent_id": AGENT_ID,
            "equipment": {EQUIPMENT_ID: tags},
        }

    # -- neondb push --------------------------------------------------------

    async def _push_neondb(self, snapshot: Snapshot, events: list[dict[str, Any]]) -> None:
        if not self.db_url or self.dry_run:
            if self.dry_run and events:
                logger.info("[dry-run] would persist %d events", len(events))
            return
        # psycopg is synchronous; offload to a worker thread to avoid blocking the loop.
        await asyncio.to_thread(self._sync_db_write, snapshot, events)

    def _sync_db_write(self, snapshot: Snapshot, events: list[dict[str, Any]]) -> None:
        try:
            conn = self._get_db()
        except Exception as e:
            logger.warning("NeonDB connect failed: %s", e)
            return

        try:
            with conn.cursor() as cur:
                if not self._db_schema_ready:
                    cur.execute(SCHEMA_DDL)
                    self._db_schema_ready = True

                # Upsert cache rows — migration-020 shape: PK=(tenant_id, plc_tag)
                _coil_names = {p.name for p in ADDRESS_MAP if p.kind == COIL}
                cur.executemany(
                    """
                    INSERT INTO live_signal_cache
                        (tenant_id, plc_tag,
                         last_value_numeric, last_value_bool,
                         last_seen_at, source, simulated)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (tenant_id, plc_tag) DO UPDATE SET
                        last_value_numeric = EXCLUDED.last_value_numeric,
                        last_value_bool    = EXCLUDED.last_value_bool,
                        last_seen_at       = EXCLUDED.last_seen_at,
                        updated_at         = now()
                    """,
                    [
                        (
                            self.tenant_id,
                            p.plc_tag,
                            None if p.kind == COIL else float(snapshot.values[p.name]),
                            bool(snapshot.values[p.name]) if p.kind == COIL else None,
                            snapshot.timestamp,
                            AGENT_ID,
                            False,  # real PLC data
                        )
                        for p in ADDRESS_MAP
                    ],
                )

                if events:
                    # migration-019 shape: poller-specific fields in properties JSONB
                    cur.executemany(
                        """
                        INSERT INTO live_signal_events
                            (tenant_id, plc_tag,
                             value_numeric, value_bool, source, simulated, properties)
                        VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                        """,
                        [
                            (
                                self.tenant_id,
                                e["plc_tag"],
                                None if e["plc_tag"] in _coil_names else float(e["new_value"]),
                                bool(e["new_value"]) if e["plc_tag"] in _coil_names else None,
                                AGENT_ID,
                                False,
                                json.dumps({
                                    "event_type": e["event_type"],
                                    "prev_value": e.get("prev_value"),
                                    "topic": e.get("topic"),
                                    "equipment_id": e.get("equipment_id"),
                                }),
                            )
                            for e in events
                        ],
                    )
            conn.commit()
        except Exception:
            logger.exception("NeonDB write failed")
            try:
                conn.rollback()
            except Exception:
                pass

    def _get_db(self):
        if self._db_conn is not None:
            return self._db_conn
        try:
            import psycopg  # psycopg v3
            self._db_conn = psycopg.connect(self.db_url)
        except ImportError:
            import psycopg2  # fallback
            self._db_conn = psycopg2.connect(self.db_url)
        return self._db_conn


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Demo PLC poller for garage conveyor (READ-ONLY).",
    )
    p.add_argument("--plc-ip", default=os.getenv("DEMO_PLC_IP", "192.168.1.100"))
    p.add_argument("--plc-port", type=int, default=int(os.getenv("DEMO_PLC_PORT", "502")))
    p.add_argument("--poll-interval", type=float, default=float(os.getenv("DEMO_PLC_POLL_INTERVAL", "1.0")))
    p.add_argument("--relay-url", default=os.getenv("MIRA_RELAY_URL", "http://localhost:8765"))
    p.add_argument("--relay-api-key", default=os.getenv("RELAY_API_KEY"))
    p.add_argument("--db-url", default=os.getenv("NEON_DATABASE_URL"))
    p.add_argument("--tenant-id", default=os.getenv("MIRA_TENANT_ID", DEFAULT_TENANT_ID))
    p.add_argument("--dry-run", action="store_true", help="Skip relay + DB writes; log only")
    p.add_argument("--log-level", default=os.getenv("LOG_LEVEL", "INFO"))
    return p.parse_args(argv)


async def _amain(args: argparse.Namespace) -> int:
    poller = DemoPLCPoller(
        plc_ip=args.plc_ip,
        plc_port=args.plc_port,
        poll_interval=args.poll_interval,
        relay_url=args.relay_url,
        relay_api_key=args.relay_api_key,
        db_url=args.db_url,
        tenant_id=args.tenant_id,
        dry_run=args.dry_run,
    )

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, poller.request_stop)
        except NotImplementedError:
            # Windows
            pass

    try:
        await poller.start()
        await poller.run()
    finally:
        await poller.stop()
    return 0


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    try:
        return asyncio.run(_amain(args))
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
