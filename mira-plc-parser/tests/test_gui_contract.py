"""Guard the data contract the desktop GUI (gui/index.html) depends on.

The GUI is a separate static front end that reads the report JSON `mira-plc-parser analyze`
emits. It only touches a small subset of fields; if a parser change drops or renames one of
them, the GUI silently breaks. This test pins that subset.
"""

from pathlib import Path

from mira_plc_parser.pipeline import render_json, run

FIXTURE = Path(__file__).parent / "fixtures" / "conveyor.L5X"


def _report():
    return render_json(run(FIXTURE.name, FIXTURE.read_text(encoding="utf-8")))


def test_report_exposes_tag_dictionary_for_left_pane():
    rep = _report()
    tags = rep.get("tag_dictionary")
    assert isinstance(tags, list) and tags, "GUI left pane needs a non-empty tag_dictionary"
    for t in tags:
        assert "name" in t, "GUI renders tag name"
        assert "data_type" in t, "GUI renders tag data_type"


def test_report_exposes_vfd_suggestions_for_yellow_rows():
    rep = _report()
    cands = rep.get("vfd_signal_candidates")
    assert isinstance(cands, list), "GUI yellow suggestions read vfd_signal_candidates"
    for c in cands:
        assert "name" in c, "GUI maps a suggestion to a tag by name"
        assert "detail" in c, "GUI derives the role from the 'candidate role: X' detail"


def test_report_exposes_controller_and_vendor_for_meta_line():
    rep = _report()
    assert "controller" in rep and "vendor" in rep, "GUI toolbar shows controller / vendor"


def test_conveyor_fixture_yields_at_least_one_yellow_suggestion():
    # The proof's headline behavior: the parser pre-fills at least one role for the user.
    rep = _report()
    assert len(rep["vfd_signal_candidates"]) >= 1
