"""Offline VQT attachment tests (issue #2102 slice) -- bind a values snapshot onto a compiled graph.

Builds a small asset graph (ST + Modbus map) via correlate, then attaches an address-keyed snapshot
and asserts VQT/quality/freshness land on the mapped signals, unmatched readings are reported, and
the input graph is never mutated.
"""
import copy
import json

from mira_plc_parser import attach_values, correlate, load_snapshot

ST = "PROGRAM Cell\n vfd_frequency := read(1);\n motor_run := TRUE;\n e_stop_ok := TRUE;\nEND_PROGRAM\n"
MODBUS = (
    "Variable,Data Type,Mapping Address,Mapping Type,Read Only\n"
    "vfd_frequency,Word,400107,Holding Register,TRUE\n"
    "motor_run,Bool,000001,Coil,FALSE\n"
    "e_stop_ok,Bool,000006,Coil,TRUE\n"
)
SNAPSHOT = (
    "address,value,quality,timestamp\n"
    "400107,151,good,2026-06-12T17:11:03Z\n"
    "000006,1,good,2026-06-12T17:11:03Z\n"
    "499999,7,good,2026-06-12T17:11:03Z\n"   # no signal maps to this address
)


def _graph():
    return correlate([("cell.st", ST), ("modbus.csv", MODBUS)], asset_name="Cell")


def _sig(graph, name):
    return next(n for n in graph["nodes"] if n["type"] == "Signal" and n["name"] == name)


def test_snapshot_csv_and_json_parse_equal():
    csv_rows = load_snapshot(SNAPSHOT)
    js = json.dumps([{"address": r.key, "value": r.value, "quality": r.quality,
                      "timestamp": r.timestamp} for r in csv_rows])
    json_rows = load_snapshot(js)
    assert [(r.key, str(r.value)) for r in csv_rows] == [(r.key, str(r.value)) for r in json_rows]


def test_attach_by_address_populates_vqt():
    live = attach_values(_graph(), load_snapshot(SNAPSHOT))
    vfd = _sig(live, "vfd_frequency")
    assert vfd["vqt"]["value"] == 151
    assert vfd["vqt"]["quality"] == "good"
    assert vfd["vqt"]["timestamp"] == "2026-06-12T17:11:03Z"
    assert vfd["freshness"] == "current"     # as_of defaults to the snapshot's own timestamp


def test_unmatched_reading_reported_not_crash():
    live = attach_values(_graph(), load_snapshot(SNAPSHOT))
    keys = {u["key"] for u in live["live_summary"]["unmatched_readings"]}
    assert "499999" in keys
    assert live["live_summary"]["signals_attached"] == 2   # 400107 + 000006 (motor_run not in snap)


def test_unsampled_signal_has_empty_vqt():
    live = attach_values(_graph(), load_snapshot(SNAPSHOT))
    motor = _sig(live, "motor_run")          # mapped to 000001, not in the snapshot
    assert motor["vqt"] == {"value": None, "quality": "unknown", "timestamp": None}
    assert motor["freshness"] == "unknown"


def test_quality_rules():
    snap = "address,value,quality\n400107,151,frobnicate\n000006,,good\n"
    live = attach_values(_graph(), load_snapshot(snap))
    assert _sig(live, "vfd_frequency")["vqt"]["quality"] == "uncertain"   # unknown code downgraded
    assert _sig(live, "e_stop_ok")["vqt"]["quality"] == "bad"             # no value


def test_freshness_stale_downgrades_quality():
    snap = "address,value,quality,timestamp\n400107,151,good,2026-06-12T17:00:00Z\n"
    live = attach_values(_graph(), load_snapshot(snap), as_of="2026-06-12T17:11:03Z", max_age=30)
    vfd = _sig(live, "vfd_frequency")
    assert vfd["freshness"] == "stale"
    assert vfd["vqt"]["quality"] == "stale"


def test_bind_by_name():
    snap = "signal,value\nvfd_frequency,99\n"
    live = attach_values(_graph(), load_snapshot(snap, by="name"), by="name")
    assert _sig(live, "vfd_frequency")["vqt"]["value"] == 99


def test_input_graph_not_mutated():
    g = _graph()
    before = copy.deepcopy(g)
    attach_values(g, load_snapshot(SNAPSHOT))
    assert g == before                       # attach returns a new graph; input untouched
