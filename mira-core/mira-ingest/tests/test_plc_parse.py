"""Tests for the /ingest/plc-parse endpoint — offline PLC export -> report + UNS + i3X.

The endpoint is thin, deterministic glue over the stdlib-only `mira_plc_parser` (whose own
52-test suite covers the parse/UNS/i3X logic). These tests assert the HTTP contract: a real
L5X export parses to a report with proposed UNS candidates + an i3X payload, and a closed
vendor project file is rejected with actionable export guidance.
"""

import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# ingest service modules (main.py) live one dir up
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
# the stdlib-only parser package lives at repo-root/mira-plc-parser (not yet pip-installed in
# the ingest image — see the endpoint's lazy import + 503 fallback); put it on the path for tests.
_PARSER_PKG = Path(__file__).resolve().parents[3] / "mira-plc-parser"
if str(_PARSER_PKG) not in sys.path:
    sys.path.insert(0, str(_PARSER_PKG))

import main as ingest_main  # noqa: E402

client = TestClient(ingest_main.app)

_L5X = (_PARSER_PKG / "tests" / "fixtures" / "conveyor.L5X").read_bytes()


def test_plc_parse_l5x_returns_report_uns_and_i3x():
    resp = client.post(
        "/ingest/plc-parse",
        files={"file": ("conveyor.L5X", _L5X, "application/xml")},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    report = body["report"]
    assert report["handled"] is True
    assert report["controller"] == "ConveyorCell"
    # one proposed UNS path per tag, all 'proposed' (never auto-verified)
    assert len(report["uns_candidates"]) == len(report["tag_dictionary"])
    assert all(c["source"] == "proposed" for c in report["uns_candidates"])
    freq = next(c for c in report["uns_candidates"] if c["tag"] == "VFD_Frequency")
    assert freq["path"] == "enterprise/site1/area1/conveyorcell/vfd/frequency"
    assert freq["confidence"] == "high"
    # i3X payload present and self-consistent
    i3x = body["i3x"]
    assert i3x["namespace"]["uri"] == "urn:mira:plc-parser:uns"
    ids = {n["elementId"] for n in i3x["objectInstances"]}
    assert "enterprise/site1/area1/conveyorcell/vfd/frequency" in ids


def test_plc_parse_prefix_override_rewrites_upper_levels():
    resp = client.post(
        "/ingest/plc-parse",
        files={"file": ("conveyor.L5X", _L5X, "application/xml")},
        data={"site": "Plant 2", "line": "Line 3"},
    )
    assert resp.status_code == 200, resp.text
    freq = next(c for c in resp.json()["report"]["uns_candidates"] if c["tag"] == "VFD_Frequency")
    assert freq["path"] == "enterprise/plant_2/area1/line_3/vfd/frequency"


def test_plc_parse_include_i3x_false_omits_payload():
    resp = client.post(
        "/ingest/plc-parse",
        files={"file": ("conveyor.L5X", _L5X, "application/xml")},
        data={"include_i3x": "false"},
    )
    assert resp.status_code == 200, resp.text
    assert "i3x" not in resp.json()


def test_plc_parse_closed_project_rejected_with_export_guidance():
    resp = client.post(
        "/ingest/plc-parse",
        files={"file": ("Line.ACD", b"\x00\x01binary rockwell project\x00", "application/octet-stream")},
    )
    assert resp.status_code == 422
    # actionable guidance, not a crash or a bare "unknown"
    assert "export" in resp.json()["detail"].lower()


def test_plc_parse_empty_file_rejected():
    resp = client.post(
        "/ingest/plc-parse",
        files={"file": ("empty.L5X", b"", "application/xml")},
    )
    assert resp.status_code == 422


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
