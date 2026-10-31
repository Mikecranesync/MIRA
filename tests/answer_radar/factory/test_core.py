"""IMIB-Core promotion (spec §3): expert-reviewed anchors, append-only, never silently relabeled."""

from __future__ import annotations

import json
import shutil
from dataclasses import replace
from pathlib import Path

import pytest

from answer_radar.factory.case import (
    Answerability,
    Evidence,
    GoldStatus,
    Label,
    Pool,
    validate_set,
)
from answer_radar.factory.core import CoreRelabeled, promote_core
from answer_radar.factory.discovery import ForumAdapter
from answer_radar.factory.registry import SourceRegistry
from answer_radar.factory.variants import make_variants
from answer_radar.schema import IndependenceClass

REG = SourceRegistry.load()
DOC = "aa" * 32
EXPERT = Label("expert", IndependenceClass.HUMAN_REVIEW, Answerability.ANSWERABLE, (41,))


def _case(i: int, *, gold=GoldStatus.EXPERT_REVIEWED, page=41, **kw):
    rec = {
        "id": f"t-{i}",
        "captured_at": "2026-10-26T12:00:00Z",
        "url": f"https://control.com/forums/threads/t-{i}/",
        "opening_post": f"PowerFlex 525 F5 overvoltage on line {i} when the conveyor decelerates. What should I check?",
    }
    (c,) = ForumAdapter("control_com", REG).replay([rec])
    if gold is GoldStatus.PROVISIONAL:
        return replace(c, **kw)
    ev = [Evidence("oem_manuals", DOC, page, "F5 overvoltage")]
    lb = replace(EXPERT, pages=(page,), unsure=gold is GoldStatus.DISPUTED)
    return replace(
        c,
        answerability=Answerability.ANSWERABLE
        if gold is GoldStatus.EXPERT_REVIEWED
        else c.answerability,
        gold_status=gold,
        gold_evidence=ev if gold is GoldStatus.EXPERT_REVIEWED else [],
        labels=[lb],
        **kw,
    )


def _core(cases, prior=None, **kw):
    kw.setdefault("min_size", 2)
    return promote_core(cases, prior, **kw)


def test_only_human_expert_gold_is_promoted():
    cases = [
        _case(1),
        _case(2, gold=GoldStatus.PROVISIONAL),  # AI-settled / unreviewed
        _case(3, gold=GoldStatus.DISPUTED),
    ]
    out, m = _core(cases)
    assert [c.case_id for c in out if c.pool is Pool.CORE] == [cases[0].case_id]
    assert [r["case_id"] for r in m["members"]] == [cases[0].case_id]
    assert validate_set(out, REG) == []


def test_holdout_variants_safety_and_non_captured_are_not_promoted():
    base = _case(1)
    variants = [replace(v, gold_status=GoldStatus.PROVISIONAL) for v in make_variants(base)]
    held = _case(2, holdout=True, exposed_to_developers=False)
    safety = _case(3, pool=Pool.SAFETY, safety_pair_id="p", safety_role="hazard")
    authored = _case(4)
    authored = replace(authored, provenance=replace(authored.provenance, origin="authored"))
    _, m = _core([base, *variants, held, safety, authored])
    assert [r["case_id"] for r in m["members"]] == [base.case_id]
    # the owner can widen the origin rule explicitly
    _, m2 = _core([base, authored], origins=frozenset({"captured", "authored"}))
    assert len(m2["members"]) == 2


def test_one_anchor_per_lineage_and_deterministic_order():
    a, b = _case(1), _case(2)
    twin = replace(_case(3), lineage_id=a.lineage_id)
    _, m1 = _core([a, b, twin])
    _, m2 = _core([twin, b, a])
    assert m1 == m2
    assert len({r["lineage_id"] for r in m1["members"]}) == len(m1["members"]) == 2


def test_size_cap_and_readiness():
    cases = [_case(i) for i in range(6)]
    _, small = _core(cases[:1], min_size=2, max_size=4)
    assert small["ready"] is False and len(small["members"]) == 1
    _, m = _core(cases, min_size=2, max_size=4)
    assert m["ready"] is True and len(m["members"]) == 4
    # a later cycle with more eligible cases cannot grow past the cap
    _, m3 = _core([*cases, _case(9)], prior=m, min_size=2, max_size=4)
    assert m3 == m


def test_append_only_and_idempotent():
    a, b = _case(1), _case(2)
    _, m1 = _core([a])
    _, again = _core([a], prior=m1)
    assert again == m1 and m1["version"] == 1
    _, m2 = _core([a, b], prior=m1)
    assert m2["version"] == 2
    assert [r["case_id"] for r in m2["members"]][0] == a.case_id  # earlier members keep their place
    assert m2["history"][-1]["added"] == [b.case_id]


def test_changed_expert_gold_on_a_member_fails_closed_unless_relabel_is_explicit():
    a = _case(1)
    _, m = _core([a])
    moved = _case(1, page=42)
    with pytest.raises(CoreRelabeled):
        _core([moved], prior=m)
    disputed = _case(1, gold=GoldStatus.DISPUTED)
    with pytest.raises(CoreRelabeled):
        _core([disputed], prior=m)
    _, m2 = _core([moved], prior=m, relabel=True)
    assert m2["version"] == 2 and m2["history"][-1]["relabeled"] == [a.case_id]
    assert m2["members"][0]["gold_sha256"] != m["members"][0]["gold_sha256"]
    _, m3 = _core([disputed], prior=m, relabel=True)
    assert m3["members"] == [] and m3["history"][-1]["removed"] == [a.case_id]


