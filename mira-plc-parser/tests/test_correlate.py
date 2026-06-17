"""Multi-source correlation tests -- fuse several exports about ONE asset into a knowledge graph.

The key behavior: a CCW-style .st (logic + variable names, no types) plus a Controller-Variables CSV
(types) fuse into one graph where every assigned signal gets its type from the CSV and its role from
the logic, and the control logic becomes Signal->DependsOn->Signal edges.
"""
from mira_plc_parser import correlate, run

# CCW-style ST: no VAR block, just logic. Assigns motor_run / vfd_frequency / fault_alarm.
ST = """PROGRAM ConveyorCell
  IF start_pb AND e_stop_ok AND auto_mode THEN
    motor_run := TRUE;
  END_IF;
  vfd_frequency := read_data(1);
  IF vfd_comm_err THEN
    fault_alarm := TRUE;
  END_IF;
END_PROGRAM
"""

# CCW Controller-Variables CSV: the type table for the same names (generic dialect).
VARS_CSV = (
    "Name,Data Type,Dimension,Initial Value,Attribute,Comment,CLONE_FROM_EXISTING_ROW\n"
    "start_pb,BOOL,,FALSE,Read/Write,operator start pushbutton,\n"
    "e_stop_ok,BOOL,,FALSE,Read/Write,e-stop circuit healthy,\n"
    "auto_mode,BOOL,,FALSE,Read/Write,line in auto,\n"
    "motor_run,BOOL,,FALSE,Read/Write,conveyor VFD run command,\n"
    "vfd_frequency,REAL,,0,Read Only,drive output frequency Hz,\n"
    "vfd_comm_err,BOOL,,FALSE,Read/Write,modbus comm error,\n"
    "fault_alarm,BOOL,,FALSE,Read/Write,fault latch,\n"
)

SOURCES = [("ConveyorCell.st", ST), ("vars_conveyor.csv", VARS_CSV)]


def _node(graph, name, ntype):
    return next(n for n in graph["nodes"] if n["name"] == name and n["type"] == ntype)


def test_single_asset_from_multiple_sources():
    g = correlate(SOURCES)
    assert g["schema"] == "mira-plc-parser/asset-graph@1"
    assert g["asset"]["name"] == "ConveyorCell"
    assert g["counts"]["nodes"]["Asset"] == 1
    assert len(g["sources"]) == 2 and all(s["handled"] for s in g["sources"])


def test_type_filled_by_cross_file_fusion():
    g = correlate(SOURCES)
    # motor_run's NAME comes from the .st (logic), its TYPE from the CSV -- the fusion win
    motor = _node(g, "motor_run", "Signal")
    assert motor["attributes"]["data_type"] == "BOOL"      # from the CSV
    assert "output" in motor["attributes"]["roles"]        # from the ST logic
    assert "ConveyorCell.st" in motor["provenance"]["name_from"]
    assert "vars_conveyor.csv" in motor["provenance"]["type_from"]
    assert g["fusion"]["type_filled_by_fusion"] >= 3       # motor_run, vfd_frequency, fault_alarm
    assert g["fusion"]["name_only"] == 0                   # every signal got a type after fusion


def test_control_logic_becomes_dependson_edges():
    g = correlate(SOURCES)
    deps = {(e["from"], e["to"]) for e in g["edges"] if e["type"] == "DEPENDS_ON"}
    motor = _node(g, "motor_run", "Signal")["id"]
    start = _node(g, "start_pb", "Signal")["id"]
    estop = _node(g, "e_stop_ok", "Signal")["id"]
    fault = _node(g, "fault_alarm", "Signal")["id"]
    commerr = _node(g, "vfd_comm_err", "Signal")["id"]
    assert (motor, start) in deps and (motor, estop) in deps
    assert (fault, commerr) in deps


def test_vfd_and_fault_surface_as_graph_objects():
    g = correlate(SOURCES)
    sig = _node(g, "vfd_frequency", "Signal")
    assert "frequency" in sig["attributes"]["vfd_role"]
    events = {n["name"] for n in g["nodes"] if n["type"] == "Event"}
    assert "fault_alarm" in events and "vfd_comm_err" in events


# ---- the third source: a CCW MbSrvConf Modbus map (Variable / Mapping Address dialect) ----

def test_ccw_modbus_csv_dialect_parses_addresses(fixtures):
    # the real CCW export header is "Variable,...,Mapping Address,..." -- must parse with addresses
    res = run("conveyor_modbus_map.csv", (fixtures / "conveyor_modbus_map.csv").read_text("utf-8"))
    assert res.handled
    addr = {t["name"]: t["address"] for t in res.report.tag_dictionary}
    assert addr["vfd_frequency"] == "400107"
    assert addr["e_stop_ok"] == "000006"


def test_three_way_fusion_adds_addresses_and_mappedto_edges(fixtures):
    modbus = (fixtures / "conveyor_modbus_map.csv").read_text("utf-8")
    g = correlate(SOURCES + [("conveyor_modbus_map.csv", modbus)], asset_name="ConveyorCell")
    # vfd_frequency: name from ST, type from vars CSV, address from the Modbus map -- all three fused
    vfd = _node(g, "vfd_frequency", "Signal")
    assert vfd["attributes"]["data_type"] == "REAL"
    assert vfd["attributes"]["address"] == "400107"
    assert g["fusion"]["addressed"] >= 5
    # the address became a first-class Register node reached by a MappedTo edge
    regs = {n["name"] for n in g["nodes"] if n["type"] == "Register"}
    assert "400107" in regs
    reg_id = next(n["id"] for n in g["nodes"] if n["type"] == "Register" and n["name"] == "400107")
    assert {"type": "MAPPED_TO", "from": vfd["id"], "to": reg_id} in g["edges"]
