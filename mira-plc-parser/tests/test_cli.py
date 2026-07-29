"""CLI + report-generation tests -- the Phase-1 user-facing surface.

Covers: running from source, writing local report files, --format selection, closed-project
rejection with export instructions, the JSON report shape (enum-safe round-trip), and exit codes.
All offline -- no LLM, no network.
"""
import json
import shutil

from mira_plc_parser import render_json, run
from mira_plc_parser.cli import main


def _copy_fixture(fixtures, name, dest_dir):
    dest = dest_dir / name
    shutil.copyfile(fixtures / name, dest)
    return dest


# ---- happy path: analyze a real export ----

def test_analyze_writes_both_reports(fixtures, tmp_path):
    src = _copy_fixture(fixtures, "conveyor.L5X", tmp_path)
    out = tmp_path / "out"
    rc = main(["analyze", str(src), "--out", str(out), "--quiet"])
    assert rc == 0

    md = out / "conveyor.report.md"
    js = out / "conveyor.report.json"
    assert md.is_file() and js.is_file()
    assert "MIRA PLC Parser report" in md.read_text(encoding="utf-8")

    data = json.loads(js.read_text(encoding="utf-8"))
    assert data["handled"] is True
    assert data["schema"] == "mira-plc-parser/report@1"
    assert data["counts"]["tags"] > 0
    # the conveyor fixture is built with VFD tags + an e-stop to exercise these paths
    assert data["vfd_signal_candidates"], "expected VFD-signal candidates from the fixture"
    assert data["review_required"], "expected a safety review flag from the e-stop"


def test_format_md_only(fixtures, tmp_path):
    src = _copy_fixture(fixtures, "conveyor.L5X", tmp_path)
    out = tmp_path / "out"
    rc = main(["analyze", str(src), "--out", str(out), "--format", "md", "--quiet"])
    assert rc == 0
    assert (out / "conveyor.report.md").is_file()
    assert not (out / "conveyor.report.json").exists()


def test_format_json_only(fixtures, tmp_path):
    src = _copy_fixture(fixtures, "conveyor.L5X", tmp_path)
    out = tmp_path / "out"
    rc = main(["analyze", str(src), "--out", str(out), "--format", "json", "--quiet"])
    assert rc == 0
    assert (out / "conveyor.report.json").is_file()
    assert not (out / "conveyor.report.md").exists()


def test_csv_export_is_handled(fixtures, tmp_path):
    src = _copy_fixture(fixtures, "gs10_tags.csv", tmp_path)
    out = tmp_path / "out"
    rc = main(["analyze", str(src), "--out", str(out), "--quiet"])
    assert rc == 0
    data = json.loads((out / "gs10_tags.report.json").read_text(encoding="utf-8"))
    assert data["handled"] is True
    assert data["counts"]["tags"] > 0


# ---- closed vendor project file: reject with export instructions ----

def test_closed_acd_is_rejected_with_guidance(tmp_path, capsys):
    # a renamed/binary .ACD: detect() keys off the extension and returns needs_export
    acd = tmp_path / "pump_line.acd"
    acd.write_bytes(b"\x00\x01RSLogix binary project\x00\x02" * 8)
    out = tmp_path / "out"
    rc = main(["analyze", str(acd), "--out", str(out), "--quiet"])
    assert rc == 3

    err = capsys.readouterr().err.lower()
    assert "export" in err and "l5x" in err

    # a report.md is still written, carrying the action-needed guidance
    md = (out / "pump_line.report.md").read_text(encoding="utf-8")
    assert "action needed" in md.lower()

    # the JSON report marks it unhandled and parsed nothing
    data = json.loads((out / "pump_line.report.json").read_text(encoding="utf-8"))
    assert data["handled"] is False
    assert data["detection"]["needs_export"]


# ---- error handling ----

def test_missing_file_returns_1(tmp_path):
    rc = main(["analyze", str(tmp_path / "nope.L5X"), "--out", str(tmp_path / "out"), "--quiet"])
    assert rc == 1


# ---- report generation unit: render_json round-trips (guards enum serialization) ----

def test_render_json_round_trips(conveyor_l5x):
    result = run("conveyor.L5X", conveyor_l5x)
    payload = render_json(result)
    # must be json.dumps-safe (no Confidence enum leaking through)
    restored = json.loads(json.dumps(payload))
    assert restored["handled"] is True
    assert restored["counts"]["tags"] == payload["counts"]["tags"]
    for f in restored["fault_candidates"]:
        assert isinstance(f["confidence"], str)
