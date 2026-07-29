"""Engine adapter — deterministic PLC extraction against the shared mira-plc-parser fixture."""

import pathlib

import mira_plc_parser

from mira_contextualizer import engine

FIXTURE = (
    pathlib.Path(mira_plc_parser.__file__).parent.parent / "tests" / "fixtures" / "conveyor.L5X"
)


def test_source_type_and_plc_detection():
    assert engine.source_type_for("a.L5X") == "l5x"
    assert engine.source_type_for("b.csv") == "csv"
    assert engine.source_type_for("manual.pdf") == "manual"
    assert engine.source_type_for("weird.bin") == "other"
    assert engine.is_plc_text("a.L5X") and engine.is_plc_text("b.CSV")
    assert not engine.is_plc_text("manual.pdf")


def test_extract_plc_conveyor_fixture():
    text = FIXTURE.read_text(encoding="utf-8")
    rows, report = engine.extract_plc(FIXTURE.name, text)
    assert report.get("handled") is True
    assert rows, "conveyor fixture should yield extraction rows"
    for r in rows:
        assert r["tag_name"]
        assert "roles" in r and "evidence_json" in r
    # at least one row carries a proposed UNS path with a numeric confidence
    assert any(r["uns_path_proposed"] and r["confidence"] for r in rows)
