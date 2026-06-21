"""Tests for tag_csv.py -- the vendor-agnostic PLC tag-export CSV parser.

Covers the real export shapes from Rockwell Studio 5000, Siemens TIA Portal, Kepware/KEPServerEX,
and generic tools, plus delimiter/header/datatype edge cases. Pure module (no system.* imports),
loaded the same way as the other diagnose pure modules.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
TAG_CSV = REPO / "ignition" / "webdev" / "FactoryLM" / "api" / "diagnose" / "tag_csv.py"


def _load(path, name):
    assert path.exists(), "missing module under test: %s" % path
    spec = importlib.util.spec_from_file_location(name, str(path))
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def tc():
    return _load(TAG_CSV, "tag_csv_uut")


# ---- real-shaped vendor fixtures ----

ROCKWELL = (
    'remark,"CSV-Import-Export"\n'
    'remark,"Date = Mon Jun 16 08:00:00 2026"\n'
    'remark,"Version = RSLogix 5000 v34.00"\n'
    'TYPE,SCOPE,NAME,DESCRIPTION,DATATYPE,SPECIFIER,ATTRIBUTES\n'
    'TAG,,Drive3_OutputHz,"VFD output frequency",REAL,,(RADIX := Float)\n'
    'TAG,,Drive3_Amps,"Motor current",REAL,,(RADIX := Float)\n'
    'TAG,,Drive3_FaultCode,"Active fault",DINT,,(RADIX := Decimal)\n'
    'TAG,,Drive3_CommOK,"Drive comms healthy",BOOL,,(RADIX := Decimal)\n'
    'COMMENT,,Drive3_Amps,"this is a comment row, not a tag",,,\n'
)

# Siemens TIA Portal PLC tag table export (semicolon-delimited, European locale)
SIEMENS = (
    'Name;Path;Data Type;Logical Address;Comment\n'
    'Drive3_OutputHz;Drive3;Real;%MD100;VFD output frequency\n'
    'Drive3_Amps;Drive3;Real;%MD104;Motor current\n'
    'Drive3_FaultCode;Drive3;Int;%MW108;Active fault code\n'
    'Drive3_CommOK;Drive3;Bool;%M10.0;Drive comms healthy\n'
)

KEPWARE = (
    'Tag Name,Address,Data Type,Respect Data Type,Client Access,Scan Rate,Scaling,Description\n'
    'Drive3_OutputHz,40001,Float,1,R,100,None,VFD output frequency\n'
    'Drive3_Amps,40003,Float,1,R,100,None,Motor current\n'
    'Drive3_FaultCode,40005,Word,1,R,100,None,Active fault\n'
    'Drive3_CommOK,000001,Boolean,1,R,100,None,Comms healthy\n'
)

GENERIC = (
    'name,type,units,value\n'
    'OutputHz,REAL,Hz,47.3\n'
    'Amps,REAL,A,6.2\n'
    'FaultCode,INT,,0\n'
    'CommOK,BOOL,,true\n'
)


def _by_name(parsed):
    return dict((t["name"], t) for t in parsed["tags"])


# ---- datatype normalization ----

def test_normalize_floats(tc):
    for raw in ("REAL", "LReal", "FLOAT", "real32", "REAL[10]", "Real (LReal)"):
        kind, dt = tc.normalize_datatype(raw)
        assert kind == tc.ANALOG, raw
        assert "float" in dt.lower()


def test_normalize_ints(tc):
    for raw in ("INT", "DINT", "Word", "DWORD", "UDINT", "Int32"):
        kind, dt = tc.normalize_datatype(raw)
        assert kind == tc.INTEGER, raw
        assert "int" in dt.lower()


def test_normalize_bool_string_unknown(tc):
    assert tc.normalize_datatype("BOOL")[0] == tc.BOOL
    assert tc.normalize_datatype("Boolean")[1] == "Boolean"
    assert tc.normalize_datatype("STRING(82)")[0] == tc.STRING
    assert tc.normalize_datatype("UDT_MyMotor")[0] == tc.UNKNOWN
    assert tc.normalize_datatype("")[0] == tc.UNKNOWN


# ---- Rockwell ----

def test_rockwell_format_detected(tc):
    p = tc.parse(ROCKWELL)
    assert p["format"] == "rockwell_logix"
    assert p["delimiter"] == ","


def test_rockwell_skips_preamble_and_comment_rows(tc):
    p = tc.parse(ROCKWELL)
    names = [t["name"] for t in p["tags"]]
    assert names == ["Drive3_OutputHz", "Drive3_Amps", "Drive3_FaultCode", "Drive3_CommOK"]
    # the COMMENT row must not appear as a tag
    assert p["count"] == 4
    assert any("preamble" in w for w in p["warnings"])


def test_rockwell_datatypes_and_desc(tc):
    t = _by_name(tc.parse(ROCKWELL))
    assert t["Drive3_OutputHz"]["kind"] == tc.ANALOG
    assert t["Drive3_FaultCode"]["kind"] == tc.INTEGER
    assert t["Drive3_CommOK"]["kind"] == tc.BOOL
    assert t["Drive3_Amps"]["description"] == "Motor current"


# ---- Siemens ----

def test_siemens_semicolon_and_format(tc):
    p = tc.parse(SIEMENS)
    assert p["delimiter"] == ";"
    assert p["format"] == "siemens_tia"
    assert p["count"] == 4


def test_siemens_address_and_kind(tc):
    t = _by_name(tc.parse(SIEMENS))
    assert t["Drive3_OutputHz"]["address"] == "%MD100"
    assert t["Drive3_OutputHz"]["kind"] == tc.ANALOG
    assert t["Drive3_CommOK"]["address"] == "%M10.0"
    assert t["Drive3_CommOK"]["kind"] == tc.BOOL


# ---- Kepware ----

def test_kepware_format_and_address(tc):
    p = tc.parse(KEPWARE)
    assert p["format"] == "kepware"
    t = _by_name(p)
    assert t["Drive3_OutputHz"]["address"] == "40001"
    assert t["Drive3_OutputHz"]["kind"] == tc.ANALOG
    assert t["Drive3_FaultCode"]["kind"] == tc.INTEGER  # Word -> integer


# ---- generic + inference ----

def test_generic_units_and_values(tc):
    t = _by_name(tc.parse(GENERIC))
    assert t["OutputHz"]["unit"] == "Hz"
    assert t["OutputHz"]["sample"] == "47.3"
    assert t["OutputHz"]["kind"] == tc.ANALOG


def test_generic_infers_kind_from_value_when_no_datatype(tc):
    csv = "name,value\nSpeed,47.3\nCount,12\nRunning,true\nLabel,hello\n"
    t = _by_name(tc.parse(csv))
    assert t["Speed"]["kind"] == tc.ANALOG
    assert t["Count"]["kind"] == tc.INTEGER
    assert t["Running"]["kind"] == tc.BOOL
    assert t["Label"]["kind"] == tc.STRING


# ---- edge cases ----

def test_quoted_field_with_comma(tc):
    csv = 'name,datatype,description\nTag1,REAL,"amps, scaled x100"\n'
    t = _by_name(tc.parse(csv))
    assert t["Tag1"]["description"] == "amps, scaled x100"


def test_bom_is_stripped(tc):
    csv = "\xef\xbb\xbf" + "name,type\nTagA,REAL\n"
    p = tc.parse(csv)
    assert p["count"] == 1
    assert p["tags"][0]["name"] == "TagA"


def test_blank_and_empty_input(tc):
    assert tc.parse("")["count"] == 0
    assert tc.parse("\n\n  \n")["count"] == 0


def test_bare_name_list_no_header(tc):
    p = tc.parse("vfd_frequency\nvfd_current\nvfd_fault_code\n")
    assert p["count"] == 3
    assert any("no header" in w for w in p["warnings"])
    assert p["tags"][0]["name"] == "vfd_frequency"


def test_skips_nameless_rows(tc):
    csv = "name,datatype\n,REAL\nGoodTag,REAL\n"
    p = tc.parse(csv)
    assert [t["name"] for t in p["tags"]] == ["GoodTag"]


# ---- integration shape (Hub + wizard compatibility) ----

def test_to_scan_rows_shape_matches_wizard_scan(tc):
    """to_scan_rows must emit [{path, dt}] like _scan_all so scan_for_role works unchanged."""
    p = tc.parse(ROCKWELL)
    rows = tc.to_scan_rows(p)
    assert len(rows) == 4
    for r in rows:
        assert set(r.keys()) == set(["path", "dt"])
        assert r["path"].startswith("csv:")
    # an analog tag carries a Float dt so the analog role filter (substring 'float'/'int') matches
    hz = [r for r in rows if r["path"].endswith("Drive3_OutputHz")][0]
    assert "float" in hz["dt"].lower()


def test_canonical_record_has_hub_compatible_fields(tc):
    """Every record carries the fields the future Hub CanonicalTag / ai_suggestions model needs."""
    t = tc.parse(SIEMENS)["tags"][0]
    for field in ("name", "datatype", "kind", "dt", "address", "description", "unit",
                  "sample", "source_format"):
        assert field in t, field
