"""Rockwell L5X parser -> IR tests."""
from mira_plc_parser.parsers import rockwell_l5x


def test_controller_and_metadata(conveyor_l5x):
    proj = rockwell_l5x.parse(conveyor_l5x, "conveyor.L5X")
    assert len(proj.controllers) == 1
    c = proj.controllers[0]
    assert c.name == "ConveyorCell"
    assert c.processor_type == "1756-L83E"
    assert c.vendor == "Rockwell Automation"
    assert "34.00" in c.software
    assert not proj.warnings


def test_tags_extracted_with_descriptions(conveyor_l5x):
    proj = rockwell_l5x.parse(conveyor_l5x, "conveyor.L5X")
    tags = {t.name: t for t in proj.controllers[0].tags}
    assert "Motor_Run" in tags
    assert tags["Motor_Run"].data_type == "BOOL"
    assert tags["VFD_Frequency"].description == "Drive output frequency Hz"
    assert tags["VFD_Frequency"].external_access == "Read Only"
    assert tags["Run_Timer"].data_type == "TIMER"


def test_datatype_members(conveyor_l5x):
    proj = rockwell_l5x.parse(conveyor_l5x, "conveyor.L5X")
    dts = {d.name: d for d in proj.controllers[0].datatypes}
    assert "Drive_Status" in dts
    members = {m.name: m.data_type for m in dts["Drive_Status"].members}
    assert members["OutputHz"] == "REAL"


def test_routines_rll_and_st(conveyor_l5x):
    proj = rockwell_l5x.parse(conveyor_l5x, "conveyor.L5X")
    routines = {r.name: r for _p, r in proj.all_routines()}
    assert routines["MainRoutine"].type == "RLL"
    assert len(routines["MainRoutine"].rungs) == 3
    assert routines["FaultRoutine"].type == "ST"
    assert "VFD_FaultCode > 0" in routines["FaultRoutine"].st_text


def test_rung_logic_extraction(conveyor_l5x):
    proj = rockwell_l5x.parse(conveyor_l5x, "conveyor.L5X")
    main = {r.name: r for _p, r in proj.all_routines()}["MainRoutine"]
    rung0 = main.rungs[0]
    # the run rung energizes Motor_Run
    assert rung0.outputs == ["Motor_Run"]
    # all condition tags are captured as refs
    for cond in ("Start_PB", "Stop_PB", "EStop_OK", "Auto_Mode", "Conv_Fault", "Motor_Run"):
        assert cond in rung0.refs
    assert "OTE" in rung0.instructions
    assert rung0.comment.startswith("Run the conveyor")


def test_timer_and_latch_outputs(conveyor_l5x):
    proj = rockwell_l5x.parse(conveyor_l5x, "conveyor.L5X")
    main = {r.name: r for _p, r in proj.all_routines()}["MainRoutine"]
    # TON drives the timer tag; OTL latches the fault
    assert main.rungs[1].outputs == ["Run_Timer"]
    assert main.rungs[2].outputs == ["Conv_Fault"]


def test_malformed_xml_does_not_crash():
    proj = rockwell_l5x.parse("<RSLogix5000Content><broken", "bad.L5X")
    assert proj.controllers == []
    assert any("parse error" in w for w in proj.warnings)
