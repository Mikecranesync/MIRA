#!/usr/bin/env python3
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  ⚠️  BENCH / DEVELOPER TOOL — NEVER SHIPPED TO CUSTOMERS                  ║
# ║                                                                          ║
# ║  Direct Modbus TCP READ of the CV-101 bench Micro820 photo-eye (DI 5),   ║
# ║  delivered to the canonical mira-relay ingress. A fallback for when the  ║
# ║  bench Ignition gateway is unlicensed (trial expired → tags Bad/null).   ║
# ║  Customer installs read through Ignition, never through this tool.      ║
# ║                                                                          ║
# ║  READ-ONLY: Modbus FC1 (read coils) only. No write FC exists in here.    ║
# ║  Rules: .claude/rules/fieldbus-readonly.md, one-pipeline-ingest.md       ║
# ╚══════════════════════════════════════════════════════════════════════════╝
"""cv101_relay_poller — Micro820 `_IO_EM_DI_05` → POST /api/v1/tags/ingest.

Source → ingest_contract → ingest_batch: this module only decodes one Modbus coil
and calls the canonical ``build_tag_entry`` / ``build_ingest_batch`` builders and
``auth.sign_hmac_headers`` from ``mira-relay`` (no rival normalizer, batch shape,
allowlist or persistence). The relay stays the single enforcement point.

Identity (never borrowed from Ignition):
  source_system        = plc_bridge           (a direct PLC read, not Ignition)
  source_connection_id = cv101-bench-modbus
  tag_path             = micro820/_IO_EM_DI_05 (the PLC variable itself)
UNS identity comes from the relay's approved_tags row, not from this payload.

Live map (plc/MbSrvConf_v4.xml, slave-map v2): `_IO_EM_DI_05` → coil 000023 =
pymodbus offset 22. Before trusting coil 23 the poller checks the map signature on
every (re)connect — offset 0 readable, offsets 1 and 99 rejected with Modbus
exception 2 (unmapped). A different map flashed → it refuses to post.

Freshness and safety:
  * every posted reading comes from a read completed in that cycle; ts is the
    UTC read-completion time (ms resolution).
  * on a read/connect failure NOTHING is posted — no last-known value is replayed;
    the server-side 60 s last_seen_at window turns the signal stale.
  * posts on change immediately, otherwise a heartbeat every HEARTBEAT_S.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

RELAY_SRC = Path(__file__).resolve().parents[2] / "mira-relay"
sys.path.insert(0, str(RELAY_SRC))

from auth import sign_hmac_headers  # noqa: E402  (mira-relay, stdlib-only)
from ingest_contract import build_ingest_batch, build_tag_entry  # noqa: E402

PLC_HOST = os.getenv("PLC_HOST", "192.168.1.100")
PLC_PORT = int(os.getenv("PLC_PORT", "502"))
PLC_UNIT = int(os.getenv("PLC_UNIT", "1"))
INGEST_URL = os.getenv("RELAY_INGEST_URL", "https://app.factorylm.com/api/v1/tags/ingest")
PROPS = Path(
    os.getenv(
        "FACTORYLM_PROPERTIES",
        r"C:\Program Files\Inductive Automation\Ignition\data\factorylm\factorylm.properties",
    )
)
POLL_S = float(os.getenv("POLL_S", "0.25"))
HEARTBEAT_S = float(os.getenv("HEARTBEAT_S", "5"))

SOURCE_SYSTEM = "plc_bridge"
SOURCE_CONNECTION_ID = "cv101-bench-modbus"
TAG_PATH = "micro820/_IO_EM_DI_05"
DI05_COIL_OFFSET = 22  # coil 000023
MAP_READABLE = (0,)  # coil 000001 motor_running — mapped in v4
MAP_UNMAPPED = (1, 99)  # v4 gaps; the step-1 IO-check map maps both
MODBUS_ILLEGAL_ADDRESS = 2

log = logging.getLogger("cv101-relay-poller")


def load_credentials(props: Path = PROPS) -> tuple[str, str]:
    """Tenant + HMAC key: env first (staging runs), else the gateway's properties
    file. Never logged or returned anywhere else."""
    tenant = os.getenv("MIRA_TENANT_ID", "")
    key = os.getenv("MIRA_IGNITION_HMAC_KEY", "")
    if not (tenant and key):
        p: dict[str, str] = {}
        for line in props.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                p[k.strip()] = v.strip()
        tenant = tenant or p.get("MIRA_TENANT_ID") or p.get("TENANT_ID", "")
        key = key or p.get("MIRA_IGNITION_HMAC_KEY") or p.get("MIRA_HMAC_KEY", "")
    if not (tenant and key):
        raise SystemExit("missing tenant or HMAC key")
    return tenant, key


def read_coil(client: Any, offset: int) -> tuple[Optional[bool], Optional[int]]:
    """FC1 read of one coil → (value, None) or (None, modbus_exception_code).
    Raises OSError on transport failure. The ONLY bus operation in this module."""
    rr = None
    for kw in ({"count": 1, "device_id": PLC_UNIT}, {"count": 1, "slave": PLC_UNIT}):
        try:
            rr = client.read_coils(offset, **kw)
            break
        except TypeError:  # pymodbus renamed slave -> device_id across 3.x
            continue
    if rr is None or not hasattr(rr, "isError"):
        raise OSError(f"no response reading coil offset {offset}")
    if rr.isError():
        code = getattr(rr, "exception_code", None)
        if code is None:
            raise OSError(f"modbus error at coil offset {offset}: {rr}")
        return None, int(code)
    return bool(rr.bits[0]), None


def map_signature_ok(read: Callable[[int], tuple[Optional[bool], Optional[int]]]) -> bool:
    """True only when the flashed map looks like MbSrvConf_v4 (DI_05 at coil 23)."""
    for off in MAP_READABLE:
        if read(off)[0] is None:
            return False
    for off in MAP_UNMAPPED:
        if read(off)[1] != MODBUS_ILLEGAL_ADDRESS:
            return False
    return read(DI05_COIL_OFFSET)[0] is not None


def utc_iso(ts: float) -> str:
    return (
        datetime.fromtimestamp(ts, tz=timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def build_payload(value: bool, read_at: float, read_ms: float) -> dict[str, Any]:
    """One genuine reading → the canonical batch (HMAC path: no body tenant)."""
    entry = build_tag_entry(
        TAG_PATH,
        bool(value),
        value_type="bool",
        quality="good",
        ts=utc_iso(read_at),
        metadata={
            "producer": "plc/live-plc-bridge/cv101_relay_poller.py",
            "plc_host": PLC_HOST,
            "modbus_unit": PLC_UNIT,
            "modbus_function": 1,
            "modbus_coil": "000023",
            "plc_variable": "_IO_EM_DI_05",
            "slave_map": "MbSrvConf_v4 slave-map v2",
            "read_ms": round(read_ms, 1),
        },
    )
    return build_ingest_batch(SOURCE_SYSTEM, [entry], source_connection_id=SOURCE_CONNECTION_ID)


def should_post(value: bool, last_value: Optional[bool], last_post: float, now: float) -> bool:
    return last_value is None or value != last_value or (now - last_post) >= HEARTBEAT_S


def post(http: Any, payload: dict[str, Any], tenant: str, key: str) -> tuple[int, dict]:
    """Sign the exact bytes and POST them on a kept-alive client (one TLS handshake)."""
    body = json.dumps(payload, separators=(",", ":")).encode()
    headers = {"Content-Type": "application/json", **sign_hmac_headers(tenant, body, key)}
    r = http.post(INGEST_URL, content=body, headers=headers)
    try:
        return r.status_code, r.json()
    except ValueError:
        return r.status_code, {"raw": r.text[:200]}


def run() -> None:
    import httpx
    from pymodbus.client import ModbusTcpClient

    tenant, key = load_credentials()
    http = httpx.Client(timeout=10)
    log.info(
        "start: PLC %s:%d unit %d coil 000023 -> %s (source=%s/%s tag=%s)",
        PLC_HOST,
        PLC_PORT,
        PLC_UNIT,
        INGEST_URL,
        SOURCE_SYSTEM,
        SOURCE_CONNECTION_ID,
        TAG_PATH,
    )
    while True:
        client = ModbusTcpClient(PLC_HOST, port=PLC_PORT, timeout=2, retries=0)
        try:
            if not client.connect():
                raise OSError(f"cannot connect to {PLC_HOST}:{PLC_PORT}")
            if not map_signature_ok(lambda off: read_coil(client, off)):
                log.error("Modbus map signature mismatch — refusing to post; recheck in 60 s")
                client.close()
                time.sleep(60)
                continue
            log.info("connected; map signature OK (v4: DI_05 = coil 000023)")
            last_value: Optional[bool] = None
            last_post = 0.0
            while True:
                t0 = time.time()
                value, exc = read_coil(client, DI05_COIL_OFFSET)
                read_at = time.time()
                if value is None:
                    raise OSError(f"DI_05 read rejected, modbus exception {exc}")
                if should_post(value, last_value, last_post, read_at):
                    code, resp = post(
                        http, build_payload(value, read_at, (read_at - t0) * 1000), tenant, key
                    )
                    ok = code == 200 and resp.get("accepted") == 1
                    (log.info if ok else log.warning)(
                        "post DI_05=%s change=%s http=%s accepted=%s rejected=%s",
                        int(value),
                        last_value is not None and value != last_value,
                        code,
                        resp.get("accepted"),
                        resp.get("rejected"),
                    )
                    last_value, last_post = value, read_at
                time.sleep(max(0.0, POLL_S - (time.time() - t0)))
        except Exception as e:  # noqa: BLE001 — never replay a value; reconnect
            log.warning("read/post failed: %s — posting nothing, reconnect in 2 s", e)
        finally:
            client.close()
        time.sleep(2)


if __name__ == "__main__":
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s"
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    run()
