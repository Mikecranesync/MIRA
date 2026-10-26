"""Tests for the v0.2 pass/fail logic (analyze_v02.judge). Synthetic numbers; each threshold is pinned at its edge.

uv run --no-project --python 3.12 --with pytest python -m pytest -q v02/test_analyze_v02.py
"""

from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import analyze_v02 as V  # noqa: E402


def paired(b, c, p=1.0):
    return {"top5": {"b_lost": b, "c_gained": c, "mcnemar_p": p}}


def fault(bm25=0.8, rnd=0.05, defect=(5, 0), change=(0, 3)):
    return {
        "arms": {"bm25": {"top5": {"rate": bm25}}, "random": {"top5": {"rate": rnd}}},
        "paired_post_vs_noexactlane": paired(*defect),
        "paired_pre_vs_post": paired(*change),
    }


def test_v1_discrimination_edges():
    assert (
        V.judge({"oem-fault": fault(bm25=0.50, rnd=0.10)}, {})[0]["V1_discrimination"]["pass"]
        is True
    )
    assert (
        V.judge({"oem-fault": fault(bm25=0.49, rnd=0.10)}, {})[0]["V1_discrimination"]["pass"]
        is False
    )
    assert (
        V.judge({"oem-fault": fault(bm25=0.90, rnd=0.11)}, {})[0]["V1_discrimination"]["pass"]
        is False
    )


def test_v2_planted_defect_needs_two_net_losses():
    assert V.judge({"oem-fault": fault(defect=(2, 0))}, {})[0]["V2_planted_defect"]["pass"] is True
    assert V.judge({"oem-fault": fault(defect=(2, 1))}, {})[0]["V2_planted_defect"]["pass"] is False


def test_v4_determinism_fails_on_any_nondeterministic_arm():
    assert (
        V.judge({"oem-fault": fault()}, {"oem-fault": {"pre": True, "post": True}})[0][
            "V4_determinism"
        ]["pass"]
        is True
    )
    assert (
        V.judge({"oem-fault": fault()}, {"oem-fault": {"pre": True, "post": False}})[0][
            "V4_determinism"
        ]["pass"]
        is False
    )


def test_verdict_no_go_on_two_net_regressions_in_either_set():
    rs = {"oem-fault": fault(change=(0, 1)), "oem-index": {"paired_pre_vs_post": paired(3, 1)}}
    assert V.judge(rs, {})[1]["pr4791_on_oem_sets"]["verdict"] == "NO-GO"


def test_verdict_go_needs_pooled_significance():
    rs = {"oem-fault": fault(change=(0, 6)), "oem-index": {"paired_pre_vs_post": paired(0, 2)}}
    assert V.judge(rs, {})[1]["pr4791_on_oem_sets"]["verdict"] == "GO"  # 0 vs 8, p = 0.0078
    rs = {"oem-fault": fault(change=(0, 3)), "oem-index": {"paired_pre_vs_post": paired(0, 1)}}
    assert (
        V.judge(rs, {})[1]["pr4791_on_oem_sets"]["verdict"] == "INCONCLUSIVE"
    )  # 0 vs 4, p = 0.125
