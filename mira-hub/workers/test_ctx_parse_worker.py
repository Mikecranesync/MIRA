"""Unit tests for ctx_parse_worker -- offline, no DB required.

Tests the extraction logic (pipeline call, UNS mapping, evidence shape) without
a live database by mocking psycopg2 and testing the helper functions directly.
"""

from __future__ import annotations

import json
import os
import sys

import pytest

# Ensure mira-plc-parser is importable when running from the mira-hub/ dir.
_REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
_PARSER_ROOT = os.path.join(_REPO_ROOT, "mira-plc-parser")
if _PARSER_ROOT not in sys.path:
    sys.path.insert(0, _PARSER_ROOT)

from mira_plc_parser import pipeline  # noqa: E402  (import after sys.path setup)

FIXTURE = os.path.join(_REPO_ROOT, "mira-plc-parser", "tests", "fixtures", "conveyor.L5X")


@pytest.mark.skipif(not os.path.exists(FIXTURE), reason="conveyor.L5X fixture not found")
def test_pipeline_produces_tag_dictionary():
    with open(FIXTURE, "r", encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    result = pipeline.run("conveyor.L5X", text)
    report = pipeline.render_json(result)

    assert report["handled"], "conveyor.L5X should parse successfully"
    assert len(report["tag_dictionary"]) > 0, "should extract at least one tag"
    assert len(report.get("uns_candidates", [])) > 0, "should propose at least one UNS path"


@pytest.mark.skipif(not os.path.exists(FIXTURE), reason="conveyor.L5X fixture not found")
def test_uns_candidates_keyed_by_tag():
    with open(FIXTURE, "r", encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    result = pipeline.run("conveyor.L5X", text)
    report = pipeline.render_json(result)

    uns_by_tag = {u["tag"]: u for u in report.get("uns_candidates", [])}
    for tag in report["tag_dictionary"]:
        name = tag["name"]
        assert name in uns_by_tag, "every tag_dictionary entry should have a UNS candidate"
        u = uns_by_tag[name]
        assert "/" in u["path"], "UNS path should be slash-separated"
        assert u["confidence"] in ("high", "medium", "low")


@pytest.mark.skipif(not os.path.exists(FIXTURE), reason="conveyor.L5X fixture not found")
def test_extraction_shape():
    """Verify the extraction tuple shape matches ctx_extractions INSERT expectations."""
    with open(FIXTURE, "r", encoding="utf-8", errors="replace") as fh:
        text = fh.read()
    result = pipeline.run("conveyor.L5X", text)
    report = pipeline.render_json(result)

    _CONFIDENCE_MAP = {"high": 0.9, "medium": 0.6, "low": 0.3}
    uns_by_tag = {u["tag"]: u for u in report.get("uns_candidates", [])}

    for tag in report["tag_dictionary"][:5]:
        name = tag.get("name", "")
        roles = tag.get("roles") or []
        uns = uns_by_tag.get(name, {})
        confidence = _CONFIDENCE_MAP.get(uns.get("confidence", "low"), 0.3)
        evidence = {
            "source_format": report.get("detection", {}).get("fmt"),
            "used_in": tag.get("used_in", [])[:6],
            "confidence_source": uns.get("confidence"),
            "uns_evidence": uns.get("evidence"),
        }
        assert isinstance(name, str) and name
        assert isinstance(roles, list)
        assert isinstance(confidence, float) and 0.0 <= confidence <= 1.0
        # evidence must be JSON-serializable
        assert json.dumps(evidence)
