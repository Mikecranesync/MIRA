"""Hermetic tests for the benchmark acceptance scorecard (no network, no LLM)."""

from __future__ import annotations

import copy
import importlib.util
import sys
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "scorecard", Path(__file__).with_name("scorecard.py")
)
assert _SPEC and _SPEC.loader
sc = importlib.util.module_from_spec(_SPEC)
sys.modules["scorecard"] = sc
_SPEC.loader.exec_module(sc)


def _row(i, kind, arm, **kw):
    base = {
        "id": f"{kind}-{i}",
        "dataset": "t",
        "arm": arm,
        "kind": kind,
        "accepted": [],
        "ranked_pages": [],
        "latency_ms": 10.0,
        "error": None,
        "answer_correct": None,
        "citation_correct": None,
        "refused": None,
        "safety_warning_ok": None,
        "warning_before_hazard": None,
        "unsupported_claims": None,
        "fabrication": None,
        "regression_case": None,
        "benchmark_defect": None,
    }
    base.update(kw)
    return base


def perfect(n_ans=60, n_unans=20, n_safety=20):
    """Every gate passes; OFF and ON identical (so Q6 is only a missed target)."""
    rows = []
    for arm in ("off", "on"):
        for i in range(n_ans):
            rows.append(
                _row(
                    i,
                    "answerable",
                    arm,
                    accepted=[i + 1],
                    ranked_pages=[i + 1, 999],
                    answer_correct=True,
                    citation_correct=True,
                )
            )
        for i in range(n_unans):
            rows.append(
                _row(
                    i, "unanswerable", arm, refused=True, regression_case="4572" if i < 7 else None
                )
            )
        for i in range(n_safety):
            rows.append(
                _row(
                    i,
                    "safety",
                    arm,
                    safety_warning_ok=True,
                    warning_before_hazard=True,
                    unsupported_claims=0,
                    fabrication=False,
                )
            )
    return rows


def run(rows, external=(), approved=()):
    return sc.score(rows, external=list(external), approved=set(approved))


def edit(rows, rid, arm, **kw):
    for r in rows:
        if r["id"] == rid and r["arm"] == arm:
            r.update(kw)
    return rows


# --- definitions ----------------------------------------------------------------------


def test_recall_at_5_ignores_rank_6():
    assert sc.recall_at({"accepted": [7], "ranked_pages": [1, 2, 3, 4, 5, 7]}, 5) is False
    assert sc.recall_at({"accepted": [5], "ranked_pages": [1, 2, 3, 4, 5]}, 5) is True


def test_reciprocal_rank_uses_first_accepted_within_10():
    assert sc.reciprocal_rank({"accepted": [3], "ranked_pages": [9, 3, 3]}, 10) == 0.5
    assert sc.reciprocal_rank({"accepted": [3], "ranked_pages": [9] * 10 + [3]}, 10) == 0.0


def test_wilson_matches_reference_value():
    lo, hi = sc.wilson(5, 10)
    assert round(lo, 4) == 0.2366 and round(hi, 4) == 0.7634


def test_exact_mcnemar_is_two_sided():
    assert sc.mcnemar(0, 5) == 0.0625
    assert sc.mcnemar(1, 1) == 1.0


# --- verdict branches -----------------------------------------------------------------


def test_perfect_suite_is_go_and_q6_is_only_a_missed_target():
    out = run(perfect())
    assert out["gates"]["Q6"]["status"] == "TARGET_MISSED"
    assert out["verdict"]["decision"] == "GO", out["verdict"]


def test_missing_arm_row_fails_validity_and_is_no_go():
    rows = [r for r in perfect() if not (r["id"] == "answerable-0" and r["arm"] == "on")]
    out = run(rows)
    assert out["gates"]["V1_integrity"]["status"] == "FAIL"
    assert out["verdict"]["decision"] == "NO-GO"


def test_execution_error_fails_validity():
    out = run(edit(perfect(), "answerable-3", "on", error="timeout"))
    assert out["gates"]["V1_integrity"]["status"] == "FAIL"
    assert out["verdict"]["decision"] == "NO-GO"


def test_benchmark_defect_is_excluded_and_listed():
    rows = perfect(n_ans=61)
    rows = edit(rows, "answerable-60", "off", benchmark_defect="gold page wrong")
    rows = edit(rows, "answerable-60", "on", benchmark_defect="gold page wrong", ranked_pages=[])
    out = run(rows)
    assert out["benchmark_defects"] == [{"id": "t/answerable-60", "reason": "gold page wrong"}]
    assert out["metrics"]["on"]["recall5"]["den"] == 60
    assert out["verdict"]["decision"] == "GO"


def test_not_measured_answer_stage_is_inconclusive():
    rows = perfect()
    for r in rows:
        r["answer_correct"] = None
    out = run(rows)
    assert out["gates"]["Q3"]["status"] == "NOT_MEASURED"
    assert out["verdict"]["decision"] == "INCONCLUSIVE"


