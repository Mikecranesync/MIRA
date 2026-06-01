"""Unit tests for the Conv_Simple machine-card anomaly rules. Run: pytest plc/conv_simple_anomaly/"""
import rules
from rules import evaluate


def healthy_snap():
    return {
        "motor/m101/running": False,
        "vfd/vfd101/comm_ok": True,
        "safety/estop": False,
        "safety/wiring": False,
        "safety/contactor_q1": True,
        "plc/di/di00_fwd": False,
        "plc/di/di01_rev": False,
        "plc/di/di02_estop_nc": True,   # NC healthy = True
        "plc/di/di03_estop_no": False,  # NO healthy = False
        "vfd/vfd101/freq": 0.0,
        "vfd/vfd101/current_a": 0.0,
        "vfd/vfd101/dc_bus_v": 327.0,
        "vfd/vfd101/cmd_word": 1,       # STOP
    }


D0 = {"now": 0.0, "max_stale_s": 0.0, "freq_frozen_s": 0.0, "cmd_run_for_s": 0.0}


def ids(snap, d=D0, cfg=None):
    return {a.rule_id for a in evaluate(snap, d, cfg)}


def test_healthy_is_silent():
    assert ids(healthy_snap()) == set()


def test_running_healthy_is_silent():
    s = healthy_snap()
    s.update({"motor/m101/running": True, "vfd/vfd101/freq": 30.0,
              "vfd/vfd101/current_a": 2.0, "vfd/vfd101/cmd_word": 18, "plc/di/di00_fwd": True})
    assert ids(s) == set()


def test_a0_offline():
    assert "A0_OFFLINE" in ids(healthy_snap(), {**D0, "max_stale_s": 31.0})


def test_a1_comm_loss():
    s = healthy_snap(); s["vfd/vfd101/comm_ok"] = False
    assert "A1_COMM_STALE" in ids(s)


def test_a1_gates_vfd_rules():
    # comm down -> overcurrent/dcbus must be suppressed (values are stale), only A1 fires
    s = healthy_snap()
    s.update({"vfd/vfd101/comm_ok": False, "vfd/vfd101/current_a": 99.0, "vfd/vfd101/dc_bus_v": 10.0})
    got = ids(s)
    assert got == {"A1_COMM_STALE"}


def test_a3_wiring_flag():
    s = healthy_snap(); s["safety/wiring"] = True
    assert "A3_ESTOP_WIRING" in ids(s)


def test_a3_dual_channel_mismatch():
    s = healthy_snap(); s["plc/di/di03_estop_no"] = True   # now both True = mismatch
    assert "A3_ESTOP_WIRING" in ids(s)


def test_a4_direction_fault():
    s = healthy_snap(); s["plc/di/di00_fwd"] = True; s["plc/di/di01_rev"] = True
    assert "A4_DIRECTION_FAULT" in ids(s)


def test_a5_illegal_run_estop():
    s = healthy_snap(); s["motor/m101/running"] = True; s["safety/estop"] = True
    assert "A5_ILLEGAL_RUN" in ids(s)


def test_a5_illegal_run_contactor_open():
    s = healthy_snap(); s["motor/m101/running"] = True; s["safety/contactor_q1"] = False
    assert "A5_ILLEGAL_RUN" in ids(s)


def test_a6_not_responding_after_grace():
    s = healthy_snap(); s["vfd/vfd101/cmd_word"] = 18  # RUN, but motor not running
    assert "A6_DRIVE_NOT_RESPONDING" not in ids(s, {**D0, "cmd_run_for_s": 1.0})  # within grace
    assert "A6_DRIVE_NOT_RESPONDING" in ids(s, {**D0, "cmd_run_for_s": 4.0})      # past grace


def test_a8_overcurrent():
    s = healthy_snap(); s["vfd/vfd101/current_a"] = 7.5  # > default FLA 5.0
    assert "A8_OVERCURRENT" in ids(s)
    # custom FLA raises the bar
    assert "A8_OVERCURRENT" not in ids(s, cfg={"motor_fla_a": 10.0})


def test_a9_dc_bus_low_and_high():
    lo = healthy_snap(); lo["vfd/vfd101/dc_bus_v"] = 120.0
    hi = healthy_snap(); hi["vfd/vfd101/dc_bus_v"] = 999.0
    assert "A9_DC_BUS" in ids(lo)
    assert "A9_DC_BUS" in ids(hi)


def test_a10_freq_stuck_at_zero_fires():
    s = healthy_snap(); s["vfd/vfd101/cmd_word"] = 18  # RUN, freq stuck at 0.0
    assert "A10_FREQ_STUCK_ZERO" in ids(s, {**D0, "cmd_run_for_s": 6.0})
    assert "A10_FREQ_STUCK_ZERO" not in ids(s, {**D0, "cmd_run_for_s": 1.0})  # within grace


def test_a10_no_startup_transient():
    # the instant RUN is pressed (cmd_run_for_s ~0) freq is still 0 after a long idle —
    # must NOT fire even though freq had been frozen at 0 for ages.
    s = healthy_snap(); s["vfd/vfd101/cmd_word"] = 18
    assert "A10_FREQ_STUCK_ZERO" not in ids(s, {**D0, "cmd_run_for_s": 0.5, "freq_frozen_s": 120.0})


def test_a10_steady_speed_does_not_fire():
    # constant NON-zero Hz at steady running must NOT be flagged frozen
    s = healthy_snap(); s.update({"vfd/vfd101/cmd_word": 18, "motor/m101/running": True,
                                  "vfd/vfd101/freq": 30.0, "vfd/vfd101/current_a": 2.0})
    assert "A10_FREQ_STUCK_ZERO" not in ids(s, {**D0, "freq_frozen_s": 60.0})
    assert ids(s, {**D0, "freq_frozen_s": 60.0}) == set()  # fully healthy running


def test_confidence_mapping():
    a = rules.r_a1_comm({"vfd/vfd101/comm_ok": False}, D0, rules.DEFAULT_CFG)
    assert a.confidence == 1.0  # CRITICAL
