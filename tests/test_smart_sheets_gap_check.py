"""tools/smart-sheets/gap_check.py — deterministic gap-check for measurement sheets.

Mutation harness: GAP_CHECK_MODULE may point at a deliberately broken copy
(.claude/rules/prove-the-test-fails.md).
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = Path(
    os.environ.get("GAP_CHECK_MODULE", ROOT / "tools" / "smart-sheets" / "gap_check.py")
)
FIXTURE = ROOT / "tools" / "smart-sheets" / "fixtures" / "brake-gap-synthetic.csv"


def _load():
    spec = importlib.util.spec_from_file_location("gap_check", MODULE_PATH)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules["gap_check"] = mod
    spec.loader.exec_module(mod)
    return mod


gc = _load()
LIM = gc.Limit(0.8, 2.0, "mm", "inclusive", "FP-BRK-01 rev 2 §4.2")


def test_boundary_rules_inclusive_and_exclusive():
    assert gc.check_reading(gc.Reading(0.8, "mm"), LIM).status == "pass"
    assert gc.check_reading(gc.Reading(2.0, "mm"), LIM).status == "pass"
    excl = gc.Limit(0.8, 2.0, "mm", "exclusive", LIM.source)
    assert gc.check_reading(gc.Reading(0.8, "mm"), excl).status == "fail"
    assert gc.check_reading(gc.Reading(1.9, "mm"), excl).status == "pass"


def test_out_of_range_fails_with_traceable_reason():
    r = gc.check_reading(gc.Reading(2.3, "mm"), LIM)
    assert r.status == "fail"
    assert "FP-BRK-01" in r.reasons[-1] and r.limit_source == LIM.source
    assert r.notice == gc.NOTICE


def test_missing_or_conflicting_limit_is_unassessed_never_pass():
    assert (
        gc.check_reading(gc.Reading(1.0, "mm"), gc.Limit(None, 2.0, "mm", "inclusive", "x")).status
        == "unassessed"
    )
    assert (
        gc.check_reading(gc.Reading(1.0, "mm"), gc.Limit(0.8, 2.0, "mm", "inclusive", None)).status
        == "unassessed"
    )
    assert (
        gc.check_reading(gc.Reading(1.0, "mm"), gc.Limit(2.0, 0.8, "mm", "inclusive", "x")).status
        == "unassessed"
    )
    assert (
        gc.check_reading(gc.Reading(1.0, "mm"), gc.Limit(0.8, 2.0, "mm", "about", "x")).status
        == "unassessed"
    )


def test_unit_mismatch_needs_explicit_conversion():
    r = gc.check_reading(gc.Reading(0.05, "in"), LIM)
    assert r.status == "unassessed" and "conversion" in r.reasons[0]
    c = gc.check_reading(gc.Reading(0.05, "in"), LIM, convert=True)
    assert c.status == "pass" and c.compared_unit == "mm" and abs(c.compared_value - 1.27) < 1e-9
    assert "explicit" in c.reasons[0]
    assert gc.check_reading(gc.Reading(1.0, "cm"), LIM, convert=True).status == "unassessed"


def test_missing_reading_is_incomplete():
    r = gc.check_reading(gc.Reading(None, "mm"), LIM)
    assert r.status == "incomplete"


def test_photo_value_unassessed_until_confirmed():
    assert (
        gc.check_reading(gc.Reading(1.0, "mm", source="photo", confirmed=False), LIM).status
        == "unassessed"
    )
    assert (
        gc.check_reading(gc.Reading(1.0, "mm", source="photo", confirmed=True), LIM).status
        == "pass"
    )


def test_sheet_summary_exceptions_and_completeness():
    res = gc.run_sheet(gc.read_csv(FIXTURE), convert=True)
    by = {r["point_id"]: r for r in res["rows"]}
    assert by["DEMO-CAL-1"]["after"]["status"] == "pass"
    assert by["DEMO-CAL-2"]["after"]["status"] == "pass"  # at the inclusive lower bound
    assert by["DEMO-CAL-3"]["after"]["status"] == "fail"
    assert by["DEMO-CAL-4"]["after"]["status"] == "unassessed"  # photo, not confirmed
    assert by["DEMO-CAL-4"]["before"]["status"] == "pass"  # photo, confirmed, converted in→mm
    assert by["DEMO-CAL-5"]["after"]["status"] == "incomplete"
    assert by["DEMO-CAL-6"]["after"]["status"] == "unassessed"  # no limit on file
    assert res["summary"] == {"pass": 2, "fail": 1, "unassessed": 2, "incomplete": 1}
    assert res["exceptions"] == ["DEMO-CAL-3", "DEMO-CAL-4", "DEMO-CAL-5", "DEMO-CAL-6"]
    assert res["complete"] is False
    assert res["notice"] == gc.NOTICE


def test_cli_writes_json_and_csv(tmp_path):
    assert gc.main([str(FIXTURE), "--convert", "--out", str(tmp_path)]) == 0
    data = json.loads((tmp_path / "results.json").read_text())
    assert data["summary"]["fail"] == 1
    csv_text = (tmp_path / "results.csv").read_text()
    assert "DEMO-CAL-3,pass,1.9,fail,2.3,mm" in csv_text
    assert gc.NOTICE in csv_text
