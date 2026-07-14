"""Unit tests for the stable two-axis grade interface (``printsense.grade_case``).

These pin the *contract* (envelope shape + tier logic + the G11 invariant) that the
skill, runner, report, and CI all depend on. The structural gates themselves are
tested in a later PR; here we prove the interface is stable and self-consistent.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from printsense import grade_case as gc

_ROOT = Path(__file__).resolve().parents[2]
_SCU2_GRAPH = _ROOT / "printsense" / "fixtures" / "scu2" / "graph.json"
_SCU2_RUBRIC = _ROOT / "printsense" / "benchmarks" / "scu2_sheet20" / "rubric.json"


def test_tier_mapping_pass_path():
    assert gc._tier(92, "PASS", []) == "AUTO_IMPORT"
    assert gc._tier(80, "PASS", []) == "APPROVABLE_WITH_FIELD_VERIFICATION"
    assert gc._tier(60, "PASS", []) == "USEFUL_DRAFT"
    assert gc._tier(59, "PASS", []) == "REJECT"
    assert gc._tier(None, "PASS", []) is None


def test_tier_import_fail_demotes_high_scores():
    # An unsafe graph (import_verdict=FAIL) can never be AUTO_IMPORT or APPROVABLE,
    # no matter how fluent — it is at best a USEFUL_DRAFT. This is the ATV340 shape.
    assert gc._tier(92, "FAIL", []) == "USEFUL_DRAFT"
    assert gc._tier(80, "FAIL", []) == "USEFUL_DRAFT"
    assert gc._tier(50, "FAIL", []) == "REJECT"


def test_tier_safety_critical_misread_demotes():
    assert gc._tier(95, "PASS", ["STO_A"]) == "USEFUL_DRAFT"


def test_grade_case_no_rubric_is_wellformed(tmp_path):
    # Without a frozen rubric there is no ground truth: ungraded, but still a valid
    # envelope, and never importable.
    graph = tmp_path / "extraction.json"
    graph.write_text(json.dumps({"package": {}, "devices": []}), encoding="utf-8")
    r = gc.grade_case(graph, rubric_path=None)
    assert set(r) == set(gc.ENVELOPE_KEYS)
    assert r["score"] is None
    assert r["quality_tier"] is None
    assert r["import_verdict"] == "PASS"  # no truth-free structural gates until PR2
    assert r["bot_importable"] is False


@pytest.mark.skipif(
    not (_SCU2_GRAPH.exists() and _SCU2_RUBRIC.exists()),
    reason="scu2 fixture/rubric not present on this base",
)
def test_grade_case_envelope_and_g11_invariant():
    r = gc.grade_case(_SCU2_GRAPH, _SCU2_RUBRIC)
    assert set(r) == set(gc.ENVELOPE_KEYS)
    assert r["import_verdict"] in ("PASS", "FAIL")
    assert r["quality_tier"] in (
        "AUTO_IMPORT",
        "APPROVABLE_WITH_FIELD_VERIFICATION",
        "USEFUL_DRAFT",
        "REJECT",
    )
    # G11: bot_importable can never be true under a FAIL verdict, and only ever true
    # in the AUTO_IMPORT/PASS corner.
    if r["import_verdict"] == "FAIL":
        assert r["bot_importable"] is False
    if r["bot_importable"]:
        assert r["quality_tier"] == "AUTO_IMPORT" and r["import_verdict"] == "PASS"
    # import_verdict is a pure function of the blocking list.
    assert (r["import_verdict"] == "FAIL") == bool(r["import_blocking_failures"])