def test_removed_member_is_demoted_from_the_core_pool():
    a = _case(1)
    _, m = _core([a])
    disputed = _case(1, gold=GoldStatus.DISPUTED, pool=Pool.CORE)  # pre-pooled, as cycle does
    out, m2 = _core([disputed], prior=m, relabel=True)
    assert m2["members"] == [] and m2["history"][-1]["removed"] == [a.case_id]
    assert out[0].pool is Pool.CHALLENGE


def test_member_without_fresh_expert_gold_stays_core_but_unverified():
    a = _case(1)
    _, m = _core([a])
    out, m2 = _core([_case(1, gold=GoldStatus.PROVISIONAL)], prior=m)  # no export this cycle
    assert out[0].pool is Pool.CORE and m2["members"] == m["members"]
    assert m2["unverified_this_cycle"] == [a.case_id]


def test_recorded_gold_is_restored_and_scored_without_a_fresh_export():
    from answer_radar.factory.scoring import score_retrieval

    a = _case(1)
    _, m = _core([a])
    out, _ = _core([_case(1, gold=GoldStatus.PROVISIONAL)], prior=m)
    assert out[0].gold_status is GoldStatus.EXPERT_REVIEWED
    assert [(e.doc_sha256, e.page) for e in out[0].gold_evidence] == [(DOC, 41)]
    assert validate_set(out, REG) == []
    scored = score_retrieval(out, {a.case_id: [[DOC, 41]]})
    assert scored[a.case_id]["hit1"] is True
    assert "F5 overvoltage" not in json.dumps(m)  # the quote (source text) is never stored


def test_changed_frozen_question_on_a_member_fails_closed():
    _, m = _core([_case(1)])
    m["members"][0]["freeze_hash"] = "0" * 64
    with pytest.raises(CoreRelabeled, match="frozen question"):
        _core([_case(1)], prior=m)


def test_missing_member_fails_closed():
    _, m = _core([_case(1)])
    with pytest.raises(CoreRelabeled, match="missing"):
        _core([_case(2)], prior=m)


# --- wired into the cycle --------------------------------------------------------------

FXD = Path(__file__).parent / "fixtures"


def _pin(d):
    import hashlib

    out = {"review_data_sha256": hashlib.sha256((d / "review-data.json").read_bytes()).hexdigest()}
    if (d / "review-data-live.json").is_file():
        out["review_data_live_sha256"] = hashlib.sha256(
            (d / "review-data-live.json").read_bytes()
        ).hexdigest()
    return out


def test_cycle_promotes_expert_answered_case_and_keeps_it_out_of_live(tmp_path):
    from answer_radar.factory.__main__ import main

    out, private, export = tmp_path / "out", tmp_path / "private", tmp_path / "export"
    args = [
        "cycle",
        "--discovery",
        str(FXD / "discovery.json"),
        "--pages",
        str(FXD / "pages.json"),
        "--out",
        str(out),
        "--private",
        str(private),
        "--seed",
        "2026-W44",
        "--live-fraction",
        "0.0",
    ]
    assert main(args) == 0
    rep = json.loads((out / "cycle-report.json").read_text())
    assert rep["core"]["size"] == 0 and rep["core"]["ready"] is False  # the "before" state
    review = json.loads((out / "review-data.json").read_text())
    target = next(r for r in review["forum"] if r["pages"])
    key = f"forum-{target['id']}"
    (export / "answers").mkdir(parents=True)
    shutil.copy(out / "review-data.json", export / "review-data.json")
    (export / "export-manifest.json").write_text(json.dumps(_pin(export)))
    (export / "answers" / f"{key}.json").write_text(
        json.dumps(
            {
                "key": key,
                "savedAt": "2026-10-27T00:00:00Z",
                "overall": "answered",
                "pages": {str(p): "yes" for p in target["pages"]},
            }
        )
    )
    assert main([*args, "--expert-export", str(export)]) == 0
    rep = json.loads((out / "cycle-report.json").read_text())
    core = json.loads((private / "core-manifest.json").read_text())
    assert [r["case_id"] for r in core["members"]] == [target["id"]]
    assert core["members"][0]["review_data_sha256"] == _pin(export)["review_data_sha256"]
    assert rep["core"]["size"] == 1 and rep["core"]["added"] == [target["id"]]
    assert json.loads((out / "core-manifest.json").read_text()) == core
    # next cycle, no export, Live fraction 1.0: the member stays Core and is never held out
    assert main([*args[:-1], "1.0"]) == 0
    rep = json.loads((out / "cycle-report.json").read_text())
    assert rep["core"]["size"] == 1 and rep["core"]["unverified_this_cycle"] == [target["id"]]
    cases = json.loads((out / "cases.json").read_text())
    member = [c for c in cases if c["case_id"] == target["id"]]
    assert member and member[0]["pool"] == "core"
    # the member keeps its expert gold even though no export was given this cycle
    assert member[0]["gold_status"] == "expert_reviewed"
    assert {e["page"] for e in member[0]["gold_evidence"]} == set(target["pages"])
    # F2: an existing Core anchor is routed to experts as release-gating on every cycle
    assert "release-gating core case" in rep["expert_queue"][target["id"]]
    # F1: answer-preserving variants probe the restored gold pages, so they stay scorable
    keep = [
        c
        for c in cases
        if c["parent_case_id"] == target["id"]
        and c["variant_kind"] in ("typo", "shorthand", "voice_transcription")
    ]
    assert keep and all(
        {e["page"] for e in v["gold_evidence"]} == set(target["pages"]) for v in keep
    )
