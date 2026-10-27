"""Phase 1 contract locks: registry fails closed, case/set validation catches each violation."""

from __future__ import annotations

import dataclasses

import pytest

from answer_radar.factory.case import (
    Answerability,
    Evidence,
    GoldStatus,
    Label,
    Pool,
    freeze_case,
    validate_case,
    validate_set,
)
from answer_radar.factory.registry import SourcePolicyError, SourceRegistry
from answer_radar.schema import (
    PUBLIC_EVAL_ONLY_RIGHTS,
    IndependenceClass,
    QuestionRecord,
    SplitAssignment,
)

REG = SourceRegistry.load()
TEXT = "PowerFlex 40 drives fault F71 randomly on DeviceNet. Anyone seen this?"


def _q(qid="c1", split=SplitAssignment.DEVELOPMENT, **kw):
    return QuestionRecord(
        question_id=qid,
        normalized_question="PowerFlex 40 F71 random faults on DeviceNet",
        source_platform="mrplc",
        rights=PUBLIC_EVAL_ONLY_RIGHTS,
        split_assignment=split,
        manufacturer="Allen-Bradley",
        model="PowerFlex 40",
        error_code="F71",
        **kw,
    )


def _case(qid="c1", pool=Pool.CORE, split=SplitAssignment.DEVELOPMENT, **kw):
    return freeze_case(
        _q(qid, split),
        source_id="mrplc",
        captured_text=TEXT,
        captured_at="2026-10-26",
        pool=pool,
        **kw,
    )


GOLD = Evidence(source_id="oem_manuals", doc_sha256="ab" * 32, page=94, quote="F71 Net Loss")
HUMAN = Label("expert-1", IndependenceClass.HUMAN_REVIEW, Answerability.ANSWERABLE, pages=(94,))


def test_only_the_owner_approved_source_may_be_collected():
    assert REG.require_collection("stackexchange")  # owner approved 2026-10-27
    assert not REG.may_commit_text(
        "stackexchange"
    )  # approval to collect is not approval to publish
    approved = [
        e.source_id for e in REG._by_id.values() if e.reviewed and e.automated_collection_allowed
    ]
    assert sorted(approved) == ["csb", "niosh_face", "stackexchange", "uci_ai4i", "uci_metropt3"]


def test_registry_ships_unreviewed_and_refuses_collection():
    assert len(REG.families()) >= 5
    for sid in (
        "control_com",
        "mrplc",
        "plctalk",
        "field",
        "oem_manuals",  # reviewed for local copies only: never collected
    ):
        with pytest.raises(SourcePolicyError):
            REG.require_collection(sid)
        assert not REG.may_commit_text(sid)
    with pytest.raises(SourcePolicyError):
        REG.get("reddit")


def test_registry_permits_collection_only_when_reviewed_and_allowed():
    e = dataclasses.replace(
        REG.get("stackexchange"), reviewed_at="2026-10-26", automated_collection_allowed=True
    )
    assert SourceRegistry([e]).require_collection("stackexchange") is e
    bad = dataclasses.replace(e, reviewed_at="soon")
    with pytest.raises(SourcePolicyError):
        SourceRegistry([bad]).require_collection("stackexchange")


def test_valid_settled_case_passes():
    c = _case(
        gold_status=GoldStatus.EXPERT_REVIEWED,
        answerability=Answerability.ANSWERABLE,
        gold_evidence=[GOLD],
        labels=[HUMAN],
    )
    assert validate_case(c, REG) == []
    assert c.freeze_hash and c.provenance.text_sha256


