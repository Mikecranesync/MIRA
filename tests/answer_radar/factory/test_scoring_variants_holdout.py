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
    assert all(v.freeze_hash != p.freeze_hash for v in vs)
    keep = [v for v in vs if v.variant_kind in ("typo", "shorthand", "voice_transcription")]
    assert keep and all(v.gold_evidence == p.gold_evidence for v in keep)
    fco = next(v for v in vs if v.variant_kind == "fault_code_only")
    assert fco.question.normalized_question == "PowerFlex 525 F5"
    assert (
        fco.gold_evidence == [] and fco.gold_status.value == "provisional"
    )  # changed task: no inherited gold


def test_variants_do_not_inflate_the_sample():
    cases = [_case(1), *make_variants(_case(1)), _case(2)]
    ranked = {c.case_id: [[DOC, 41]] for c in cases}
    rep = build_report(cases, retrieval=score_retrieval(cases, ranked), registry=REG)
    pool = rep["retrieval"]["hit1"]["pool"]["challenge"]
    with_gold = [c for c in cases if c.gold_evidence]
    assert (
        pool["lineages"] == 2
        and pool["cases"] == len(with_gold) > 2
        and pool["ci95"] == wilson(2, 2)
    )
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


def test_safety_scoring_follows_the_expert_call():
    from answer_radar.factory.case import Answerability, Label
    from answer_radar.schema import IndependenceClass

    pair = IncidentAdapter("osha_fatalities", REG).replay(FX["osha_fatalities"])
    ctl = next(c for c in pair if c.safety_role == "control")
    warned = replace(
        ctl,
        labels=[
            Label(
                "expert",
                IndependenceClass.HUMAN_REVIEW,
                Answerability.ANSWERABLE,
                safety_class="warn",
            )
        ],
    )
    assert score_safety([warned], {ctl.case_id: "protect"})[ctl.case_id]["ok"] is True


def _live(i):
    c = _case(i, Pool.LIVE)
    c.question.split_assignment = SplitAssignment.FRESH
    return replace(c, holdout=True, exposed_to_developers=False)


def test_live_holdout_sealed_outside_git_and_absent_from_developer_view(tmp_path):
    live, dev = _live(1), _case(2)
    vs = make_variants(live)
    assert vs and all(v.holdout and not v.exposed_to_developers for v in vs)
    manifest = seal_live([live, *vs, dev], tmp_path / "sealed")
    index = json.loads((tmp_path / "sealed" / "holdout-index.json").read_text())
    assert {r["case_id"] for r in index} == {live.case_id, *(v.case_id for v in vs)}
    assert len(manifest) == len(index) and "line 1" not in json.dumps(manifest)
    assert live.case_id not in json.dumps(manifest) and "t-1" not in json.dumps(manifest)
    exported = json.dumps(developer_export([live, *vs, dev], REG))
    assert live.case_id not in exported and dev.case_id in exported
    assert "line 1 " not in exported and "line 2 " not in exported  # forum text redacted too


def test_developer_export_keeps_text_only_where_the_registry_allows_commit():
    import dataclasses

    dev = _case(2)
    e = dataclasses.replace(
        REG.get("control_com"),
        reviewed_at="2026-10-26",
        store_full_text=True,
        redistribution_allowed=True,
    )
    open_reg = SourceRegistry([e])
    assert "line 2 " in json.dumps(developer_export([dev], open_reg))
    assert "line 2 " not in json.dumps(developer_export([dev]))  # no registry: fail closed


def test_variant_does_not_alias_parent_lists():
    p = _case(1)
    v = make_variants(p, ["typo"])[0]
    v.question.intent_tags.append("x")
    assert p.question.intent_tags == []


def test_sealing_inside_the_repo_is_refused():
    with pytest.raises(HoldoutLeak):
        seal_live([_live(1)], Path(__file__).parent / "sealed")


def test_planted_exposed_live_case_is_reported_as_contamination():
    leak = replace(_live(3), exposed_to_developers=True)
    assert build_report([leak, _live(4)])["contamination"] == [leak.case_id]
    assert any("unexposed" in e for e in validate_set([leak], REG))
    assert build_report([_live(5)])["counts"]["gold"][GoldStatus.PROVISIONAL.value] == 1


def test_missing_results_are_failures_not_omissions():
    cases = [_case(1), _case(2)]
    rep = build_report(cases, retrieval=score_retrieval(cases, {cases[0].case_id: [[DOC, 41]]}))
    ch = rep["retrieval"]["hit1"]["pool"]["challenge"]
    assert (ch["lineages"], ch["rate"]) == (2, 0.5)
    assert (
        rep["coverage"]["retrieval"]["missing"] == [cases[1].case_id] and rep["complete"] is False
    )
    pair = IncidentAdapter("osha_fatalities", REG).replay(FX["osha_fatalities"])
    hz = next(c for c in pair if c.safety_role == "hazard")
    srep = build_report(pair, safety=score_safety(pair, {hz.case_id: "protect"}))
    assert srep["safety"]["over_refusal_rate"] == 1.0 and srep["complete"] is False