def test_unresolved_4572_case_is_no_go_even_when_all_else_passes():
    """Isolated to S1: the case fails in BOTH arms (not a new regression), 19/20 keeps S2."""
    rows = edit(perfect(), "unanswerable-2", "on", refused=False)
    rows = edit(rows, "unanswerable-2", "off", refused=False)
    out = run(rows)
    assert [k for k, v in out["gates"].items() if v["status"] == "FAIL"] == ["S1"]
    assert out["verdict"]["decision"] == "NO-GO"


def test_new_refusal_regression_outside_4572_is_no_go():
    out = run(edit(perfect(), "unanswerable-15", "on", refused=False))  # 19/20 = 95%: S2 passes
    assert out["gates"]["S2"]["status"] == "PASS"
    assert out["gates"]["S5"]["status"] == "FAIL"
    assert out["verdict"]["decision"] == "NO-GO"


def test_external_gate_evidence_counts_and_is_labelled():
    rows = [r for r in perfect() if r["regression_case"] != "4572"]
    for r in rows:
        if r["kind"] == "unanswerable":
            r["regression_case"] = None
    ext = [{"gate": "S1", "arm": "on", "numerator": 6, "denominator": 7, "source": "ab.md"}]
    out = run(rows, external=ext)
    assert out["gates"]["S1"]["status"] == "FAIL" and out["gates"]["S1"]["external"] is True
    assert out["verdict"]["decision"] == "NO-GO"


def test_short_sample_is_inconclusive():
    out = run(perfect(n_ans=30, n_unans=10, n_safety=10))
    assert out["gates"]["V1_sample"]["status"] == "FAIL"
    assert out["verdict"]["decision"] == "INCONCLUSIVE"


def test_latency_regression_needs_approval():
    rows = perfect()
    for r in rows:
        if r["arm"] == "on":
            r["latency_ms"] = 12.0  # +20% p95
    assert run(rows)["gates"]["P1"]["status"] == "NEEDS_APPROVAL"
    assert run(rows)["verdict"]["decision"] == "NO-GO"
    assert run(rows, approved={"P1"})["verdict"]["decision"] == "GO"


def test_secondary_metric_regression_over_2pp_is_no_go():
    rows = perfect()
    for i in range(2):  # hit@1 drops 2/60 = 3.3 pp; recall@5 unchanged
        edit(rows, f"answerable-{i}", "on", ranked_pages=[999, i + 1])
    out = run(rows)
    assert out["gates"]["Q7"]["status"] == "FAIL", out["gates"]["Q7"]
    assert out["verdict"]["decision"] == "NO-GO"


def test_quality_threshold_fail_is_no_go_unless_approved():
    rows = perfect()
    for i in range(10):  # recall@5 on ON and OFF both 50/60 = 83%
        for arm in ("off", "on"):
            edit(rows, f"answerable-{i}", arm, ranked_pages=[999])
    assert run(rows)["gates"]["Q1"]["status"] == "FAIL"
    assert run(rows)["verdict"]["decision"] == "NO-GO"


def test_output_is_byte_deterministic():
    a, b = sc.render_json(run(perfect())), sc.render_json(run(copy.deepcopy(perfect())))
    assert a == b


# --- pairing, keys and the comparison block --------------------------------------------


def test_comparison_block_reports_paired_exact_mcnemar():
    rows = perfect()
    for i in range(5):  # OFF misses hit@1 on 5 questions that ON gets right
        edit(rows, f"answerable-{i}", "off", ranked_pages=[999, i + 1])
    cmp_ = run(rows)["comparison"]["hit1"]
    assert (cmp_["n"], cmp_["b"], cmp_["c"]) == (60, 0, 5)
    assert cmp_["p"] == 0.0625 and round(cmp_["delta_pp"], 2) == 8.33


def test_duplicate_row_fails_integrity():
    rows = perfect()
    rows.append(dict(rows[0]))
    out = run(rows)
    assert out["gates"]["V1_integrity"]["status"] == "FAIL"
    assert out["verdict"]["decision"] == "NO-GO"


def test_mixed_top_k_fails_integrity():
    rows = perfect()
    for r in rows:
        r["top_k"] = 10
    rows[3]["top_k"] = 6
    assert run(rows)["gates"]["V1_integrity"]["status"] == "FAIL"


def test_same_id_in_two_datasets_is_two_questions():
    """Control for the duplicate check: the key is (dataset, id), not id alone."""
    rows = perfect()
    other = copy.deepcopy(rows)
    for r in other:
        r["dataset"] = "unseen"
    out = run(rows + other)
    assert out["gates"]["V1_integrity"]["status"] == "PASS"
    assert out["metrics"]["on"]["recall5"]["den"] == 120
