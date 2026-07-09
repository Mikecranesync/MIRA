"""Tests for the flywheel benchmark harness (pure — no DB, no network).

Two jobs:
  1. The healthy fixture scores 100 / PASS (guards every stage as a regression).
  2. The graders can actually FAIL on a broken stage — so a green 100 is
     meaningful, not vacuous (a grader that always passes proves nothing).
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

_MOD_PATH = Path(__file__).resolve().parents[1] / "tools" / "flywheel_benchmark.py"
_spec = importlib.util.spec_from_file_location("flywheel_benchmark", _MOD_PATH)
bench = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bench)


# --- 1. the healthy fixture is a clean 100 --------------------------------


def test_healthy_fixture_scores_100_and_passes():
    result = bench.run_benchmark()
    assert result["overall"] == 100.0
    assert result["passed"] is True
    assert len(result["criteria"]) == 5
    for c in result["criteria"]:
        assert c["score"] == 100.0, f"{c['name']} regressed: {c}"


def test_report_renders_pass():
    out = bench.render_report(bench.run_benchmark())
    assert "Overall: 100.0% — PASS" in out
    assert "Gate safety" in out


# --- 2. the graders detect real regressions (falsifiability) --------------


def test_gap_surfacing_fails_if_report_misranks():
    rows = bench.build_fixture()
    report = bench.gap_report.aggregate_gaps(bench._unmatched_gap_rows(rows), generated_at="t")
    # Sabotage the ranking: force a non-P01.24 token to the top of durapulse_gs10.
    gs10 = next(p for p in report["packs"] if p["pack_id"] == "durapulse_gs10")
    gs10["tokens"].reverse()  # P01.24 (most-asked) is no longer first
    assert gs10["tokens"][0]["token"] != "P01.24"  # sabotage is real, not a no-op
    assert bench.grade_gap_surfacing(rows, report)["score"] < 100.0


def test_distill_precision_fails_if_unregistered_pack_suggested():
    rows = bench.build_fixture()
    # A suggestion for the unregistered pack is exactly what must NOT happen.
    bad_suggestions = [{"extracted_data": {"pack_id": "acme_x999", "registry_manual_id": "x"}}]
    g = bench.grade_distill_precision(rows, bad_suggestions)
    assert g["score"] < 100.0


def test_gate_safety_fails_if_suggestion_not_review_only():
    rows = bench.build_fixture()
    unsafe = [{"extracted_data": {"pack_id": "durapulse_gs10", "review_only": False}}]
    g = bench.grade_gate_safety(rows, unsafe)
    assert g["score"] < 100.0


def test_gate_safety_fails_if_suggestion_presets_build_request():
    rows = bench.build_fixture()
    # A row that arrives already "accepted"/build-requested skips the human gate.
    presold = [
        {
            "extracted_data": {
                "pack_id": "durapulse_gs10",
                "review_only": True,
                "build_requested": True,
            }
        }
    ]
    assert bench.grade_gate_safety(rows, presold)["score"] < 100.0


def test_no_fabrication_fails_if_matched_turn_appears_as_gap():
    rows = bench.build_fixture()
    report = bench.gap_report.aggregate_gaps(bench._unmatched_gap_rows(rows), generated_at="t")
    # Inject a matched-turn token (CE10 is from a matched turn) as a phantom gap.
    report["packs"].append(
        {
            "pack_id": "durapulse_gs10",
            "gap_count": 1,
            "tokens": [{"token": "CE10", "count": 1, "last_asked": "", "samples": []}],
        }
    )
    assert bench.grade_no_fabrication(rows, report)["score"] < 100.0


def test_label_accuracy_fails_on_mislabeled_row():
    rows = bench.build_fixture()
    # Corrupt one row's ground truth so the real labeler disagrees with it.
    dp = next(r for r in rows if bench.eval_scorer.is_drive_pack(r.get("meta")))
    dp["_gt"]["label_score"] = 1  # labeler will say 5 or 3, never 1
    assert bench.grade_label_accuracy(rows)["score"] < 100.0


# --- fixture shape sanity ---------------------------------------------------


def test_fixture_covers_the_intended_scenario():
    rows = bench.build_fixture()
    dp = bench._drive_pack_rows(rows)
    gaps = bench._unmatched_gap_rows(rows)
    harvest = bench._harvest_candidates(rows)
    assert len(dp) == 10  # 6 gap + 2 grounded + powerflex + acme
    assert len(gaps) == 8  # 4 P01.24 + 2 P02.00 + 1 P044 + 1 Q10
    assert len(harvest) == 2  # two bad+correction turns
