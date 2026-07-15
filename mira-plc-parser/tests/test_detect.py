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


def test_acd_is_recognized_as_closed_project_not_great():
    """A Rockwell .ACD is the proprietary binary project -- we do NOT parse it; we ask for L5X."""
    d = detect("PlantLine.ACD", "\x00\x01\x02 binary studio5000 project bytes")
    assert d.fmt == "rockwell_acd"
    assert d.confidence == "high"
    assert d.needs_export
    assert "L5X" in d.needs_export


def test_rss_is_recognized_as_closed_project_with_report_guidance():
    d = detect("Flying School.RSS", "\x00\x01 rslogix 500 binary bytes")
    assert d.fmt == "rockwell_acd"
    assert "tag/program" in d.needs_export


def test_step7_project_is_recognized_as_closed_project_with_source_guidance():
    d = detect("2400WK0352.S7P", "\x00 step 7 project bytes")
    assert d.fmt == "step7_project"
    assert "symbol table" in d.needs_export


def test_dno_drive_config_is_recognized_as_closed_config_with_export_guidance():
    d = detect("Vehicle_1_Drive.dno", "\x00 drive executive config bytes")
    assert d.fmt == "drive_config_binary"
    assert "drive parameter" in d.needs_export.lower()


def test_siemens_tia_project_asks_for_openness_export():
    d = detect("Line3.ap17", "\x00binary tia project")
    assert d.fmt == "siemens_tia_project"
    assert "Openness" in d.needs_export


def test_codesys_project_asks_for_plcopen():
    d = detect("machine.project", "\x00binary codesys")
    assert d.fmt == "codesys_project"
    assert "PLCopen" in d.needs_export


def test_archive_asks_to_unpack():
    d = detect("backup.zip", "PK\x03\x04 binary zip")
    assert d.fmt == "archive"
    assert d.needs_export


def test_renamed_binary_acd_detected_by_content():
    d = detect("project.txt", "\x00\x00 lots of\x01 binary \x02bytes here")
    assert d.fmt == "rockwell_acd"
    assert d.needs_export
