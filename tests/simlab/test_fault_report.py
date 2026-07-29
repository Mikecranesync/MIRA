"""
Deterministic tests for the fault-centered report (Fault Intelligence, Phase 2c).
Run: pytest tests/simlab/test_fault_report.py -q

Offline / static: pure function of a Fault Intelligence Bundle. No DB/network/cloud/LLM.
"""
from demo.factory_difference_engine.fault_bundle import build_fault_bundle_for_scenario
from demo.factory_difference_engine.fault_report import render_fault_report

SECTIONS = [
    "fault-header", "what-it-means", "what-changed", "evidence-citations",
    "check-first", "data-missing", "review-preview",
]


def _html(code="F007", scenario="A"):
    return render_fault_report(build_fault_bundle_for_scenario(code, scenario))


def test_all_sections_render():
    h = _html()
    for s in SECTIONS:
        assert ("data-section='%s'" % s) in h, "missing section: %s" % s


def test_f007_corroborated_and_grounded():
    h = _html("F007", "A")
    assert "F007" in h and "Low Bowl Pressure" in h
    assert "CORROBORATED BY LIVE DIFFERENCES" in h
    assert "filler_bowl_pressure" in h
    assert "below" in h                          # baseline-vs-current status
    assert "fault_code_table.md" in h            # cited source


def test_uncorroborated_fault_is_shown_honestly():
    h = _html("F002", "A")               # motor overload, not the active fault in scenario A
    assert "NAMED BUT NOT CORROBORATED" in h
    assert "overload_count" in h                 # the missing diagnostic is surfaced


def test_unknown_code_renders_safely():
    h = _html("NOPE", "A")
    assert "FAULT CODE NOT FOUND" in h
    assert h.startswith("<!DOCTYPE html>") and "</html>" in h


def test_self_contained_static_offline():
    h = _html()
    assert h.startswith("<!DOCTYPE html>")
    assert "<style>" in h
    assert "http://" not in h and "https://" not in h
    assert "<script" not in h and "<link" not in h


def test_deterministic():
    assert _html("F007", "A") == _html("F007", "A")
