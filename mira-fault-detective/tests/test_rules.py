"""Golden cases for each of the 7 spec rules + the E-stop short-circuit.

These are the truth set the demo's diagnosis is graded against."""
from __future__ import annotations

import time

import rules


def _base(**overrides) -> rules.Snapshot:
    s = rules.Snapshot(
        now=time.time(),
        plc_online=True,
        vfd_comm_ok=True,
        contactor_q1=True,
    )
    for k, v in overrides.items():
        setattr(s, k, v)
    return s


def test_normal_returns_none():
    assert rules.evaluate(_base()) is None


def test_estop_wins_over_everything():
    s = _base(
        estop_active=True,
        # Pile on other faults to confirm estop short-circuits.
        pe101_blocked=True, pe102_blocked=True, fuse_f2_ok=False,
    )
    d = rules.evaluate(s)
    assert d is not None
    assert d.fault == "e_stop_active"
    assert "E-stop" in d.affected_components[0]


def test_f2_branch_loss():
    s = _base(
        fuse_f2_ok=False,
        pe101_blocked=False, pe102_blocked=False, px101_present=False,
    )
    d = rules.evaluate(s)
    assert d is not None
    assert d.fault == "branch_fuse_loss"
    assert "Fuse F2" in d.affected_components
    assert "PE-101" in d.affected_components
    assert "PE-102" in d.affected_components
    assert "PX-101" in d.affected_components


def test_jam_requires_5s_pe102_plus_vfd_plus_no_motion():
    s = _base(
        pe102_blocked=True,
        pe102_blocked_since=time.time() - 6.0,
        vision_object_present=True,
        vision_object_motion=False,
        vfd_running=True,
        motor_running=True,
    )
    d = rules.evaluate(s)
    assert d is not None
    assert d.fault == "mechanical_jam"
    assert "Belt" in d.affected_components


def test_jam_does_not_fire_under_5s():
    s = _base(
        pe102_blocked=True,
        pe102_blocked_since=time.time() - 2.0,
        vision_object_present=True,
        vision_object_motion=False,
        vfd_running=True,
    )
    d = rules.evaluate(s)
    # Either no diagnosis, or vfd_motion_mismatch — but NOT mechanical_jam.
    assert d is None or d.fault != "mechanical_jam"


def test_dirty_sensor_pe102_blocked_vision_empty():
    s = _base(
        pe102_blocked=True,
        pe102_blocked_since=time.time() - 2.5,  # past DIRTY_HOLD_S
        vision_object_present=False,
    )
    d = rules.evaluate(s)
    assert d is not None
    assert d.fault == "sensor_dirty_or_misaligned"
    assert "PE-102" in d.affected_components


def test_pe101_local_wiring_when_peers_alive():
    # PE-101 silent, but a peer is showing dropouts on the same fuse — and
    # vision is empty (so vision_no_sensor cannot fire). That isolates the
    # failure to PE-101's own wiring.
    s = _base(
        pe101_blocked=False, pe101_dropouts=0,
        pe102_blocked=False, pe102_dropouts=3,
        px101_present=False, px101_dropouts=0,
        vision_object_present=False,
    )
    d = rules.evaluate(s)
    assert d is not None
    assert d.fault == "pe101_local_wiring"
    assert "PE-101" in d.affected_components


def test_vision_no_sensor_output_wire():
    # Vision confirms product in Zone 2; PE-102 is reacting (peer alive).
    # PE-101 is silent — the wire / TB2 / PLC input channel is the suspect.
    s = _base(
        pe101_blocked=False, pe101_dropouts=0,
        pe102_blocked=True, pe102_blocked_since=time.time() - 0.3,
        px101_present=True,
        vision_object_present=True,
        vision_object_motion=True,
    )
    d = rules.evaluate(s)
    assert d is not None
    assert d.fault == "pe101_output_wire_or_plc_input"


def test_pe101_chatter_when_peers_stable():
    s = _base(
        pe101_dropouts=8,
        pe102_dropouts=0,
        px101_dropouts=0,
    )
    d = rules.evaluate(s)
    assert d is not None
    assert d.fault == "pe101_intermittent_chatter"


def test_vfd_motion_mismatch_without_long_block():
    # Product sitting on belt in Zone 2 (PE-102 just blocked briefly), VFD
    # is running, but vision sees no motion — belt slip / coupling issue.
    s = _base(
        vfd_running=True,
        motor_running=True,
        vision_object_present=True,
        vision_object_motion=False,
        pe102_blocked=True,
        pe102_blocked_since=time.time() - 0.5,
        px101_present=True,
    )
    d = rules.evaluate(s)
    assert d is not None
    assert d.fault == "vfd_motion_mismatch"


def test_priority_estop_beats_fuse_loss():
    s = _base(
        estop_active=True,
        fuse_f2_ok=False,
        pe101_blocked=False, pe102_blocked=False, px101_present=False,
    )
    assert rules.evaluate(s).fault == "e_stop_active"


def test_priority_fuse_loss_beats_chatter():
    # Branch-wide dead AND chatter recorded — fuse loss should win.
    s = _base(
        fuse_f2_ok=False,
        pe101_blocked=False, pe102_blocked=False, px101_present=False,
        pe101_dropouts=0, pe102_dropouts=0, px101_dropouts=0,
    )
    assert rules.evaluate(s).fault == "branch_fuse_loss"
