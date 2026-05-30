"""Decode/scaling tests for live-plc-bridge.

Truth source: MIRA_PLC specs/connections/PLC_MODBUS_TCP.md (verified 2026-05-28).
The register vector below is the live readback observed this session:
  vfd_comm_ok=True, dc_bus raw 3229 -> 322.9 V, cmd_word=1 (STOP), drive stopped.
"""

import bridge


def test_decode_coils_maps_mapped_offsets():
    coils = {0: True, 3: True, 5: False, 9: False,
             11: False, 12: False, 13: True, 14: False, 15: False,
             16: True, 17: False, 18: True, 19: False}
    out = bridge.decode_coils(coils)
    assert out["motor/m101/running"] is True
    assert out["vfd/vfd101/comm_ok"] is True
    assert out["safety/estop"] is False
    assert out["safety/wiring"] is False
    assert out["plc/di/di02_estop_nc"] is True
    assert out["safety/contactor_q1"] is True       # DO_02 offset 18
    assert out["plc/do/do00_green"] is True          # DO_00 offset 16
    # exactly the 13 mapped points, no extras
    assert len(out) == 13


def test_decode_coils_skips_unmapped_offsets():
    # offsets 1,2,4,6,7,8,10,20,21 are NOT served by the bench PLC
    out = bridge.decode_coils({0: True, 1: True, 2: True})
    assert out == {"motor/m101/running": True}


def test_decode_hrs_scaling():
    # raw live readback: freq/cur/volt = 0 (stopped), dc_bus 3229, cmd_word 1
    hrs = {106: 0, 107: 0, 108: 0, 109: 3229, 114: 1}
    out = bridge.decode_hrs(hrs)
    assert out["vfd/vfd101/freq"] == 0.0          # /100
    assert out["vfd/vfd101/current_a"] == 0.0     # /100
    assert out["vfd/vfd101/voltage_v"] == 0.0     # /10
    assert out["vfd/vfd101/dc_bus_v"] == 322.9    # 3229 / 10
    assert out["vfd/vfd101/cmd_word"] == 1        # no scaling
    assert len(out) == 5


def test_decode_hrs_running_drive():
    # 60.00 Hz, 2.50 A, 230.0 V, 327.0 V DC bus, FWD+RUN
    hrs = {106: 6000, 107: 250, 108: 2300, 109: 3270, 114: 18}
    out = bridge.decode_hrs(hrs)
    assert out["vfd/vfd101/freq"] == 60.0
    assert out["vfd/vfd101/current_a"] == 2.5
    assert out["vfd/vfd101/voltage_v"] == 230.0
    assert out["vfd/vfd101/dc_bus_v"] == 327.0
    assert out["vfd/vfd101/cmd_word"] == 18


def test_read_plans_cover_exactly_the_mapped_points():
    coil_offsets = {off + i for off, cnt in bridge.COIL_READS for i in range(cnt)}
    assert coil_offsets == set(bridge.COIL_TOPICS)
    hr_offsets = {off + i for off, cnt in bridge.HR_READS for i in range(cnt)}
    assert hr_offsets == set(bridge.HR_SPECS)
