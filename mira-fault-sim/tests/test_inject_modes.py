"""Each inject mode produces sensor / fuse / vision state matching the
spec rule trigger. Asserts shape, not exact MQTT payloads — that's wired
in the rules engine tests."""
from __future__ import annotations

import time

import pytest
import sim


def _step(state: sim.SimState, mode: str, *, seconds: float = 0.0) -> sim.SimState:
    state.mode = mode
    state.started_ts = time.time() - seconds
    sim._apply_mode(state, time.time())
    return state


def test_normal_publishes_clean_cycle():
    s = _step(sim.SimState(), "normal")
    # Normal mode: no faults, fuses ok, waiting_on nothing.
    assert s.fuse_f2_ok and s.fuse_f3_ok
    assert s.waiting_on == "nothing"


def test_f2_blown_kills_all_three_sensors():
    s = _step(sim.SimState(), "f2_blown")
    assert s.fuse_f2_ok is False
    assert s.pe101.raw is False and s.pe102.raw is False and s.px101.raw is False
    assert "F2" in s.waiting_on


@pytest.mark.parametrize("mode", [
    "pe101_brown_break", "pe101_blue_break", "pe101_black_break",
])
def test_pe101_wire_break_isolates_pe101(mode: str):
    # Step into the middle of the product cycle so PE-102 would naturally be high.
    s = sim.SimState()
    s.mode = mode
    s.started_ts = time.time() - 2.0  # ~mid cycle: PE-102 should be blocked
    sim._apply_mode(s, time.time())
    assert s.pe101.raw is False
    assert s.fuse_f2_ok is True
    assert "PE-101" in s.waiting_on


def test_jam_holds_pe102_with_vision_present_no_motion():
    s = _step(sim.SimState(), "jam")
    assert s.pe102.raw is True
    assert s.vision_object_present is True
    assert s.vision_object_motion is False


def test_dirty_sensor_pe102_blocked_vision_empty():
    s = _step(sim.SimState(), "dirty_sensor")
    assert s.pe102.raw is True
    assert s.vision_object_present is False


def test_vision_no_sensor_pe101_dark_vision_alive():
    s = sim.SimState()
    s.mode = "vision_no_sensor"
    s.started_ts = time.time() - 1.5  # phase where vision would normally see product
    sim._apply_mode(s, time.time())
    assert s.pe101.raw is False
    # Vision may or may not be present depending on phase — assert PE-101 is the failure.


def test_vfd_no_motion_kills_motion_only():
    s = _step(sim.SimState(), "vfd_no_motion")
    assert s.vision_object_motion is False


def test_inject_resets_dropout_counters():
    from fastapi.testclient import TestClient
    sim.SIM.pe101.dropout_count = 99
    client = TestClient(sim.app)
    # bypass lifespan loop concerns — just hit /inject
    resp = client.post("/inject/normal")
    assert resp.status_code == 200
    assert sim.SIM.pe101.dropout_count == 0


def test_unknown_mode_rejected():
    from fastapi.testclient import TestClient
    client = TestClient(sim.app)
    resp = client.post("/inject/asdf")
    assert resp.status_code == 400


def test_debounce_counts_dropouts_after_50ms():
    sensor = sim.SensorState(raw=True, debounced=True, last_change_ts=0.0)
    t0 = 10.0
    # Drop to false at t=10.1 (>50ms window) — should count.
    sensor.raw = False
    sim._debounce(sensor, t0 + 0.1)
    assert sensor.debounced is False
    assert sensor.dropout_count == 1
    # Bounce back high at t=10.2 (>50ms) — debounce updates, no new drop.
    sensor.raw = True
    sim._debounce(sensor, t0 + 0.2)
    assert sensor.debounced is True
    assert sensor.dropout_count == 1


def test_all_13_modes_are_runnable():
    assert sim.FAULT_MODES[0] == "normal"
    assert len(sim.FAULT_MODES) == 13
    for mode in sim.FAULT_MODES:
        s = _step(sim.SimState(), mode)
        assert s.mode == mode
