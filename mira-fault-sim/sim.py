"""MIRA Conveyor Fault Detective — sensor + vision + fuse simulator.

Owns the virtual half of the demo: PE-101 / PE-102 / PX-101 photoeyes,
Fuse F2/F3 power branches, Zone 2 vision feed, debounce counters, and a
synthetic conveyor "waiting on" state. The real Micro820 + GS10 VFD state
is published to MQTT by Node-RED's Modbus ingest flow; this service does
not touch the PLC.

REST:
    POST /inject/<mode>     switch the active fault scenario
    GET  /state             current scenario + last published values
    GET  /modes             list available fault modes
    GET  /health            healthcheck

MQTT topic shape (UNS-style, prefix from $UNS_PREFIX):
    {prefix}/sensors/{pe101|pe102|px101}/{raw|debounced|dropout_count}
    {prefix}/power/{fuse_f2|fuse_f3}/status
    {prefix}/vision/zone2/{object_present|object_motion}
    {prefix}/state/waiting_on
    {prefix}/sim/active_mode
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Optional

import aiomqtt
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s %(levelname)s sim: %(message)s")
log = logging.getLogger("fault-sim")

MQTT_HOST = os.getenv("MQTT_HOST", "mosquitto")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
UNS_PREFIX = os.getenv("UNS_PREFIX", "demo/cell1/conveyor/cv101").rstrip("/")
PUBLISH_INTERVAL_MS = int(os.getenv("PUBLISH_INTERVAL_MS", "200"))

FAULT_MODES = [
    "normal",
    "jam",
    "dirty_sensor",
    "misaligned",
    "f2_blown",
    "pe101_brown_break",
    "pe101_blue_break",
    "pe101_black_break",
    "loose_terminal",
    "debounce_chatter",
    "vfd_no_motion",
    "vision_no_sensor",
    "sensor_no_vision",
]


@dataclass
class SensorState:
    raw: bool = False
    debounced: bool = False
    dropout_count: int = 0
    last_change_ts: float = 0.0


@dataclass
class SimState:
    mode: str = "normal"
    started_ts: float = field(default_factory=time.time)
    tick: int = 0

    pe101: SensorState = field(default_factory=SensorState)
    pe102: SensorState = field(default_factory=SensorState)
    px101: SensorState = field(default_factory=SensorState)

    fuse_f2_ok: bool = True
    fuse_f3_ok: bool = True

    vision_object_present: bool = False
    vision_object_motion: bool = False

    waiting_on: str = "nothing"


def _stamp(value, source: str = "sim") -> str:
    """Wrap a value in the same envelope every topic uses."""
    return json.dumps({"value": value, "ts": time.time(), "source": source}, separators=(",", ":"))


def _product_cycle(t: float) -> tuple[bool, bool, bool, bool, bool]:
    """Deterministic 4-second product cycle through Zone 1 → Zone 2.

    Returns: (pe101_blocked, pe102_blocked, px101_present, vision_present, vision_motion)
    """
    phase = (t % 4.0) / 4.0
    pe101 = 0.05 < phase < 0.35
    pe102 = 0.40 < phase < 0.70
    px101 = 0.45 < phase < 0.65
    vision_present = 0.30 < phase < 0.80
    vision_motion = vision_present
    return pe101, pe102, px101, vision_present, vision_motion


def _apply_mode(s: SimState, t: float) -> None:
    """Mutate s in place to reflect the active scenario for tick at time t."""
    pe101_true, pe102_true, px101_true, vis_pres, vis_motion = _product_cycle(t - s.started_ts)

    s.pe101.raw = pe101_true
    s.pe102.raw = pe102_true
    s.px101.raw = px101_true
    s.fuse_f2_ok = True
    s.fuse_f3_ok = True
    s.vision_object_present = vis_pres
    s.vision_object_motion = vis_motion
    s.waiting_on = "nothing"

    m = s.mode
    if m == "normal":
        pass

    elif m == "jam":
        # Product stuck under PE-102 in Zone 2; PE-102 stays blocked,
        # PE-101 still sees prior products, vision sees motionless object.
        s.pe102.raw = True
        s.vision_object_present = True
        s.vision_object_motion = False
        s.waiting_on = "PE-102 blocked >5s (suspected jam in Zone 2)"

    elif m == "dirty_sensor":
        # PE-102 reports blocked but camera sees an empty belt.
        s.pe102.raw = True
        s.vision_object_present = False
        s.vision_object_motion = False
        s.waiting_on = "PE-102 blocked but vision sees no product"

    elif m == "misaligned":
        # Camera confirms product passing, but PE-101 chatters/misses.
        s.pe101.raw = pe101_true and (int((t - s.started_ts) * 10) % 4 != 0)
        s.vision_object_present = vis_pres
        s.vision_object_motion = vis_motion
        s.waiting_on = "PE-101 missing product passes (alignment suspect)"

    elif m == "f2_blown":
        # Whole Fuse F2 branch dead — PE-101, PE-102, PX-101 all read false.
        s.pe101.raw = False
        s.pe102.raw = False
        s.px101.raw = False
        s.fuse_f2_ok = False
        s.waiting_on = "Fuse F2 branch — all sensors dark"

    elif m in {"pe101_brown_break", "pe101_blue_break", "pe101_black_break"}:
        # Only PE-101 dies, peers on the same fuse remain healthy.
        s.pe101.raw = False
        s.waiting_on = f"PE-101 wiring fault ({m.split('_', 1)[1]})"

    elif m == "loose_terminal":
        # Raw PE-101 has short dropouts unrelated to product/camera.
        # Independent random pattern, peers stable.
        chatter_phase = (t * 7) % 1.0
        s.pe101.raw = pe101_true and chatter_phase > 0.18
        s.waiting_on = "PE-101 intermittent (loose terminal suspect)"

    elif m == "debounce_chatter":
        # Aggressive chatter: 6+ drops/sec on raw, peers fine.
        chatter_phase = (t * 12) % 1.0
        s.pe101.raw = pe101_true and chatter_phase > 0.30
        s.waiting_on = "PE-101 raw chatter (>5 drops/sec)"

    elif m == "vfd_no_motion":
        # Belt slip / coupling — VFD live but vision sees no motion.
        # PEs cycle but vision motion=False.
        s.vision_object_motion = False
        s.waiting_on = "VFD running but no belt motion detected"

    elif m == "vision_no_sensor":
        # Output wire / TB2 / I0.3 issue — camera sees product, PE-101 silent.
        s.pe101.raw = False
        s.vision_object_present = vis_pres
        s.vision_object_motion = vis_motion
        s.waiting_on = "Vision sees product but PE-101 LED detect → PLC silent"

    elif m == "sensor_no_vision":
        # PE-101 blocked but camera sees no product → dirty/misadjusted family.
        s.pe101.raw = True
        s.vision_object_present = False
        s.vision_object_motion = False
        s.waiting_on = "PE-101 blocked but vision empty"

    else:
        log.warning("unknown mode %s, falling back to normal", m)
        s.mode = "normal"


def _debounce(sensor: SensorState, t: float, window_s: float = 0.05) -> None:
    """50ms debounce. Counts every raw→False transition into dropout_count."""
    if sensor.raw != sensor.debounced:
        if t - sensor.last_change_ts >= window_s:
            if sensor.debounced and not sensor.raw:
                sensor.dropout_count += 1
            sensor.debounced = sensor.raw
            sensor.last_change_ts = t


async def _publish_state(client: aiomqtt.Client, s: SimState) -> None:
    base = UNS_PREFIX
    pubs: list[tuple[str, str]] = [
        (f"{base}/sensors/pe101/raw", _stamp(s.pe101.raw)),
        (f"{base}/sensors/pe101/debounced", _stamp(s.pe101.debounced)),
        (f"{base}/sensors/pe101/dropout_count", _stamp(s.pe101.dropout_count)),
        (f"{base}/sensors/pe102/raw", _stamp(s.pe102.raw)),
        (f"{base}/sensors/pe102/debounced", _stamp(s.pe102.debounced)),
        (f"{base}/sensors/pe102/dropout_count", _stamp(s.pe102.dropout_count)),
        (f"{base}/sensors/px101/raw", _stamp(s.px101.raw)),
        (f"{base}/sensors/px101/debounced", _stamp(s.px101.debounced)),
        (f"{base}/sensors/px101/dropout_count", _stamp(s.px101.dropout_count)),
        (f"{base}/power/fuse_f2/status", _stamp("ok" if s.fuse_f2_ok else "blown")),
        (f"{base}/power/fuse_f3/status", _stamp("ok" if s.fuse_f3_ok else "blown")),
        (f"{base}/vision/zone2/object_present", _stamp(s.vision_object_present)),
        (f"{base}/vision/zone2/object_motion", _stamp(s.vision_object_motion)),
        (f"{base}/state/waiting_on", _stamp(s.waiting_on)),
        (f"{base}/sim/active_mode", _stamp(s.mode)),
    ]
    for topic, payload in pubs:
        await client.publish(topic, payload, qos=0, retain=True)


async def _sim_loop(state: SimState, stop: asyncio.Event) -> None:
    period = PUBLISH_INTERVAL_MS / 1000.0
    last_failure_log = 0.0
    while not stop.is_set():
        t = time.time()
        try:
            async with aiomqtt.Client(MQTT_HOST, port=MQTT_PORT, identifier="mira-fault-sim") as client:
                log.info("connected to MQTT %s:%d, prefix=%s", MQTT_HOST, MQTT_PORT, UNS_PREFIX)
                while not stop.is_set():
                    t = time.time()
                    _apply_mode(state, t)
                    _debounce(state.pe101, t)
                    _debounce(state.pe102, t)
                    _debounce(state.px101, t)
                    state.tick += 1
                    await _publish_state(client, state)
                    await asyncio.sleep(period)
        except aiomqtt.MqttError as e:
            if t - last_failure_log > 5.0:
                log.warning("MQTT error: %s — retrying in 2s", e)
                last_failure_log = t
            await asyncio.sleep(2.0)


SIM: SimState = SimState()
_STOP = asyncio.Event()
_TASK: Optional[asyncio.Task] = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _TASK
    _STOP.clear()
    _TASK = asyncio.create_task(_sim_loop(SIM, _STOP))
    log.info("simulator loop started, mode=%s", SIM.mode)
    try:
        yield
    finally:
        _STOP.set()
        if _TASK:
            try:
                await asyncio.wait_for(_TASK, timeout=3.0)
            except asyncio.TimeoutError:
                _TASK.cancel()


app = FastAPI(title="MIRA Fault Sim", lifespan=lifespan)


@app.get("/health")
def health():
    return {"ok": True, "mode": SIM.mode, "tick": SIM.tick}


@app.get("/modes")
def modes():
    return {"modes": FAULT_MODES}


@app.get("/state")
def get_state():
    return {
        "mode": SIM.mode,
        "tick": SIM.tick,
        "waiting_on": SIM.waiting_on,
        "pe101": {"raw": SIM.pe101.raw, "debounced": SIM.pe101.debounced, "dropouts": SIM.pe101.dropout_count},
        "pe102": {"raw": SIM.pe102.raw, "debounced": SIM.pe102.debounced, "dropouts": SIM.pe102.dropout_count},
        "px101": {"raw": SIM.px101.raw, "debounced": SIM.px101.debounced, "dropouts": SIM.px101.dropout_count},
        "fuse_f2_ok": SIM.fuse_f2_ok,
        "fuse_f3_ok": SIM.fuse_f3_ok,
        "vision": {"present": SIM.vision_object_present, "motion": SIM.vision_object_motion},
    }


@app.post("/inject/{mode}")
def inject(mode: str):
    if mode not in FAULT_MODES:
        raise HTTPException(status_code=400, detail=f"unknown mode {mode}; valid: {FAULT_MODES}")
    SIM.mode = mode
    SIM.started_ts = time.time()
    SIM.pe101.dropout_count = 0
    SIM.pe102.dropout_count = 0
    SIM.px101.dropout_count = 0
    log.info("inject mode=%s", mode)
    return JSONResponse({"ok": True, "mode": mode})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8089, log_level=LOG_LEVEL.lower())