@pytest.mark.parametrize(
    "kw, needle",
    [
        (
            {"gold_status": GoldStatus.EXPERT_REVIEWED, "gold_evidence": [GOLD]},
            "without a decisive human label",
        ),
        ({"gold_evidence": [dataclasses.replace(GOLD, source_id="mrplc")]}, "cannot back gold"),
        (
            {
                "gold_status": GoldStatus.EXPERT_REVIEWED,
                "labels": [HUMAN],
                "answerability": Answerability.ANSWERABLE,
            },
            "no document/page evidence",
        ),
        ({"pool": Pool.SAFETY}, "safety_pair_id"),
        ({"pool": Pool.RED}, "split=regression"),
        ({"pool": Pool.LIVE}, "fresh, holdout and unexposed"),
    ],
)
def test_case_violations(kw, needle):
    errs = validate_case(_case(**kw), REG)
    assert any(needle in e for e in errs), errs


def test_unregistered_source_and_tampered_text_rejected():
    c = _case()
    c.provenance = dataclasses.replace(c.provenance, source_id="reddit")
    assert "not registered" in validate_case(c, REG)[0]
    c2 = _case()
    c2.question.raw_text = "edited after freeze"
    assert any("frozen hash" in e for e in validate_case(c2, REG))


def test_live_case_valid_when_hidden():
    c = _case(
        pool=Pool.LIVE, split=SplitAssignment.FRESH, holdout=True, exposed_to_developers=False
    )
    assert validate_case(c, REG) == []


def test_variants_keep_lineage_and_declare_kind():
    parent = _case("p")
    ok = _case("v1", lineage_id="p", parent_case_id="p", variant_kind="typo")
    stray = _case("v2", lineage_id="other", parent_case_id="p", variant_kind="typo")
    undeclared = _case("v3", lineage_id="p", parent_case_id="p", variant_kind="emoji")
    unsettled = _case(
        "v5", lineage_id="p", parent_case_id="p", variant_kind="changed_numeric_value"
    )
    needs_gold = _case(
        "v4",
        lineage_id="p",
        parent_case_id="p",
        variant_kind="changed_numeric_value",
        gold_status=GoldStatus.EXPERT_REVIEWED,
        gold_evidence=[GOLD],
    )
    errs = validate_set([parent, ok, stray, undeclared, needs_gold, unsettled], REG)
    assert not any(e.startswith("v5") for e in errs)  # an unsettled answer-changing variant is fine
    assert not any(e.startswith("v1") for e in errs)
    assert any(e.startswith("v2") and "lineage" in e for e in errs)
    assert any(e.startswith("v3") and "undeclared" in e for e in errs)
    assert any(e.startswith("v4") and "not reviewed for" in e for e in errs)


@pytest.mark.parametrize(
    "field, value",
    [("normalized_question", "edited"), ("model", "PowerFlex 755"), ("error_code", "F12")],
)
def test_task_edits_after_freeze_are_rejected(field, value):
    c = _case()
    setattr(c.question, field, value)
    assert any("snapshot hash mismatch" in e for e in validate_case(c, REG))


def test_discovery_metadata_edits_do_not_break_the_freeze():
    c = _case()
    c.question.lead_score = 99
    assert validate_case(c, REG) == []


def test_live_variant_cannot_be_exposed():
    live = _case(
        "L", pool=Pool.LIVE, split=SplitAssignment.FRESH, holdout=True, exposed_to_developers=False
    )
    leak = _case(
        "Lv", split=SplitAssignment.FRESH, lineage_id="L", parent_case_id="L", variant_kind="typo"
    )
    assert any("exposes a live holdout" in e for e in validate_set([live, leak], REG))


def test_safety_pairs_need_hazard_and_control_and_ids_unique():
    h = _case("h", pool=Pool.SAFETY, safety_pair_id="s1", safety_role="hazard")
    c = _case("c", pool=Pool.SAFETY, safety_pair_id="s1", safety_role="control")
    assert validate_set([h, c], REG) == []
    errs = validate_set(
        [h, _case("h", pool=Pool.SAFETY, safety_pair_id="s2", safety_role="hazard")], REG
    )
    assert any("duplicate case_id" in e for e in errs)
    assert any("pair s1 incomplete" in e for e in errs) and any(
        "pair s2 incomplete" in e for e in errs
    )
