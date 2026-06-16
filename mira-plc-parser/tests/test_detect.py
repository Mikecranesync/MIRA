"""Format detector tests -- content-first, extension fallback."""
from mira_plc_parser.detect import detect


def test_detects_l5x_by_content(conveyor_l5x):
    d = detect("anything.txt", conveyor_l5x)   # renamed file still detected by content
    assert d.fmt == "rockwell_l5x"
    assert d.confidence == "high"


def test_detects_l5x_by_extension():
    d = detect("Plant.L5X", "not really xml content")
    assert d.fmt == "rockwell_l5x"
    assert d.confidence == "medium"


def test_detects_csv_by_content(gs10_csv):
    d = detect("export", gs10_csv)
    assert d.fmt == "csv_tags"


def test_detects_structured_text():
    st = "PROGRAM Main\nVAR x : BOOL; END_VAR\n x := TRUE;\nEND_PROGRAM\n"
    d = detect("logic.st", st)
    assert d.fmt == "structured_text"


def test_detects_plcopen_xml():
    xml = '<?xml version="1.0"?><project xmlns="http://www.plcopen.org/xml/tc6_0201"></project>'
    d = detect("proj.xml", xml)
    assert d.fmt == "plcopen_xml"
    assert d.confidence == "high"


def test_unknown_pdf_is_low_confidence():
    d = detect("drawing.pdf", "%PDF-1.7 binary...")
    assert d.fmt == "unknown"
    assert d.confidence == "low"
