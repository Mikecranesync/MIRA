"""Structured Text (.st, IEC 61131-3) parser + end-to-end analysis tests.

ST is the vendor-neutral reasoning bridge: VAR declarations become IR tags, assignment statements
become synthetic rungs (LHS = driven output, expression tags = conditions), and the POU body is
preserved as routine.st_text. The fixture is camelCase on purpose, so these tests also prove the
tokenizer fix reaches real analysis output (ConvFault/EStopOK classify correctly).
"""
import pytest

from mira_plc_parser import analyze as A
from mira_plc_parser import run
from mira_plc_parser.parsers import structured_text


@pytest.fixture(scope="module")
def conveyor_st(fixtures):
    return (fixtures / "conveyor.st").read_text(encoding="utf-8")


def test_detect_and_parse_end_to_end(conveyor_st):
    res = run("conveyor.st", conveyor_st)
    assert res.handled
    assert res.detection.fmt == "structured_text"
    r = res.report
    assert r.controller == "ConveyorControl"
    assert "61131" in r.vendor or "IEC" in r.vendor
    # 11 program VARs + 1 VAR_GLOBAL
    assert r.counts["tags"] == 12
    assert r.counts["routines"] == 1


def test_var_declarations_become_tags(conveyor_st):
    proj = structured_text.parse(conveyor_st, "conveyor.st")
    tags = {t.name: t for t in proj.all_tags()}
    assert tags["MotorRun"].data_type == "BOOL"
    assert tags["VFD_Frequency"].data_type == "REAL"
    # the inline (* ... *) comment is captured as the tag description
    assert "frequency" in tags["VFD_Frequency"].description.lower()
    # VAR_GLOBAL is controller-scoped; POU-locals are program-scoped
    assert tags["LineSpeedSetpoint"].scope == "controller"
    assert tags["MotorRun"].scope == "program"


def test_camelcase_classification_reaches_findings(conveyor_st):
    r = A.analyze(structured_text.parse(conveyor_st, "conveyor.st"))
    faults = {f.name for f in r.fault_candidates}
    assert {"ConvFault", "VFD_FaultCode"} <= faults     # camelCase names, classified by the fix
    review = {f.name for f in r.review_required}
    assert "EStopOK" in review                          # "EStop" hump -> safety -> REVIEW


def test_assignments_become_output_dependencies(conveyor_st):
    r = A.analyze(structured_text.parse(conveyor_st, "conveyor.st"))
    outs = {f.name: f for f in r.output_dependencies}
    assert "MotorRun" in outs and "ConvFault" in outs
    # the gating conditions of MotorRun should be surfaced from the IF expression
    assert "StartPB" in outs["MotorRun"].detail
    assert "EStopOK" in outs["MotorRun"].detail


def test_vfd_signals_detected(conveyor_st):
    r = A.analyze(structured_text.parse(conveyor_st, "conveyor.st"))
    sig = {f.name for f in r.vfd_signal_candidates}
    assert {"VFD_Frequency", "VFD_Current"} <= sig


def test_body_preserved_as_st_text(conveyor_st):
    proj = structured_text.parse(conveyor_st, "conveyor.st")
    routine = proj.controllers[0].programs[0].routines[0]
    assert routine.type == "ST"
    assert ":=" in routine.st_text          # the executable body is retained for later reasoning
