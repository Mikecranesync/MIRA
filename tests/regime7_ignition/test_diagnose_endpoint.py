"""Endpoint test for GET /api/diagnose -- the in-gateway anomaly detector.

Loads the Jython handler under the regime-7 mock gateway (conftest `mock_ignition_system`),
mocks system.tag.readBlocking to return a chosen live snapshot, and asserts the right
anomaly cards come back. Proves the full wiring: read allowlisted tags -> tag_topic_map ->
diagnose_core.evaluate -> JSON cards. (The rule logic itself is covered by
test_diagnose_parity.py; this proves the endpoint plumbing.)
"""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

import pytest
from unittest.mock import MagicMock


class MockQualifiedValue:
    """Minimal Ignition QualifiedValue stand-in (value + .quality.isGood())."""

    def __init__(self, value, quality="Good"):
        self.value = value
        self.quality = MagicMock()
        self.quality.isGood.return_value = quality == "Good"


REPO = Path(__file__).resolve().parents[2]
HANDLER = REPO / "ignition" / "webdev" / "FactoryLM" / "api" / "diagnose" / "doGet.py"
ALLOWLIST = REPO / "ignition" / "project" / "approved_tags.json"

# Healthy [default]Conveyor leaf values; tests override one signal to trigger a fault.
HEALTHY = {
    "Motor_Running": False, "VFD_Comm_OK": True, "EStop_Active": False,
    "EStop_Wiring_Fault": False, "Dir_FWD": False, "Dir_REV": False,
    "Raw_I02": True, "Raw_I03": False, "Raw_O02": True,
    "VFD_Hz": 30.0, "VFD_Amps": 0.6, "VFD_DCBus_V": 320.0,
    "VFD_CmdWord": 1, "VFD_FaultCode": 0, "VFD_Setpoint_Hz": 30.0,
}


def _load_handler():
    spec = importlib.util.spec_from_file_location("diagnose_doget", str(HANDLER))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.system = sys.modules["system"]   # inject Ignition's `system` global (mock from conftest)
    return mod.doGet


def _install_reads(system, leaf_values, all_bad=False):
    """Make system.tag.readBlocking return values keyed by each requested tag's leaf name."""
    def fake_read(paths):
        out = []
        for p in paths:
            leaf = str(p).rsplit("/", 1)[1]
            val = leaf_values.get(leaf, 0)
            out.append(MockQualifiedValue(val, "Bad" if all_bad else "Good"))
        return out
    system.tag.readBlocking = fake_read


@pytest.fixture(autouse=True)
def _point_allowlist(monkeypatch):
    monkeypatch.setenv("MIRA_ALLOWLIST_PATH", str(ALLOWLIST))


def _call(system, leaf_values, all_bad=False, asset="[default]Conveyor"):
    _install_reads(system, leaf_values, all_bad=all_bad)
    resp = _load_handler()({"params": {"asset": asset}}, {})
    return resp["json"]


def test_healthy_returns_no_anomalies(mock_ignition_system):
    body = _call(mock_ignition_system, HEALTHY)
    assert body["tag_count"] > 0 and body["good_count"] > 0
    assert body["anomaly_count"] == 0, body["anomalies"]


def test_comm_down_fires_a1(mock_ignition_system):
    vals = dict(HEALTHY); vals["VFD_Comm_OK"] = False
    body = _call(mock_ignition_system, vals)
    ids = [c["rule_id"] for c in body["anomalies"]]
    assert "A1_COMM_STALE" in ids, ids
    assert body["anomalies"][[c["rule_id"] for c in body["anomalies"]].index("A1_COMM_STALE")]["severity"] == "CRITICAL"


def test_estop_wiring_fires_a3(mock_ignition_system):
    vals = dict(HEALTHY); vals["EStop_Wiring_Fault"] = True
    body = _call(mock_ignition_system, vals)
    assert "A3_ESTOP_WIRING" in [c["rule_id"] for c in body["anomalies"]]


def test_direction_conflict_fires_a4(mock_ignition_system):
    vals = dict(HEALTHY); vals["Dir_FWD"] = True; vals["Dir_REV"] = True
    body = _call(mock_ignition_system, vals)
    assert "A4_DIRECTION_FAULT" in [c["rule_id"] for c in body["anomalies"]]


def test_gs10_fault_decodes_a2(mock_ignition_system):
    vals = dict(HEALTHY); vals["VFD_FaultCode"] = 58  # CE10
    body = _call(mock_ignition_system, vals)
    a2 = [c for c in body["anomalies"] if c["rule_id"] == "A2_VFD_FAULT"]
    assert a2 and "CE10" in a2[0]["message"]


def test_all_bad_quality_fires_a0_offline(mock_ignition_system):
    body = _call(mock_ignition_system, HEALTHY, all_bad=True)
    assert body["good_count"] == 0
    assert "A0_OFFLINE" in [c["rule_id"] for c in body["anomalies"]]
