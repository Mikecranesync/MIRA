#!/usr/bin/env python3
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  ⚠️  BENCH / DEVELOPER TOOL — NEVER SHIPPED TO CUSTOMERS                  ║
# ║                                                                          ║
# ║  This service polls Modbus TCP DIRECTLY from a MIRA-named container.    ║
# ║  That implies an architecture (MIRA reaches into the plant LAN) we      ║
# ║  explicitly do NOT sell — customer PLC reads go through Ignition, not   ║
# ║  through a MIRA container. This bridge lives only on the bench, and     ║
# ║  exists to drive the Fault-Detective demo and instrument the Micro 820 ║
# ║  while we build out the ladder logic.                                   ║
# ║                                                                          ║
# ║  Do NOT reference from a customer-facing docker-compose. The customer-  ║
# ║  facing live tag path is the Ignition Module's gateway-script           ║
# ║  tag-stream.py → mira-relay (HMAC-signed, outbound-only TLS).           ║
# ║                                                                          ║
# ║  Already enforces FC3 reads only (no Modbus writes). Do not add writes. ║
# ║                                                                          ║
# ║  Rules: .claude/rules/fieldbus-readonly.md                              ║
# ║  Architecture: docs/mira-ignition-secure-architecture.md §8 #4, §10.2  ║
# ╚══════════════════════════════════════════════════════════════════════════╝
"""
live-plc-bridge -- Stream A of the Fault-Detective live PLC ingest. (BENCH-ONLY)

Polls the bench Micro 820 Modbus TCP slave (Conv_Simple_1.5 firmware) and
republishes the unpacked values to MQTT so the Node-RED "PLC I/O panel" can
show real GS10 / Micro 820 data alongside the simulator-driven scenario HMI.

This is the symmetric, real-data counterpart to ``mira-fault-sim``. A second,
independent ingest (the Node-RED Modbus flow) publishes the same logical
signals under ``_streams/nr/``; the dashboard selector picks between them and
fails over. This service tags everything ``source="plc-bridge"`` and publishes
under ``_streams/bridge/``.

Live map (authoritative: MIRA_PLC specs/connections/PLC_MODBUS_TCP.md, verified
2026-05-28). pymodbus uses 0-based offsets; the Micro 820 rejects any read that
spans an unmapped address, so we read only the mapped blocks:

    coils:  @0, @3, @5, @9 (singles) + @11..@19 (block of 9)
    HRs:    @106..@109 (block of 4) + @114 (single)

Scope is READ-ONLY -- no coil/HR writes (the GS10 control pipeline is not wired
on the PLC yet). Do not add writes here without updating the connection doc.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from typing import Optional

import aiomqtt
from pymodbus.client import AsyncModbusTcpClient

# -- Config ------------------------------------------------------------------
PLC_HOST = os.getenv("PLC_HOST", "192.168.1.100")
PLC_PORT = int(os.getenv("PLC_PORT", "502"))
PLC_UNIT = int(os.getenv("PLC_UNIT", "1"))
MQTT_HOST = os.getenv("MQTT_HOST", "mosquitto")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
UNS_PREFIX = os.getenv("UNS_PREFIX", "demo/cell1/conveyor/cv101").rstrip("/")
STREAM = os.getenv("STREAM", "bridge")  # publishes under <prefix>/_streams/<STREAM>/
SOURCE = os.getenv("SOURCE", "plc-bridge")
POLL_MS = int(os.getenv("POLL_MS", "500"))
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("live-plc-bridge")

# -- Live Modbus map (0-based pymodbus offsets) ------------------------------
# coil offset -> UNS relative topic. Topics match the NR publish labels + the
# panel's MQTT-in subscriptions so either stream lands on the same widgets.
COIL_TOPICS: dict[int, str] = {
    0: "motor/m101/running",
    3: "vfd/vfd101/comm_ok",
    5: "safety/estop",
    9: "safety/wiring",
    11: "plc/di/di00_fwd",
    12: "plc/di/di01_rev",
    13: "plc/di/di02_estop_nc",
    14: "plc/di/di03_estop_no",
    15: "plc/di/di04_pbrun",
    16: "plc/do/do00_green",
    17: "plc/do/do01_red",
    18: "safety/contactor_q1",
    19: "plc/do/do03_pbrun_led",
    # --- slave-map v2 (A12 photo-eye): PE-101 wired to embedded DI 5, mapped at
    #     coil 000023 = pymodbus offset 22 (offsets 20/21 are the v4.1.x VFD poll
    #     coils vfd_poll_active / vfd_fault_reset_pending, so DI 5 is appended).
    22: "plc/di/di05_photoeye",   # raw photo-eye beam (_IO_EM_DI_05)
    # pe_latched is a ladder-computed latch, not a wired input — enable once the
    # latch rung exists and is mapped to a coil:
    # NN: "safety/pe_latched",     # photo-eye latching soft-stop engaged
}

# HR offset -> (relative topic, scale divisor). vfd_comm_ok (coil 3) is the
# trust gate: when False these HR values are stale from the last good RTU poll.
HR_SPECS: dict[int, tuple[str, float]] = {
    106: ("vfd/vfd101/freq", 100.0),       # output Hz x100
    107: ("vfd/vfd101/current_a", 100.0),  # output A x100
    108: ("vfd/vfd101/voltage_v", 10.0),   # output V x10
    109: ("vfd/vfd101/dc_bus_v", 10.0),    # DC bus V x10
    114: ("vfd/vfd101/cmd_word", 1.0),     # GS10 command echo (1=STOP 18=FWD 20=REV)
    # --- slave-map v2 (A2 fault decode / A7 setpoint): enable after the reflash ---
    # 110: ("vfd/vfd101/fault_raw", 1.0),    # GS10 0x2100: hi byte=warn, lo byte=fault (split in decode)
    # 111: ("vfd/vfd101/freq_setpoint", 100.0),  # GS10 0x2101 freq command x100
}

# Read plan: blocks that are fully mapped (no unmapped address inside a span).
# The Micro 820 rejects a read that spans an unmapped address, so the plan only
# covers mapped blocks. The (22, 1) block picks up the slave-map v2 photo-eye
# (_IO_EM_DI_05) without spanning the VFD poll coils at offsets 20/21. For the
# A2/A7 VFD fault+setpoint HRs, widen HR (106, 6) to pick up 110/111 and
# uncomment the HR_SPECS/COIL_TOPICS above after that reflash.
COIL_READS = [(0, 1), (3, 1), (5, 1), (9, 1), (11, 9), (22, 1)]  # (offset, count)
HR_READS = [(106, 4), (114, 1)]


def decode_coils(coils: dict[int, bool]) -> dict[str, bool]:
    """Map raw coil offsets to UNS-relative topics -> bool. Pure / testable."""
    out: dict[str, bool] = {}
    for off, topic in COIL_TOPICS.items():
        if off in coils:
            out[topic] = bool(coils[off])
    return out


def decode_hrs(hrs: dict[int, int]) -> dict[str, float]:
    """Map raw HR offsets to UNS-relative topics -> scaled value. Pure / testable."""
    out: dict[str, float] = {}
    for off, (topic, div) in HR_SPECS.items():
        if off in hrs:
            raw = hrs[off]
            out[topic] = raw / div if div != 1.0 else raw
    return out


def _envelope(value, ts: Optional[float] = None) -> str:
    """Same envelope every topic uses (see mira-fault-sim)."""
    return json.dumps(
        {"value": value, "ts": ts if ts is not None else time.time(), "source": SOURCE},
        separators=(",", ":"),
    )


async def _read_block(fn, offset: int, count: int):
    # pymodbus renamed the unit kwarg (slave -> device_id) across 3.x; try both,
    # then positional, so the bridge runs on whatever the bench laptop has installed.
    rr = None
    for kw in ({"count": count, "device_id": PLC_UNIT}, {"count": count, "slave": PLC_UNIT}):
        try:
            rr = await fn(offset, **kw)
            break
        except TypeError:
            continue
    if rr is None:
        rr = await fn(offset, count)
    if rr.isError():
        raise IOError(f"modbus read error @{offset} x{count}: {rr}")
    return rr


async def poll_once(client: AsyncModbusTcpClient) -> tuple[dict[int, bool], dict[int, int]]:
    """Read every mapped block and return {offset: value} dicts for coils + HRs."""
    coils: dict[int, bool] = {}
    for off, cnt in COIL_READS:
        rr = await _read_block(client.read_coils, off, cnt)
        for i in range(cnt):
            coils[off + i] = bool(rr.bits[i])

    hrs: dict[int, int] = {}
    for off, cnt in HR_READS:
        rr = await _read_block(client.read_holding_registers, off, cnt)
        for i in range(cnt):
            hrs[off + i] = int(rr.registers[i])
    return coils, hrs


async def run() -> None:
    period = POLL_MS / 1000.0
    base = f"{UNS_PREFIX}/_streams/{STREAM}"
    log.info(
        "live-plc-bridge starting: PLC %s:%d unit %d -> MQTT %s:%d, base=%s, poll=%dms",
        PLC_HOST, PLC_PORT, PLC_UNIT, MQTT_HOST, MQTT_PORT, base, POLL_MS,
    )
    while True:
        try:
            async with aiomqtt.Client(MQTT_HOST, port=MQTT_PORT, identifier="live-plc-bridge") as mqtt:
                client = AsyncModbusTcpClient(PLC_HOST, port=PLC_PORT)
                await client.connect()
                if not client.connected:
                    raise IOError(f"cannot connect to PLC {PLC_HOST}:{PLC_PORT}")
                log.info("connected: PLC + MQTT")
                while True:
                    t0 = time.time()
                    try:
                        coils, hrs = await poll_once(client)
                        ts = time.time()
                        pubs: dict[str, object] = {}
                        pubs.update(decode_coils(coils))
                        pubs.update(decode_hrs(hrs))
                        pubs["plc/link"] = True  # liveness marker for the router
                        for rel, value in pubs.items():
                            await mqtt.publish(f"{base}/{rel}", _envelope(value, ts), qos=0, retain=True)
                    except (IOError, OSError) as e:
                        # PLC unreachable / read rejected: emit a dead-link marker, keep looping
                        log.warning("poll failed: %s", e)
                        await mqtt.publish(f"{base}/plc/link", _envelope(False), qos=0, retain=True)
                    await asyncio.sleep(max(0.0, period - (time.time() - t0)))
        except aiomqtt.MqttError as e:
            log.warning("MQTT error: %s -- reconnecting in 2s", e)
            await asyncio.sleep(2.0)
        except Exception as e:  # noqa: BLE001 -- never let the service die silently
            log.error("unexpected error: %s -- restarting in 2s", e)
            await asyncio.sleep(2.0)


if __name__ == "__main__":
    # On Windows the default ProactorEventLoop lacks add_reader/add_writer, which
    # pymodbus' async client + aiomqtt require. The bench bridge runs on the
    # Windows PLC laptop (only host with a route to 192.168.1.0/24), so select the
    # SelectorEventLoop there. No effect on the Linux container deploy.
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(run())
