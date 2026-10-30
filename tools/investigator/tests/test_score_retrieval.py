"""pytest for tools/investigator/score_retrieval.py (LANE BENCH-B). Stdlib
only. Run from the worktree root:

    python3 -m pytest -q tools/investigator/tests/test_score_retrieval.py
"""

import json
import math
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import score_retrieval as sr  # noqa: E402

BASELINE_DIR = "/Users/charlienode/MIRA/.planning/2026-10-30-investigator-harness/baseline"


def test_wilson_zero_n():
    assert sr.wilson(0, 0) == (0.0, 0.0)


def test_wilson_matches_known_forum_fresh_figure():
    # docs/evals/2026-10-29-t1-forum-ranking/score.py prints 22.7%-56.0% for 11/29.
    lo, hi = sr.wilson(11, 29)
    assert round(lo, 3) == pytest.approx(0.227, abs=0.001)
    assert round(hi, 3) == pytest.approx(0.560, abs=0.001)


def test_mcnemar_symmetric_and_bounded():
    assert sr.mcnemar(0, 0) == 1.0
    assert 0.0 <= sr.mcnemar(3, 7) <= 1.0
    assert sr.mcnemar(5, 1) == sr.mcnemar(1, 5)  # symmetric in (gained, lost)


def test_percentile_basic():
    assert sr.percentile([], 50) is None
    assert sr.percentile([10], 95) == 10
    assert sr.percentile([1, 2, 3, 4], 50) == pytest.approx(2.5)


def test_hit_rank_first_occurrence_duplicates_not_collapsed():
    # Raw B0-shaped list with repeats, same semantics as every score.py in this repo.
    assert sr.hit_rank([93, 93, 151, 95], [93]) == 1
    assert sr.hit_rank([33, 49, 93], [93]) == 3
    assert sr.hit_rank([1, 2, 3], [999]) is None


def test_hit_at_k():
    assert sr.hit_at_k(5, 5) is True
    assert sr.hit_at_k(6, 5) is False
    assert sr.hit_at_k(None, 5) is False


def test_category_of_documented_mapping():
    assert sr.category_of("forum-fresh") == "forum"
    assert sr.category_of("oem-fault") == "fault"
    assert sr.category_of("oem-index") == "parameter"
    assert sr.category_of("t4-77") == "procedure"
    assert sr.category_of("robust") == "robust"
    assert sr.category_of("something-unmapped") == "other"


def test_score_rows_synthetic_hit_and_miss():
    rows = {
        "a": {"ranked_pages": [5, 6, 7], "accepted": [5], "error": None, "latency_ms": 10},
        "b": {"ranked_pages": [1, 2, 3], "accepted": [99], "error": None, "latency_ms": 20},
    }
    out = sr.score_rows(rows, ["a", "b"])
    assert out["n"] == 2
    assert out["top_k"][1]["hits"] == 1  # only "a" hits at k=1
    assert out["top_k"][5]["hits"] == 1
    assert out["errors"] == 0


def test_score_rows_counts_error_rows_without_crashing():
    rows = {"a": {"ranked_pages": [], "accepted": [1], "error": "boom", "latency_ms": None}}
    out = sr.score_rows(rows, ["a"])
    assert out["errors"] == 1
    assert out["top_k"][5]["hits"] == 0


def test_score_rows_gained_lost_vs_baseline():
    cand = {
        "a": {"ranked_pages": [1], "accepted": [1], "error": None, "latency_ms": 1},  # hit
        "b": {"ranked_pages": [2], "accepted": [1], "error": None, "latency_ms": 1},  # miss
    }
    base = {
        "a": {
            "ranked_pages": [2],
            "accepted": [1],
            "error": None,
            "latency_ms": 1,
        },  # base missed a -> candidate GAINED a
        "b": {
            "ranked_pages": [1],
            "accepted": [1],
            "error": None,
            "latency_ms": 1,
        },  # base hit b -> candidate LOST b
    }
    out = sr.score_rows(cand, ["a", "b"], baseline=base)
    t1 = out["top_k"][1]
    assert t1["gained"] == 1
    assert t1["lost"] == 1
    assert t1["net"] == 0
    assert "a" in t1["gained_ids"]
    assert "b" in t1["lost_ids"]


def test_load_oem_index_publication_ids(tmp_path):
    qdir = tmp_path
    (qdir / "oem-index-questions.json").write_text(
        json.dumps(
            [
                {"id": "x1", "question": "See Rockwell Automation Publication 123"},
                {"id": "x2", "question": "No publication text here"},
            ]
        )
    )
    ids = sr.load_oem_index_publication_ids(str(qdir))
    assert ids == {"x1"}


@pytest.mark.skipif(
    not os.path.isdir(BASELINE_DIR), reason="frozen baseline dir not present on this machine"
)
def test_oem_index_clean_top5_matches_known_figure_87_of_116():
    # Ground truth from .planning/2026-10-30-investigator-harness/STATE.md:
    # "Authoritative taxonomy re-run on shipped baseline ... oem-index clean 87/116".
    result = sr.score_file(
        os.path.join(BASELINE_DIR, "oem-index-off-k10.jsonl"), None, BASELINE_DIR
    )
    clean = result["by_set"]["oem-index-clean"]
    assert clean["n"] == 116
    assert clean["top_k"][5]["hits"] == 87


@pytest.mark.skipif(
    not os.path.isdir(BASELINE_DIR), reason="frozen baseline dir not present on this machine"
)
def test_forum_fresh_matches_t1_score_py_exactly():
    # docs/evals/2026-10-29-t1-forum-ranking/score.py prints "11/29 top5  wilson 22.7%-56.0%".
    result = sr.score_file(os.path.join(BASELINE_DIR, "forum-fresh-off-k10.jsonl"), None, None)
    t5 = result["by_set"]["forum-fresh"]["top_k"][5]
    assert (t5["hits"], t5["n"]) == (11, 29)
    assert math.isclose(t5["wilson_lb"], 0.227, abs_tol=0.001)
    assert math.isclose(t5["wilson_ub"], 0.560, abs_tol=0.001)
