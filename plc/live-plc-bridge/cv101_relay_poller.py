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

Live map: `_IO_EM_DI_05` → coil 000023 = pymodbus offset 22. Two maps put it there —
the full plc/MbSrvConf_v4.xml and the sparse bench slave-map v2 actually flashed on
2026-11-02 (ConvSimple coils + 000021..000023; offset 1 unmapped). Every other map
in the repo leaves 000023 unmapped (v3, ConvSimple v1.9, step-1 IO-check, which
puts DI_05 at 000006 and a heartbeat at 000100). So on every (re)connect the poller
requires coil 000023 readable AND coil 000100 rejected with Modbus exception 2; any
other result → it refuses to post. This identifies DI_05 among the repo's known
maps; it cannot detect an unrecorded map that also maps 000023.

Freshness and safety:
  * every posted reading comes from a read completed in that cycle; ts is the
    UTC read-completion time (ms resolution), corrected by an SNTP-measured offset
    when the host clock is unsynced (the bench laptop's Windows Time service is
    stopped — measured 45.6 s slow on 2026-11-02). The raw host time, offset and
    clock source ride in metadata so the correction is auditable, never hidden.
  * on a read/connect failure NOTHING is posted — no last-known value is replayed;
    the server-side 60 s last_seen_at window turns the signal stale.
  * posts on change immediately, otherwise a heartbeat every HEARTBEAT_S.
