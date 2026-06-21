"""PLCopen XML (tc6) parser + end-to-end analysis tests.

PLCopen XML is the open interchange format CODESYS / OpenPLC / Beremiz export. The parser maps
<pou> interface variables to IR tags and the <ST> body through the same statement->rung lift the
.st parser uses, so analysis output matches between the two ST-bearing formats.
"""
import pytest

from mira_plc_parser import analyze as A
from mira_plc_parser import run
from mira_plc_parser.parsers import plcopen_xml


@pytest.fixture(scope="module")
def conveyor_plcopen(fixtures):
    return (fixtures / "conveyor.plcopen.xml").read_text(encoding="utf-8")


def test_detect_and_parse_end_to_end(conveyor_plcopen):
    res = run("conveyor.plcopen.xml", conveyor_plcopen)
    assert res.handled
    assert res.detection.fmt == "plcopen_xml"
    r = res.report
    assert r.controller == "ConveyorCellPLCopen"
    assert r.counts["tags"] == 10         # 9 localVars + 1 globalVar
    assert r.counts["routines"] == 1


def test_interface_vars_become_tags(conveyor_plcopen):
    proj = plcopen_xml.parse(conveyor_plcopen, "conveyor.plcopen.xml")
    tags = {t.name: t for t in proj.all_tags()}
    assert tags["MotorRun"].data_type == "BOOL"
    assert tags["VFD_Frequency"].data_type == "REAL"
    assert tags["VFD_FaultCode"].data_type == "DINT"
    # <documentation> becomes the description
    assert "frequency" in tags["VFD_Frequency"].description.lower()
    # globalVars are controller-scoped + carry the initial value
    assert tags["LineSpeedSetpoint"].scope == "controller"
    assert tags["LineSpeedSetpoint"].initial_value == "60.0"
    assert tags["StartPB"].scope == "program"


def test_st_body_drives_analysis(conveyor_plcopen):
    r = A.analyze(plcopen_xml.parse(conveyor_plcopen, "conveyor.plcopen.xml"))
    outs = {f.name: f for f in r.output_dependencies}
    assert "MotorRun" in outs and "ConvFault" in outs
    assert "StartPB" in outs["MotorRun"].detail and "EStopOK" in outs["MotorRun"].detail


def test_camelcase_classification(conveyor_plcopen):
    r = A.analyze(plcopen_xml.parse(conveyor_plcopen, "conveyor.plcopen.xml"))
    faults = {f.name for f in r.fault_candidates}
    assert {"ConvFault", "VFD_FaultCode"} <= faults
    assert "EStopOK" in {f.name for f in r.review_required}
    sig = {f.name for f in r.vfd_signal_candidates}
    assert {"VFD_Frequency", "VFD_Current"} <= sig
