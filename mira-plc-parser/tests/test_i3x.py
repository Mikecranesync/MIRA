"""i3X object-graph export tests -- the forward-compatible mapping (schema mira-plc-parser/i3x@1).

Verifies the report -> i3X projection: a controller becomes an Asset Object, asset candidates
become Components (HasComponent), tags become Signal Objects with an empty VQT, and fault/review
findings become Event Objects (RelatesTo). ElementIds are deterministic; the output is json-safe.
"""
import json

import pytest

from mira_plc_parser import render_i3x, run


@pytest.fixture(scope="module")
def l5x_i3x(conveyor_l5x):
    return render_i3x(run("conveyor.L5X", conveyor_l5x))


def test_envelope_and_json_safe(l5x_i3x):
    assert l5x_i3x["schema"] == "mira-plc-parser/i3x@1"
    assert l5x_i3x["handled"] is True
    json.loads(json.dumps(l5x_i3x))   # must round-trip (no UUID/enum leaking)


def test_single_asset_object_at_root(l5x_i3x):
    assets = [o for o in l5x_i3x["objects"] if o["object_type"] == "Asset"]
    assert len(assets) == 1
    asset = assets[0]
    assert asset["display_name"] == "ConveyorCell"
    assert asset["namespace"] == "plc.conveyorcell"
    assert asset["attributes"]["vendor"] == "Rockwell Automation"
    assert l5x_i3x["asset_namespace"] == "plc.conveyorcell"


def test_signals_carry_vqt_and_belong_to_asset(l5x_i3x):
    asset_eid = next(o["element_id"] for o in l5x_i3x["objects"] if o["object_type"] == "Asset")
    signals = [o for o in l5x_i3x["objects"] if o["object_type"] == "Signal"]
    assert signals, "expected Signal objects from the tag dictionary"
    motor = next(o for o in signals if o["display_name"] == "Motor_Run")
    assert motor["namespace"] == "plc.conveyorcell.motor_run"
    assert motor["vqt"] == {"value": None, "quality": "unknown", "timestamp": None}
    assert motor["relationships"][0] == {"type": "BelongsTo", "from": motor["element_id"], "to": asset_eid}
    # a VFD signal is annotated with its drive role
    freq = next(o for o in signals if o["display_name"] == "VFD_Frequency")
    assert "frequency" in freq["attributes"]["vfd_role"]


def test_components_have_hascomponent_edge(l5x_i3x):
    asset_eid = next(o["element_id"] for o in l5x_i3x["objects"] if o["object_type"] == "Asset")
    comps = [o for o in l5x_i3x["objects"] if o["object_type"] == "Component"]
    assert comps
    for c in comps:
        assert c["relationships"][0]["type"] == "HasComponent"
        assert c["relationships"][0]["from"] == asset_eid


def test_events_have_severity_and_relateto(l5x_i3x):
    events = [o for o in l5x_i3x["objects"] if o["object_type"] == "Event"]
    assert events
    # the e-stop review finding must be a high-severity Event
    estop = next(o for o in events if o["display_name"] == "EStop_OK" and o["attributes"]["kind"] == "safety")
    assert estop["severity"] == "high"
    assert estop["relationships"][0]["type"] == "RelatesTo"


def test_deterministic_element_ids(conveyor_l5x):
    a = render_i3x(run("conveyor.L5X", conveyor_l5x))
    b = render_i3x(run("conveyor.L5X", conveyor_l5x))
    assert [o["element_id"] for o in a["objects"]] == [o["element_id"] for o in b["objects"]]


def test_unhandled_returns_envelope_only():
    res = render_i3x(run("notes.txt", "no plc structure here"))
    assert res["handled"] is False
    assert res["objects"] == []


def test_real_ccw_st_maps_to_i3x():
    # the no-VAR Micro820-style program: synthesized signals + fault events still project to i3X
    from pathlib import Path
    fix = Path(__file__).resolve().parent / "fixtures" / "ccw_micro820_novar.st"
    g = render_i3x(run(fix.name, fix.read_text(encoding="utf-8")))
    assert g["counts"]["Asset"] == 1
    assert g["counts"]["Signal"] >= 10
    assert g["counts"]["Event"] >= 3
    names = {o["display_name"] for o in g["objects"] if o["object_type"] == "Signal"}
    assert "vfd_frequency" in names
