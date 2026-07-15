"""Siemens STEP 7 AWL source parsing."""
from mira_plc_parser import render_json, render_markdown, run
from mira_plc_parser.detect import detect


def test_detects_siemens_awl_source(fixtures):
    text = (fixtures / "step7_faults.awl").read_text(encoding="utf-8")
    d = detect("DB_FAULTS.AWL", text)
    assert d.fmt == "siemens_awl"
    assert d.confidence == "high"


def test_siemens_awl_alarm_comments_become_fault_tags(fixtures):
    text = (fixtures / "step7_faults.awl").read_text(encoding="utf-8")
    res = run("step7_faults.awl", text)
    proj = res.project

    tags = {tag.name: tag for tag in proj.controllers[0].tags}
    assert set(tags) == {"Alarm0000", "Alarm0001", "Alarm0059", "Alarm0060", "Alarm0062"}
    assert tags["Alarm0059"].description == "#59 Fault Block 1 -A1 VFD FAULT"
    assert tags["Alarm0059"].address == "DB_FAULTS.Alarm0059"
    assert tags["Alarm0059"].provenance.locator == "line 10"


def test_siemens_awl_pipeline_reports_faults_and_vfd_candidates(fixtures):
    text = (fixtures / "step7_faults.awl").read_text(encoding="utf-8")
    res = run("step7_faults.awl", text)

    assert res.handled
    assert res.detection.fmt == "siemens_awl"
    assert res.report.counts["tags"] == 5
    assert res.report.counts["fault_candidates"] == 5
    vfd_names = {f.name for f in res.report.vfd_signal_candidates}
    assert vfd_names >= {"Alarm0059", "Alarm0060"}
    assert "Alarm0000" not in vfd_names

    md = render_markdown(res)
    assert "A1 VFD FAULT" in md

    payload = render_json(res)
    assert payload["handled"] is True
    assert payload["detection"]["fmt"] == "siemens_awl"
