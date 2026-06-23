"""Telemetry + Ignition-export tests — deterministic, offline, Conv_Simple-safe."""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PKG = HERE.parent
DEMO = PKG.parent
ROOT = DEMO.parent
for _p in (str(PKG), str(DEMO), str(ROOT / "mqtt_uns")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import ignition_export as ig  # noqa: E402
import run_proveit_demo as rp  # noqa: E402
import sim_plc as sp  # noqa: E402
import telemetry as tel  # noqa: E402

SIM_ASSET_KEYS = {"tank01", "mixer01", "filler01", "capper01", "labeler01", "casepacker01"}


def _events_for(scenario, ticks=60, mqtt=False, live_cell=False):
    tel.run_telemetry(scenario, ticks, mqtt=mqtt, live_cell=live_cell)
    return [json.loads(line) for line in tel.JSONL_PATH.read_text(encoding="utf-8").splitlines() if line]


# --- default offline determinism ----------------------------------------------------------------

def test_default_run_offline_deterministic():
    assert rp.main(["--no-mqtt"]) == 0
    a = (PKG / "reports" / "scenario_map.md").read_text(encoding="utf-8")
    assert rp.main(["--no-mqtt"]) == 0
    b = (PKG / "reports" / "scenario_map.md").read_text(encoding="utf-8")
    assert a == b


def test_telemetry_jsonl_is_deterministic():
    first = tel.JSONL_PATH
    _events_for("filler_jam")
    bytes1 = first.read_bytes()
    _events_for("filler_jam")
    bytes2 = first.read_bytes()
    assert bytes1 == bytes2 and len(bytes1) > 0


# --- simulated PLC telemetry --------------------------------------------------------------------

def test_sim_plc_emits_expected_tags_for_each_asset():
    evs = _events_for("normal")
    assert {e["asset_id"] for e in evs} >= SIM_ASSET_KEYS
    filler_tags = {e["tag_name"] for e in evs if e["asset_id"] == "filler01"}
    assert {"status", "running", "bottles_filled", "bottles_per_min", "jam_detected"} <= filler_tags


def test_every_event_has_required_fields():
    for e in _events_for("normal"):
        for f in ("timestamp", "asset_id", "uns_path", "tag_name", "value", "quality", "source"):
            assert f in e, f
        assert e["source"] in ("sim_plc", "live_supervised_cell")


def test_mqtt_disabled_writes_jsonl():
    evs = _events_for("normal", mqtt=False)
    assert tel.JSONL_PATH.exists() and len(evs) > 0


def test_mqtt_enabled_publishes_and_still_writes_jsonl():
    summary = tel.run_telemetry("normal", 30, mqtt=True, live_cell=False)
    assert summary["mqtt_published"] > 0
    assert tel.JSONL_PATH.exists()


# --- fault scenarios change the right tags ------------------------------------------------------

def test_filler_jam_changes_filler_status_and_fault():
    evs = _events_for("filler_jam")
    jam = [e for e in evs if e["asset_id"] == "filler01" and e["tag_name"] == "jam_detected"]
    assert any(e["value"] is True for e in jam)
    statuses = [e["value"] for e in evs if e["asset_id"] == "filler01" and e["tag_name"] == "status"]
    assert "fault" in statuses
    assert all(e.get("scenario_id") == "filler_jam" for e in evs)


def test_capper_fault_changes_capper_status_and_fault():
    evs = _events_for("capper_fault")
    tf = [e for e in evs if e["asset_id"] == "capper01" and e["tag_name"] == "torque_fault"]
    assert any(e["value"] is True for e in tf)
    statuses = [e["value"] for e in evs if e["asset_id"] == "capper01" and e["tag_name"] == "status"]
    assert "fault" in statuses


def test_downstream_blocked_changes_case_packer():
    evs = _events_for("downstream_blocked")
    db = [e for e in evs if e["asset_id"] == "casepacker01" and e["tag_name"] == "downstream_blocked"]
    assert any(e["value"] is True for e in db)


def test_recovery_clears_the_fault():
    evs = _events_for("recovery")
    jam = [e["value"] for e in evs if e["asset_id"] == "filler01" and e["tag_name"] == "jam_detected"]
    assert True in jam and jam[-1] is False  # faulted then recovered


def test_normal_scenario_has_no_fault_true():
    evs = _events_for("normal")
    fault_tags = {"jam_detected", "torque_fault", "downstream_blocked", "low_level", "overload", "label_low"}
    assert not any(e["tag_name"] in fault_tags and e["value"] is True for e in evs)


# --- UNS -> MQTT topic --------------------------------------------------------------------------

def test_uns_to_mqtt_topic_mapping():
    assert tel.event_topic("enterprise.proveit.bottling.plant1.filling.filler01") == \
        "enterprise/proveit/bottling/plant1/filling/filler01/events"
    for e in _events_for("normal"):
        assert tel.event_topic(e["uns_path"]).endswith("/events")


# --- Ignition export ----------------------------------------------------------------------------

def test_ignition_export_covers_every_sim_asset_and_conv_simple():
    detail = ig.export_all()
    covered = set(detail["assets_covered"])
    assert SIM_ASSET_KEYS <= covered
    assert "conv_simple" in covered
    assert ig.TAG_MAP_JSON.exists() and ig.TAG_MAP_CSV.exists() and ig.HMI_PLAN.exists()


def test_ignition_tag_path_format():
    rows = ig.build_tag_map()
    for r in rows:
        assert r["ignition_tag_path"].startswith("[default]")
        assert "enterprise" not in r["ignition_tag_path"]  # root dropped
        assert r["tag_name"] and r["data_type"]


def test_hmi_plan_has_the_six_screens():
    txt = ig.HMI_PLAN_TEXT
    for screen in ("Main bottling overview", "Asset status cards", "Alarms panel", "Live trends",
                   "MIRA evidence panel", "Conv_Simple supervised cell"):
        assert screen in txt


# --- live cell optional / no network ------------------------------------------------------------

def test_live_cell_snapshot_does_not_fail_and_is_marked(monkeypatch):
    monkeypatch.delenv("CONV_SIMPLE_LIVE_CELL", raising=False)
    evs = _events_for("normal", live_cell=True)
    cell = [e for e in evs if e["source"] == "live_supervised_cell"]
    assert cell and cell[0]["quality"] == "snapshot"
    assert rp.main(["--telemetry", "--live-cell", "--no-mqtt", "--ticks", "10"]) == 0


def test_no_network_imports_in_telemetry_stack():
    for mod in (sp, tel, ig):
        src = Path(mod.__file__).read_text(encoding="utf-8")
        for banned in ("import requests", "import httpx", "import urllib", "urllib.request"):
            assert banned not in src, f"{mod.__name__} must not use network ({banned})"