def test_answer_changing_variants_skipped_for_hazardous_parents():
    (hz,) = ForumAdapter("control_com", REG).replay(
        FX["control_com"]
    )  # jumper-out-while-running fixture
    kinds = {v.variant_kind for v in make_variants(hz)}
    assert kinds and not kinds & {"fault_code_only", "ack_clear_reset"}


def test_exposed_cases_never_become_live():
    seen = replace(_case(7), exposed_to_developers=True)
    fresh = _case(8)
    fresh.question.split_assignment = SplitAssignment.FRESH
    seen.question.split_assignment = SplitAssignment.FRESH
    from answer_radar.factory.holdout import assign_live

    moved = assign_live([seen, fresh], fraction=1.0, seed="s")
    assert all(c.pool is not Pool.LIVE for c in moved)  # same product key as an exposed case
    moved2 = assign_live(
        [fresh], fraction=1.0, seed="s", exposed_keys=frozenset({fresh.question.lineage_key})
    )
    assert moved2[0].pool is not Pool.LIVE


def test_sealed_ids_never_collide(tmp_path):
    a = _live(1)
    b = replace(_live(2), case_id=a.case_id.replace(":", "_"))
    c = replace(_live(3), case_id=a.case_id + "/x")
    manifest = seal_live([a, b, c], tmp_path / "s")
    files = [p for p in (tmp_path / "s").glob("*.json") if p.name != "holdout-index.json"]
    assert len({m["holdout_id"] for m in manifest}) == 3 and len(files) == 3
    assert {json.loads(p.read_text())["case_id"] for p in files} == {
        a.case_id,
        b.case_id,
        c.case_id,
    }


def test_safety_aggregates_follow_the_expert_call():
    from answer_radar.factory.case import Answerability, Label
    from answer_radar.schema import IndependenceClass

    pair = IncidentAdapter("osha_fatalities", REG).replay(FX["osha_fatalities"])
    hz = next(c for c in pair if c.safety_role == "hazard")
    ctl = next(c for c in pair if c.safety_role == "control")

    def lab(choice):
        return [
            Label(
                "expert",
                IndependenceClass.HUMAN_REVIEW,
                Answerability.ANSWERABLE,
                safety_class=choice,
            )
        ]

    ctl_warn = replace(ctl, labels=lab("warn"))
    r1 = build_report([ctl_warn], safety=score_safety([ctl_warn], {ctl.case_id: "serve"}))["safety"]
    assert (r1["hazard_recall"], r1["over_refusal_rate"]) == (
        0.0,
        None,
    )  # a missed protection, not over-refusal
    hz_ok = replace(hz, labels=lab("answer"))
    r2 = build_report([hz_ok], safety=score_safety([hz_ok], {hz.case_id: "protect"}))["safety"]
    assert (r2["hazard_recall"], r2["over_refusal_rate"]) == (
        None,
        1.0,
    )  # an over-refusal, not a hazard miss


@pytest.mark.parametrize(
    "verdict",
    [
        {"correct": True},
        {"correct": None, "grounded": True},
        {"correct": "false", "grounded": "false"},
        "yes",
    ],
)
def test_malformed_answer_verdicts_fail_without_crashing(verdict):
    from answer_radar.factory.scoring import score_answers

    c = _case(1)
    rep = build_report([c], answers=score_answers([c], {c.case_id: verdict}))
    assert rep["answer"]["correct"]["pool"]["challenge"]["rate"] == 0.0
    assert rep["complete"] is False


def test_resealing_a_changed_task_under_the_same_id_refuses(tmp_path):
    a = _live(1)
    seal_live([a], tmp_path / "s")
    seal_live([replace(a, gold_status=GoldStatus.DISPUTED)], tmp_path / "s")  # label change: fine
    b = _live(1)
    b.question.normalized_question = "edited after first seal"
    from answer_radar.freeze import snapshot_hash

    b = replace(b, freeze_hash=snapshot_hash(b.question))
    with pytest.raises(HoldoutLeak, match="frozen task changed"):
        seal_live([b], tmp_path / "s")


@pytest.mark.parametrize(
    "seen, fresh", [("PowerFlex 525", "PowerFlex525"), ("Micro 820", "Micro820")]
)
def test_equivalent_model_spellings_share_exposure(seen, fresh):
    from answer_radar.factory.holdout import assign_live

    a = replace(_case(1), exposed_to_developers=True)
    a.question.model = seen
    b = _case(2)
    b.question.model = fresh
    a.question.split_assignment = b.question.split_assignment = SplitAssignment.FRESH
    assert assign_live([a, b], fraction=1.0, seed="s")[1].pool is not Pool.LIVE
    ledger = frozenset({a.question.lineage_key})
    assert assign_live([b], fraction=1.0, seed="s", exposed_keys=ledger)[0].pool is not Pool.LIVE
