"""Tests for the UNS / ISA-95 namespace proposal engine."""

from pathlib import Path

from mira_plc_parser import uns
from mira_plc_parser.pipeline import render_json, run

FIXTURE = Path(__file__).parent / "fixtures" / "conveyor.L5X"


def _report():
    return render_json(run(FIXTURE.name, FIXTURE.read_text(encoding="utf-8")))


def test_slug_normalizes_to_uns_segment():
    assert uns.slug("VFD Frequency") == "vfd_frequency"
    assert uns.slug("Conv_Fault") == "conv_fault"
    assert uns.slug("  Line #3 ") == "line_3"
    assert uns.slug("") == "x"


def test_default_prefix_seeds_line_from_controller():
    pref = uns.default_prefix({"controller": "ConveyorCell"})
    assert pref["line"] == "conveyorcell"
    assert pref["enterprise"] and pref["site"] and pref["area"]


def test_report_includes_uns_candidates_one_per_tag():
    rep = _report()
    assert "uns_candidates" in rep and "uns_prefix" in rep
    assert len(rep["uns_candidates"]) == len(rep["tag_dictionary"])
    assert rep["counts"]["uns_candidates"] == len(rep["uns_candidates"])


def test_vfd_signal_gets_high_confidence_standardized_path():
    rep = _report()
    by_tag = {u["tag"]: u for u in rep["uns_candidates"]}
    freq = by_tag["VFD_Frequency"]
    assert freq["path"] == "enterprise/site1/area1/conveyorcell/vfd/frequency"
    assert freq["standardized"] is True
    assert freq["confidence"] == "high"
    assert freq["segments"]["signal"] == "frequency"
    assert freq["segments"]["asset"] == "vfd"


def test_unmatched_tag_sits_directly_under_line_with_low_confidence():
    rep = _report()
    by_tag = {u["tag"]: u for u in rep["uns_candidates"]}
    sp = by_tag["Start_PB"]
    assert sp["asset"] == ""
    assert sp["path"] == "enterprise/site1/area1/conveyorcell/start_pb"
    assert sp["confidence"] == "low"


def test_prefix_override_changes_only_upper_levels():
    rep = _report()
    custom = uns.propose_uns(rep, {"site": "Plant 2", "area": "Bottling", "line": "Line 3"})
    by_tag = {u["tag"]: u for u in custom}
    freq = by_tag["VFD_Frequency"]
    assert freq["path"] == "enterprise/plant_2/bottling/line_3/vfd/frequency"
    # the lower (parsed) levels are untouched
    assert freq["segments"]["asset"] == "vfd"
    assert freq["segments"]["signal"] == "frequency"


def test_unhandled_report_yields_no_candidates():
    assert uns.propose_uns({"handled": False}) == []