"""

from __future__ import annotations

import json
import logging
import os
import socket
import struct
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
STEP1_HEARTBEAT_OFFSET = 99  # coil 000100 — mapped only by the step-1 IO-check map
MODBUS_ILLEGAL_ADDRESS = 2
NTP_HOSTS = tuple(
    h for h in os.getenv("NTP_HOSTS", "time.cloudflare.com,time.google.com").split(",") if h
)
NTP_REFRESH_S = 600.0
NTP_MAX_AGE_S = 3600.0  # older than this → stop correcting, fall back to host time
NTP_EPOCH_DELTA = 2208988800
NTP_MAX_ABS_OFFSET_S = 3600.0  # a larger "correction" is treated as a bad reply

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
    """True only for a map that puts `_IO_EM_DI_05` at coil 000023 (see module doc)."""
    if read(DI05_COIL_OFFSET)[0] is None:
        return False
    return read(STEP1_HEARTBEAT_OFFSET)[1] == MODBUS_ILLEGAL_ADDRESS


def sntp_offset(host: str, timeout: float = 2.0) -> Optional[float]:
    """RFC 4330 client: offset (s) to add to the host clock, or None on failure."""
    t1 = time.time()
    request = sntp_request(t1)
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.settimeout(timeout)
            s.sendto(request, (host, 123))
            data, _ = s.recvfrom(512)
            t4 = time.time()
    except OSError:
        return None
    return parse_sntp(data, request, t1, t4, timeout)


def _to_ntp(ts: float) -> bytes:
    sec = int(ts)
    return struct.pack("!II", sec + NTP_EPOCH_DELTA, int((ts - sec) * 2**32) & 0xFFFFFFFF)


def sntp_request(t1: float) -> bytes:
    """Client-mode (LI 0, VN 4, mode 3) request carrying t1 as transmit timestamp."""
    return bytes([0x23]) + bytes(39) + _to_ntp(t1)


def parse_sntp(
    data: bytes, request: bytes, t1: float, t4: float, timeout: float
) -> Optional[float]:
    """Validate a server reply (RFC 4330 §5) and return the offset, else None.

    Rejected: short packet; leap indicator 3 (unsynchronized); mode != 4 (server);
    stratum 0 (kiss-o'-death DENY/RATE/…) or > 15; originate != our transmit
    timestamp (stale/spoofed reply); zero receive/transmit timestamps; negative or
    over-timeout round trip; an implausible offset (> NTP_MAX_ABS_OFFSET_S)."""
    if len(data) < 48:
        return None
    li, mode, stratum = data[0] >> 6, data[0] & 0x07, data[1]
    if li == 3 or mode != 4 or not 1 <= stratum <= 15:
        return None
    if data[24:32] != request[40:48]:
        return None
    if data[32:40] == bytes(8) or data[40:48] == bytes(8):
        return None

    def ntp(off: int) -> float:
        sec, frac = struct.unpack("!II", data[off : off + 8])
        return sec - NTP_EPOCH_DELTA + frac / 2**32

    t2, t3 = ntp(32), ntp(40)
    rtt = (t4 - t1) - (t3 - t2)
    if rtt < 0 or rtt > timeout:
        return None
    offset = ((t2 - t1) + (t3 - t4)) / 2
    return offset if abs(offset) <= NTP_MAX_ABS_OFFSET_S else None


class Clock:
    """True UTC anchored to the monotonic clock at each SNTP measurement.

    A reading is stamped ``anchor_utc + (mono_now - anchor_mono)`` — it tracks
    elapsed monotonic time, so a host-clock step between refreshes (e.g. Windows
    Time starting) neither double-applies the offset nor jumps backwards. The
    effective offset vs the host clock is recorded per reading (auditable)."""

    def __init__(
        self,
        query: Callable[[str], Optional[float]] = sntp_offset,
        wall: Callable[[], float] = time.time,
        mono: Callable[[], float] = time.monotonic,
    ) -> None:
        self._query, self._wall, self._mono = query, wall, mono
        self.source = "host"
        self._anchor: Optional[tuple[float, float]] = None  # (utc, mono)
        self._tried = float("-inf")

    def refresh(self) -> None:
        now = self._mono()
        if now - self._tried < NTP_REFRESH_S:
            return
        self._tried = now
        for host in NTP_HOSTS:
            off = self._query(host)
            if off is not None:
                self._anchor = (self._wall() + off, self._mono())
                self.source = f"sntp:{host}"
                return
        if self._anchor and now - self._anchor[1] > NTP_MAX_AGE_S:
            self._anchor, self.source = None, "host"

    def stamp(self, host_ts: float, mono_ts: float) -> tuple[float, dict[str, Any]]:
        meta: dict[str, Any] = {"host_clock_utc": utc_iso(host_ts), "clock_source": self.source}
        if self._anchor is None:
            return host_ts, meta
        utc = self._anchor[0] + (mono_ts - self._anchor[1])
        meta["clock_offset_s"] = round(utc - host_ts, 3)
        return utc, meta


def utc_iso(ts: float) -> str:
    return (
        datetime.fromtimestamp(ts, tz=timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def build_payload(
    value: bool, read_at: float, read_ms: float, clock_meta: Optional[dict[str, Any]] = None
) -> dict[str, Any]:
    """One genuine reading → the canonical batch (HMAC path: no body tenant).
    ``read_at`` is the (clock-corrected) UTC read-completion time."""
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
            **(clock_meta or {}),
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
    clock = Clock()
    clock.refresh()
    _, cmeta = clock.stamp(time.time(), time.monotonic())
    log.info("clock: source=%s offset_s=%s", clock.source, cmeta.get("clock_offset_s"))
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
            log.info("connected; map signature OK (DI_05 = coil 000023, no coil 000100)")
            last_value: Optional[bool] = None
            last_post = float("-inf")  # monotonic
            while True:
                clock.refresh()
                t0 = time.monotonic()
                value, exc = read_coil(client, DI05_COIL_OFFSET)
                read_mono, read_wall = time.monotonic(), time.time()
                if value is None:
                    raise OSError(f"DI_05 read rejected, modbus exception {exc}")
                if should_post(value, last_value, last_post, read_mono):
                    stamped, clock_meta = clock.stamp(read_wall, read_mono)
                    payload = build_payload(value, stamped, (read_mono - t0) * 1000, clock_meta)
                    code, resp = post(http, payload, tenant, key)
                    ok = code == 200 and resp.get("accepted") == 1
                    (log.info if ok else log.warning)(
                        "post DI_05=%s change=%s http=%s accepted=%s rejected=%s",
                        int(value),
                        last_value is not None and value != last_value,
                        code,
                        resp.get("accepted"),
                        resp.get("rejected"),
                    )
                    last_value, last_post = value, read_mono
                time.sleep(max(0.0, POLL_S - (time.monotonic() - t0)))
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
