"""
Deterministic tests for the Flight Recorder Report renderer (Layer-2 readout).
Run: pytest tests/simlab/test_flight_report.py -q

Pure function of run_pipeline() output — offline, no DB/cloud/LLM/network.
"""
from demo.factory_difference_engine.flight_report import render_report
from demo.factory_difference_engine.pipeline import run_pipeline

SECTIONS = [
    "header", "executive-summary", "difference-cards", "event-timeline",
    "baseline-vs-current", "explain-panel", "evidence-citations", "learn-review-preview",
]


def _html(scenario="A", seed=42):
    return render_report(run_pipeline(scenario, seed=seed))


def test_all_expected_sections_render():
    h = _html()
    for s in SECTIONS:
        assert ("data-section='%s'" % s) in h, "missing report section: %s" % s


def test_section_headings_present():
    h = _html().lower()
    for title in [
        "executive summary", "difference cards", "event timeline",
        "baseline vs current", "explanation", "evidence", "learn / review",
    ]:
        assert title in h, "missing heading: %s" % title


def test_two_renders_are_identical():
    assert _html("A") == _html("A")
    assert _html("B") == _html("B")


def test_self_contained_static_and_offline():
    h = _html()
    assert h.startswith("<!DOCTYPE html>")
    assert "<style>" in h                       # inline CSS
    assert "http://" not in h and "https://" not in h   # no external resources / network
    assert "<script" not in h                   # purely static, no JS
    assert "<link" not in h                     # no external stylesheet


def test_report_shows_real_grounded_values():
    h = _html("A")
    assert "CV-200" in h                         # asset alias header
    assert "filler_bowl_pressure" in h           # a real abnormal PLC signal
    assert "troubleshooting.md" in h             # a real cited manual
    assert "Machine event detected" in h         # status for scenario A


def test_offline_no_db_cloud_llm_env_required():
    # render_report is a pure function of the pipeline dict; run_pipeline is offline.
    # No NEON_DATABASE_URL / provider keys / network are needed for any scenario.
    for scn in ("A", "B", "F"):
        h = render_report(run_pipeline(scn, seed=42))
        assert "<html" in h and "</html>" in h
