"""Offline PLC Asset Compiler tests -- folder in, asset model out (deterministic, offline).

Covers the end-to-end compile: discovery (incl. ignoring runtime value dumps), three-way fusion
(logic role + CSV type + Modbus address), conflict flagging, safety review, the five output
artifacts, and the required graph node/edge vocabulary.
"""
import json

from mira_plc_parser import compile_folder, correlate, write_outputs
from mira_plc_parser.discovery import classify

# A realistic mini export set for one asset: CCW-style ST (logic, no VAR) + variables CSV (types)
# + Modbus map CSV (addresses) + a runtime value dump that must be ignored.
ST = """PROGRAM ConveyorCell
  IF start_pb AND e_stop_ok THEN motor_run := TRUE; END_IF;
  vfd_frequency := read_data(1);
  start_timer(IN := (motor_run), PT := T#3000ms);
  IF vfd_comm_err THEN fault_alarm := TRUE; END_IF;
END_PROGRAM
"""
VARS_CSV = (
    "Name,Data Type,Dimension,Initial Value,Attribute,Comment,X\n"
    "motor_run,BOOL,,FALSE,Read/Write,run command,\n"
    "vfd_frequency,WORD,,0,Read Only,drive Hz,\n"
    "e_stop_ok,BOOL,,FALSE,Read/Write,estop healthy,\n"
    "fault_alarm,BOOL,,FALSE,Read/Write,fault latch,\n"
)
MODBUS_CSV = (
    "Variable,Data Type,Mapping Address,Mapping Type,Read Only\n"
    "motor_run,Bool,000001,Coil,FALSE\n"
    "vfd_frequency,Word,400107,Holding Register,TRUE\n"
    "e_stop_ok,Bool,000006,Coil,TRUE\n"
)
VALUE_DUMP = "[Version1]\nFullName,Value\nController.Micro820.foo,FALSE\nController.Micro820.bar,12\n"


def _write_export(tmp_path):
    (tmp_path / "cell.st").write_text(ST, encoding="utf-8")
    (tmp_path / "vars.csv").write_text(VARS_CSV, encoding="utf-8")
    (tmp_path / "modbus.csv").write_text(MODBUS_CSV, encoding="utf-8")
    (tmp_path / "LogicalValues.csv").write_text(VALUE_DUMP, encoding="utf-8")
    return tmp_path


# ---- discovery ----

def test_value_dump_is_detected_and_ignored():
    assert classify("LogicalValues.csv", VALUE_DUMP)["classification"] == "value_dump"
    assert classify("vars.csv", VARS_CSV)["classification"] == "parseable"
    assert classify("modbus.csv", MODBUS_CSV)["classification"] == "parseable"


def test_compile_discovers_and_ignores_value_dump(tmp_path):
    graph, items = compile_folder(_write_export(tmp_path), asset_name="ConveyorCell")
    counts = graph["discovery"]["counts"]
    assert counts["parseable"] == 3
    assert counts["value_dump"] == 1
    # the value dump contributed ZERO signals (no foo/bar tags)
    names = {n["name"] for n in graph["nodes"] if n["type"] == "Signal"}
    assert "foo" not in names and "bar" not in names


# ---- five artifacts ----

def test_compile_writes_five_artifacts(tmp_path):
    graph, _ = compile_folder(_write_export(tmp_path), asset_name="ConveyorCell")
    out = tmp_path / "out"
    written = write_outputs(graph, out)
    assert set(written) == {"asset_graph.json", "signals.csv", "registers.csv",
                            "edges.csv", "compiler_report.md"}
    for f in written:
        assert (out / f).is_file() and (out / f).stat().st_size > 0
    # asset_graph.json round-trips
    json.loads((out / "asset_graph.json").read_text(encoding="utf-8"))
    assert "PLC Asset Compiler report" in (out / "compiler_report.md").read_text(encoding="utf-8")


# ---- graph vocabulary (spec #9) ----

def test_graph_has_required_nodes_and_edges(tmp_path):
    graph, _ = compile_folder(_write_export(tmp_path), asset_name="ConveyorCell")
    ntypes = {n["type"] for n in graph["nodes"]}
    etypes = {e["type"] for e in graph["edges"]}
    assert {"Asset", "Signal", "Register"} <= ntypes
    assert {"HAS_SIGNAL", "MAPPED_TO", "DEPENDS_ON"} <= etypes


# ---- three-way fusion ----

