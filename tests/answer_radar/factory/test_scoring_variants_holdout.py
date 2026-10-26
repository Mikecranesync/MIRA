"""Phases 5-6 plus variants and the hidden Live holdout, with planted defects (spec §15)."""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest

from answer_radar.factory.case import Evidence, GoldStatus, Pool, validate_set
from answer_radar.factory.discovery import ForumAdapter, IncidentAdapter
from answer_radar.factory.holdout import HoldoutLeak, developer_export, seal_live
from answer_radar.factory.registry import SourceRegistry
from answer_radar.factory.scoring import build_report, score_retrieval, score_safety, wilson
from answer_radar.factory.variants import make_variants
from answer_radar.schema import SplitAssignment

REG = SourceRegistry.load()
FX = json.loads((Path(__file__).parent / "fixtures" / "discovery.json").read_text())
DOC = "aa" * 32
GOLD = [Evidence("oem_manuals", DOC, 41, "F5 overvoltage")]


def _case(i: int, pool=Pool.CHALLENGE):
    rec = {
        "id": f"t-{i}",
        "captured_at": "2026-10-26T12:00:00Z",
        "url": f"https://control.com/forums/threads/t-{i}/",
        "opening_post": f"PowerFlex 525 F5 overvoltage on line {i} when the conveyor decelerates. What should I check?",
    }
    (c,) = ForumAdapter("control_com", REG, pool=pool).replay([rec])
    return replace(c, gold_evidence=list(GOLD))


def test_variants_share_lineage_split_and_inherit_gold():
    p = _case(1)
    vs = make_variants(p)
    assert {v.variant_kind for v in vs} >= {
        "typo",
        "shorthand",
        "voice_transcription",
        "fault_code_only",
    }
    assert validate_set([p, *vs], REG) == []
    assert all(
        v.lineage_id == p.lineage_id and v.question.lineage_key == p.question.lineage_key
        for v in vs
    )
    assert all(v.gold_evidence == p.gold_evidence and v.freeze_hash != p.freeze_hash for v in vs)
    assert (
        next(v for v in vs if v.variant_kind == "fault_code_only").question.normalized_question
        == "PowerFlex 525 F5"
    )


def test_variants_do_not_inflate_the_sample():
    cases = [_case(1), *make_variants(_case(1)), _case(2)]
    ranked = {c.case_id: [[DOC, 41]] for c in cases}
    rep = build_report(cases, retrieval=score_retrieval(cases, ranked), registry=REG)
    pool = rep["retrieval"]["hit1"]["pool"]["challenge"]
    assert pool["lineages"] == 2 and pool["cases"] == len(cases) and pool["ci95"] == wilson(2, 2)
    assert rep["counts"]["variants"] == len(cases) - 2


def test_planted_retrieval_defect_is_detected():
    cases = [_case(i) for i in range(10)]
    good = {c.case_id: [[DOC, 41], [DOC, 12]] for c in cases}
    planted = {
        **good,
        **{c.case_id: [[DOC, 12], [DOC, 41]] for c in cases[:4]},
    }  # gold pushed to rank 2
    g = build_report(cases, retrieval=score_retrieval(cases, good))
    b = build_report(cases, retrieval=score_retrieval(cases, planted))
    assert g["retrieval"]["hit1"]["pool"]["challenge"]["rate"] == 1.0
    assert b["retrieval"]["hit1"]["pool"]["challenge"]["rate"] == 0.6
    assert (
        b["retrieval"]["hit5"]["pool"]["challenge"]["rate"] == 1.0 and b["retrieval"]["mrr"] == 0.8
    )


def test_planted_safety_defects_move_recall_and_over_refusal():
    pair = IncidentAdapter("osha_fatalities", REG).replay(FX["osha_fatalities"])
    hz, ctl = (next(c for c in pair if c.safety_role == r) for r in ("hazard", "control"))
    ok = build_report(
        pair, safety=score_safety(pair, {hz.case_id: "protect", ctl.case_id: "serve"})
    )["safety"]
    bad = build_report(
        pair, safety=score_safety(pair, {hz.case_id: "serve", ctl.case_id: "protect"})
    )["safety"]
    assert (ok["hazard_recall"], ok["over_refusal_rate"]) == (1.0, 0.0)
    assert (bad["hazard_recall"], bad["over_refusal_rate"]) == (0.0, 1.0)


def _live(i):
    c = _case(i, Pool.LIVE)
    c.question.split_assignment = SplitAssignment.FRESH
    return replace(c, holdout=True, exposed_to_developers=False)


def test_live_holdout_sealed_outside_git_and_absent_from_developer_view(tmp_path):
    live, dev = _live(1), _case(2)
    vs = make_variants(live)
    assert vs and all(v.holdout and not v.exposed_to_developers for v in vs)
    manifest = seal_live([live, *vs, dev], tmp_path / "sealed")
    assert {m["case_id"] for m in manifest} == {live.case_id, *(v.case_id for v in vs)}
    assert "line 1" not in json.dumps(manifest)
    exported = json.dumps(developer_export([live, *vs, dev]))
    assert "line 1 " not in exported and "line 2 " in exported


def test_sealing_inside_the_repo_is_refused():
    with pytest.raises(HoldoutLeak):
        seal_live([_live(1)], Path(__file__).parent / "sealed")


def test_planted_exposed_live_case_is_reported_as_contamination():
    leak = replace(_live(3), exposed_to_developers=True)
    assert build_report([leak, _live(4)])["contamination"] == [leak.case_id]
    assert any("unexposed" in e for e in validate_set([leak], REG))
    assert build_report([_live(5)])["counts"]["gold"][GoldStatus.PROVISIONAL.value] == 1
