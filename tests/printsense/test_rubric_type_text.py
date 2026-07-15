"""Rubric convention split: schematic device TAGS vs catalog/type TEXT.

Implements the 2026-07-14 sheet-20 case-study decision (docs/eval/
2026-07-14-printsense-sheet20-case-study.md §7): a catalog/family code like
``ITS.LWL-K-01.2`` must not be graded in the same lane as schematic device
designations (``-21/A13``). The strict-A device gate covers schematic tags
only; type/catalog text gets its own 5-point lane inside the 20-point device
bucket, with no A-gate of its own. A confidently-asserted WRONG catalog code
still counts as a confident misread (a wrong part number is worse than a
hedge).

LLM-disabled, no network — pure grader semantics.
"""

import json
from pathlib import Path

from printsense import grader
from printsense.grade_case import grade_case

BENCH = Path(__file__).resolve().parents[2] / "printsense" / "benchmarks" / "scu2_sheet20"


def _rubric(with_type_text: bool = True) -> dict:
    r = {
        "case": "type-text-split",
        "package": {"drawing_no": "AP1", "sheet": "20"},
        "categories": {
            "device": {"expected": ["-21/A13", "-21/A14"], "known_misreads": ["J1"]},
            "wire": {"expected": ["-W1"], "known_misreads": []},
            "xref": {"expected": ["15.7"], "known_misreads": []},
        },
        "structure": [],
        "should_be_unresolved": [],
    }
    if with_type_text:
        r["categories"]["type_text"] = {
            "expected": ["ITS.LWL-K-01.2"],
            "known_misreads": ["ITS.LWL-K-01.3"],
        }
    return r


def _graph(device_type: str | None = None) -> dict:
    dev1 = {"tag": "-21/A13", "trust": "proposed", "connects": []}
    if device_type is not None:
        dev1["type"] = device_type
    return {
        "package": {"drawing_no": "AP1", "sheet": "20"},
        "devices": [dev1, {"tag": "-21/A14", "trust": "proposed", "connects": []}],
        "conductors": [{"tag": "-W1", "trust": "proposed", "connects": []}],
        "off_page_references": [{"tag": "15.7", "trust": "proposed", "connects": []}],
        "unresolved": [],
    }


def test_missing_type_text_does_not_block_device_gate():
    """Honestly hedging a blurred catalog code costs the 5-point type lane only —
    the device-tag gate and strict-A stay intact."""
    res = grader.grade(_graph(), _rubric())
    assert res["device"]["f1"] == 1.0
    assert res["type_text"]["f1"] == 0.0
    assert res["gates"]["device_f1_ge_085"] is True
    assert res["scores"]["device"] == 15.0
    assert res["scores"]["type_text"] == 0.0
    assert res["is_A"] is True


def test_found_type_text_fills_the_bucket():
    res = grader.grade(_graph(device_type="ITS.LWL-K-01.2"), _rubric())
    assert res["type_text"]["f1"] == 1.0
    assert res["scores"]["type_text"] == 5.0
    assert res["scores"]["device"] + res["scores"]["type_text"] == 20.0
    assert res["overall"] == 100.0


def test_wrong_type_text_is_a_confident_misread():
    res = grader.grade(_graph(device_type="ITS.LWL-K-01.3"), _rubric())
    assert res["type_text"]["misreads"] == ["ITS.LWL-K-01.3"]
    assert res["confident_misreads"] == 1
    assert res["letter"] == "C"  # misread caps the letter
    assert res["is_A"] is False


def test_legacy_rubric_without_type_text_is_unchanged():
    """atv340-shaped rubrics (device/wire/xref only) keep the full 20-point
    device weight and identical gate keys."""
    res = grader.grade(_graph(), _rubric(with_type_text=False))
    assert res["scores"]["device"] == 20.0
    assert res["scores"]["type_text"] == 0.0
    assert res["type_text"]["expected"] == 0
    assert res["overall"] == 100.0
    assert set(res["gates"]) == {
        "overall_ge_90",
        "zero_confident_misreads",
        "package_id_full",
        "device_f1_ge_085",
        "wire_f1_ge_085",
        "zero_trust_violations",
    }


def test_format_report_names_the_type_text_lane():
    res = grader.grade(_graph(), _rubric())
    assert "type_text" in grader.format_report(res)


def test_sheet20_frozen_response_b_reaches_strict_A_under_new_convention():
    """The real case the decision was made on: Response B read the tags cleanly
    and honestly hedged the catalog code — under the corrected rubric that is
    strict-A, not a device-gate failure."""
    graph = json.loads((BENCH / "response_b.graph.json").read_text(encoding="utf-8"))
    rubric = json.loads((BENCH / "rubric.json").read_text(encoding="utf-8"))
    assert "type_text" in rubric["categories"], "sheet-20 rubric must carry the split"
    assert "ITS.LWL-K-01.2" not in rubric["categories"]["device"]["expected"]
    res = grader.grade(graph, rubric)
    assert res["device"]["f1"] == 1.0
    assert res["letter"] == "A"
    assert res["is_A"] is True


def test_grade_case_envelope_carries_type_text(tmp_path):
    gpath = tmp_path / "g.json"
    rpath = tmp_path / "r.json"
    gpath.write_text(json.dumps(_graph(device_type="ITS.LWL-K-01.3")), encoding="utf-8")
    rpath.write_text(json.dumps(_rubric()), encoding="utf-8")
    env = grade_case(gpath, rpath)
    assert env["metric_results"]["type_text_f1"] == 0.0
    assert "ITS.LWL-K-01.3" in env["confident_misreads"]
    assert "confident_misread" in env["import_blocking_failures"]