def test_fusion_combines_role_type_address(tmp_path):
    graph, _ = compile_folder(_write_export(tmp_path), asset_name="ConveyorCell")
    sig = next(n for n in graph["nodes"] if n["name"] == "vfd_frequency")
    assert sig["attributes"]["data_type"].upper() == "WORD"   # type from a CSV (vars + modbus agree)
    assert sig["attributes"]["address"] == "400107"           # address from the Modbus map
    assert "frequency" in sig["attributes"]["vfd_role"]       # role inferred from the name/logic
    assert sig["status"] == "resolved"
    assert sig["confidence"]["data_type"] == "exact" and sig["confidence"]["address"] == "exact"


# ---- function-block parameter must NOT mint a signal ----

def test_fb_parameter_assignment_not_minted(tmp_path):
    graph, _ = compile_folder(_write_export(tmp_path), asset_name="ConveyorCell")
    names = {n["name"] for n in graph["nodes"] if n["type"] == "Signal"}
    assert "IN" not in names and "PT" not in names        # start_timer(IN := ..., PT := ...)
    assert "motor_run" in names                            # the real assignment target survives


# ---- safety review ----

def test_safety_signal_requires_review(tmp_path):
    graph, _ = compile_folder(_write_export(tmp_path), asset_name="ConveyorCell")
    estop = next(n for n in graph["nodes"] if n["name"] == "e_stop_ok")
    assert "safety" in estop["categories"]
    assert estop["review"] is True


# ---- conflict flagging (sources disagree, not silently overwritten) ----

def test_single_flat_folder_is_one_asset(tmp_path):
    graph, _ = compile_folder(_write_export(tmp_path), asset_name="ConveyorCell")
    assert len(graph["assets"]) == 1
    assert graph["assets"][0]["name"] == "ConveyorCell"


def test_multi_asset_folder_splits_by_subfolder(tmp_path):
    # two machines in two subfolders, both declaring a "motor_run" signal
    (tmp_path / "LineA").mkdir()
    (tmp_path / "LineB").mkdir()
    (tmp_path / "LineA" / "a.st").write_text(
        "PROGRAM A\n motor_run := TRUE;\n vfd_a_speed := read(1);\nEND_PROGRAM\n", encoding="utf-8")
    (tmp_path / "LineB" / "b.st").write_text(
        "PROGRAM B\n motor_run := TRUE;\n vfd_b_speed := read(1);\nEND_PROGRAM\n", encoding="utf-8")
    graph, _ = compile_folder(tmp_path)

    assert {a["name"] for a in graph["assets"]} == {"LineA", "LineB"}
    # both assets have a motor_run, but they are TWO distinct nodes (no cross-asset collision)
    motors = [n for n in graph["nodes"] if n["type"] == "Signal" and n["name"] == "motor_run"]
    assert len(motors) == 2
    assert {n["asset"] for n in motors} == {"LineA", "LineB"}
    assert len({n["id"] for n in motors}) == 2
    # there are two Asset nodes
    assert sum(1 for n in graph["nodes"] if n["type"] == "Asset") == 2


def test_multi_asset_csv_has_asset_column(tmp_path):
    from mira_plc_parser.compiler import signals_rows
    (tmp_path / "LineA").mkdir()
    (tmp_path / "LineB").mkdir()
    (tmp_path / "LineA" / "a.st").write_text("PROGRAM A\n motor_run := TRUE;\nEND_PROGRAM\n", "utf-8")
    (tmp_path / "LineB" / "b.st").write_text("PROGRAM B\n pump_run := TRUE;\nEND_PROGRAM\n", "utf-8")
    graph, _ = compile_folder(tmp_path)
    rows = signals_rows(graph)
    assert rows[0][0] == "asset"
    assets_in_rows = {r[0] for r in rows[1:]}
    assert assets_in_rows == {"LineA", "LineB"}


def test_conflicting_types_are_flagged_not_overwritten():
    a = "Name,Data Type,Comment\nwidget,REAL,from A\n"
    b = "Name,Data Type,Comment\nwidget,BOOL,from B\n"
    g = correlate([("a.csv", a), ("b.csv", b)], asset_name="X")
    widget = next(n for n in g["nodes"] if n["name"] == "widget")
    assert widget["confidence"]["data_type"] == "conflict"
    assert widget["conflicts"] and widget["conflicts"][0]["field"] == "data_type"
    assert g["fusion"]["conflicts"] >= 1
