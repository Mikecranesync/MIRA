"""Parity + drift guard for the in-gateway anomaly diagnose core.

The A0-A12 rules have ONE source of truth, `plc/conv_simple_anomaly/rules_core.py`, written
to run identically under CPython 3.12 (the bench) and Jython 2.7 (the Ignition gateway). For
the gateway, that file is VENDORED verbatim as
`ignition/webdev/FactoryLM/api/diagnose/diagnose_core.py` (the gateway can't reach plc/).

This test enforces two things so the two copies never silently diverge:
  1. **Behavior goldens** -- each rule fires on a representative snapshot with the right
     rule_id + severity, and a healthy snapshot stays silent.
  2. **Drift guard** -- the vendored gateway copy is byte-identical to rules_core.py, AND it
     imports + produces identical output under CPython. Edit rules_core.py without re-copying
     and this fails (re-sync: `cp plc/conv_simple_anomaly/rules_core.py
     ignition/webdev/FactoryLM/api/diagnose/diagnose_core.py`).

Same discipline as bot-grounding-tests for the retrieval layer.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
RULES_CORE = REPO / "plc" / "conv_simple_anomaly" / "rules_core.py"
VENDORED = REPO / "ignition" / "webdev" / "FactoryLM" / "api" / "diagnose" / "diagnose_core.py"


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, str(path))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def core():
    return _load(RULES_CORE, "rules_core_under_test")


# (rule_id, expected_severity, snap, derived) -- each minimal snapshot triggers exactly that rule.
GOLDENS = [
    ("A0_OFFLINE", "CRITICAL", {}, {"max_stale_s": 35.0}),
    ("A1_COMM_STALE", "CRITICAL", {"vfd/vfd101/comm_ok": False}, {}),
    ("A2_VFD_FAULT", "HIGH", {"vfd/vfd101/comm_ok": True, "vfd/vfd101/fault_code": 58}, {}),
    ("A2_VFD_FAULT", "CRITICAL", {"vfd/vfd101/comm_ok": True, "vfd/vfd101/fault_code": 7}, {}),  # ovA is hard-trip
    ("A3_ESTOP_WIRING", "HIGH",
     {"plc/di/di02_estop_nc": True, "plc/di/di03_estop_no": True}, {}),
    ("A4_DIRECTION_FAULT", "MEDIUM",
     {"plc/di/di00_fwd": True, "plc/di/di01_rev": True}, {}),
    ("A5_ILLEGAL_RUN", "HIGH",
     {"motor/m101/running": True, "safety/estop": True}, {}),
    ("A6_DRIVE_NOT_RESPONDING", "MEDIUM",
     {"vfd/vfd101/comm_ok": True, "vfd/vfd101/cmd_word": 18, "motor/m101/running": False},
     {"cmd_run_for_s": 4.0}),
    ("A7_FREQ_NOT_TRACKING", "MEDIUM",
     {"vfd/vfd101/comm_ok": True, "vfd/vfd101/cmd_word": 18,
      "vfd/vfd101/freq_setpoint": 30.0, "vfd/vfd101/freq": 10.0},
     {"cmd_run_for_s": 6.0}),
    ("A8_OVERCURRENT", "HIGH",
     {"vfd/vfd101/comm_ok": True, "vfd/vfd101/current_a": 6.0}, {}),
    ("A9_DC_BUS", "MEDIUM",
     {"vfd/vfd101/comm_ok": True, "vfd/vfd101/dc_bus_v": 200.0}, {}),
    ("A10_FREQ_STUCK_ZERO", "MEDIUM",
     {"vfd/vfd101/comm_ok": True, "vfd/vfd101/cmd_word": 18, "vfd/vfd101/freq": 0.0},
     {"cmd_run_for_s": 6.0}),
    ("A12_PHOTOEYE_JAM", "HIGH", {"safety/pe_latched": True}, {}),
]


@pytest.mark.parametrize("rule_id,severity,snap,derived", GOLDENS,
                         ids=[g[0] + "_" + g[1] for g in GOLDENS])
def test_rule_fires(core, rule_id, severity, snap, derived):
    fired = {a.rule_id: a for a in core.evaluate(snap, derived)}
    assert rule_id in fired, "expected %s; got %s" % (rule_id, sorted(fired))
    assert fired[rule_id].severity == severity
    # every card must be JSON-serializable (the WebDev response contract)
    card = fired[rule_id].to_dict()
    assert card["rule_id"] == rule_id and card["confidence"] > 0


def test_healthy_is_silent(core):
    healthy = {
        "vfd/vfd101/comm_ok": True, "motor/m101/running": False,
        "plc/di/di02_estop_nc": True, "plc/di/di03_estop_no": False,
        "plc/di/di00_fwd": False, "plc/di/di01_rev": False,
        "vfd/vfd101/freq": 30.0, "vfd/vfd101/freq_setpoint": 30.0,
        "vfd/vfd101/current_a": 0.6, "vfd/vfd101/dc_bus_v": 320.0,
        "vfd/vfd101/cmd_word": 1, "vfd/vfd101/fault_code": 0,
    }
    assert core.evaluate(healthy, {"max_stale_s": 0.5}) == []


def test_all_twelve_rules_present(core):
    assert len(core.RULES) == 12
    fired_ids = set()
    for _id, _sev, snap, derived in GOLDENS:
        fired_ids.update(a.rule_id for a in core.evaluate(snap, derived))
    expected = {g[0] for g in GOLDENS}
    assert expected <= fired_ids


# --- drift guard: vendored gateway copy must not diverge ---
def test_vendored_copy_is_byte_identical():
    assert VENDORED.exists(), "missing vendored gateway copy: %s" % VENDORED
    assert RULES_CORE.read_bytes() == VENDORED.read_bytes(), (
        "diagnose_core.py has drifted from rules_core.py -- re-sync with:\n"
        "  cp plc/conv_simple_anomaly/rules_core.py "
        "ignition/webdev/FactoryLM/api/diagnose/diagnose_core.py")


def test_vendored_copy_imports_and_matches(core):
    vend = _load(VENDORED, "diagnose_core_under_test")
    for _id, _sev, snap, derived in GOLDENS:
        a = [x.rule_id for x in core.evaluate(snap, derived)]
        b = [x.rule_id for x in vend.evaluate(snap, derived)]
        assert a == b
