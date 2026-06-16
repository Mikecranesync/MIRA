"""Analysis + end-to-end pipeline tests (L5X and CSV)."""
from mira_plc_parser import render_markdown, run
from mira_plc_parser.parsers import csv_tags, rockwell_l5x
from mira_plc_parser import analyze as A


def test_pipeline_l5x_end_to_end(conveyor_l5x):
    res = run("conveyor.L5X", conveyor_l5x)
    assert res.handled
    assert res.detection.fmt == "rockwell_l5x"
    r = res.report
    assert r.controller == "ConveyorCell"
    assert r.counts["tags"] == 11
    assert r.counts["rungs"] == 3


def test_output_dependency_map(conveyor_l5x):
    r = A.analyze(rockwell_l5x.parse(conveyor_l5x, "conveyor.L5X"))
    outs = {f.name: f for f in r.output_dependencies}
    assert "Motor_Run" in outs
    # the conditions that gate Motor_Run should be surfaced
    assert "Start_PB" in outs["Motor_Run"].detail
    assert "EStop_OK" in outs["Motor_Run"].detail


def test_fault_candidates(conveyor_l5x):
    r = A.analyze(rockwell_l5x.parse(conveyor_l5x, "conveyor.L5X"))
    names = {f.name for f in r.fault_candidates}
    assert "Conv_Fault" in names
    assert "VFD_FaultCode" in names


def test_safety_review_flag(conveyor_l5x):
    r = A.analyze(rockwell_l5x.parse(conveyor_l5x, "conveyor.L5X"))
    review = {f.name for f in r.review_required}
    assert "EStop_OK" in review            # e-stop tag must be flagged for human review
    for f in r.review_required:
        assert f.confidence == "review"


def test_vfd_signal_candidates_feed_auto_map(conveyor_l5x):
    r = A.analyze(rockwell_l5x.parse(conveyor_l5x, "conveyor.L5X"))
    sig = {f.name: f.detail for f in r.vfd_signal_candidates}
    assert "VFD_Frequency" in sig and "frequency" in sig["VFD_Frequency"]
    assert "VFD_Current" in sig and "current_a" in sig["VFD_Current"]


def test_asset_candidates(conveyor_l5x):
    r = A.analyze(rockwell_l5x.parse(conveyor_l5x, "conveyor.L5X"))
    assert any(f.kind == "asset" for f in r.asset_candidates)


def test_tag_usage_crossreference(conveyor_l5x):
    r = A.analyze(rockwell_l5x.parse(conveyor_l5x, "conveyor.L5X"))
    d = {t["name"]: t for t in r.tag_dictionary}
    # Motor_Run is referenced in 3 rungs (run, timer, latch)
    assert d["Motor_Run"]["used_count"] >= 3
    assert "output" in d["Motor_Run"]["roles"]


def test_pipeline_csv_reuses_tag_csv(gs10_csv):
    res = run("gs10_tags.csv", gs10_csv)
    assert res.handled
    assert res.detection.fmt == "csv_tags"
    r = res.report
    assert r.counts["tags"] == 7
    sig = {f.name for f in r.vfd_signal_candidates}
    assert "VFD_Frequency" in sig and "VFD_Current" in sig
    # the Kepware dialect address survives into the IR
    tags = {t["name"]: t for t in r.tag_dictionary}
    assert tags["VFD_Frequency"]["address"] == "40001"


def test_csv_controller_named_from_file(gs10_csv):
    proj = csv_tags.parse(gs10_csv, "gs10_tags.csv")
    assert proj.controllers[0].name == "gs10_tags"
    assert proj.controllers[0].vendor == "Kepware / PTC"


def test_render_markdown_smoke(conveyor_l5x):
    md = render_markdown(run("conveyor.L5X", conveyor_l5x))
    assert "# MIRA PLC Parser report" in md
    assert "Human review required" in md
    assert "Output dependency candidates" in md
    assert "VFD signal candidates" in md


def test_unknown_format_handled_gracefully():
    res = run("notes.txt", "just some plain prose with no plc structure at all")
    assert not res.handled
    assert res.detection.fmt == "unknown"
    md = render_markdown(res)
    assert "Not parsed" in md


def test_planned_format_routes_but_defers():
    xml = '<?xml version="1.0"?><project xmlns="http://www.plcopen.org/xml/tc6_0201"></project>'
    res = run("p.xml", xml)
    assert not res.handled
    assert res.detection.fmt == "plcopen_xml"
    assert any("later phase" in w for w in res.project.warnings)


def test_acd_pipeline_gives_actionable_guidance():
    res = run("PlantLine.ACD", "\x00\x01 binary project")
    assert not res.handled
    assert res.detection.fmt == "rockwell_acd"
    md = render_markdown(res)
    assert "action needed" in md.lower()
    assert "L5X" in md
    # and it must NOT pretend to have parsed anything
    assert res.report.counts.get("tags", 0) == 0
