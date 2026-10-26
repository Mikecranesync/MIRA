"""Phase 3-4: independent evidence resolution, provisional labels, expert queue and import."""

from __future__ import annotations

import ast
import json

import pytest
from pathlib import Path

import answer_radar.factory as factory_pkg
from answer_radar.factory.case import Answerability, GoldStatus, Label, Pool, validate_set
from answer_radar.factory.discovery import ForumAdapter, IncidentAdapter
from answer_radar.factory.evidence import ManualPage, resolve
from answer_radar.factory.labeling import export_review_data, import_expert, route
from answer_radar.factory.registry import SourceRegistry
from answer_radar.schema import IndependenceClass

REG = SourceRegistry.load()
FX = json.loads((Path(__file__).parent / "fixtures" / "discovery.json").read_text())
PAGES = [
    ManualPage(
        "oem_manuals",
        "aa" * 32,
        41,
        "F5 overvoltage: DC bus voltage exceeded. Check brake resistor and decel time.",
        "Allen-Bradley",
        "PowerFlex 525",
    ),
    ManualPage(
        "oem_manuals",
        "aa" * 32,
        12,
        "Mounting dimensions and enclosure ratings.",
        "Allen-Bradley",
        "PowerFlex 525",
    ),
    ManualPage(
        "oem_manuals",
        "bb" * 32,
        41,
        "F5 overvoltage on a different family entirely.",
        "Allen-Bradley",
        "PowerFlex 40",
    ),
]
FORBIDDEN = (
    "recall_knowledge",
    "neon_recall",
    "rag_worker",
    "mira_bots",
    "shared.workers",
    "engine",
)


BENIGN = {
    "id": "t-80",
    "captured_at": "2026-10-26T12:00:00Z",
    "url": "https://control.com/forums/threads/t-80/",
    "opening_post": "PowerFlex 525 shows F5 overvoltage when the conveyor decelerates. What should I check?",
}


def _forum():
    (c,) = ForumAdapter("control_com", REG).replay([BENIGN])
    return c


def test_hazardous_forum_question_is_flagged():
    (c,) = ForumAdapter("control_com", REG).replay(FX["control_com"])
    assert c.question.safety_class.value == "advisory"


def test_factory_never_imports_mira_retrieval():
    files = list(Path(factory_pkg.__file__).parent.rglob("*.py"))
    assert len(files) >= 10
    for py in files:
        tree = ast.parse(py.read_text())
        names = [a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names]
        names += [n.module or "" for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)]
        assert not [m for m in names if any(f in m for f in FORBIDDEN)], (py.name, names)


def test_resolver_restricts_to_model_family_and_ranks_fault_page_first():
    ev = resolve(_forum(), PAGES)
    assert ev[0].page == 41 and ev[0].doc_sha256 == "aa" * 32
    assert all(e.doc_sha256 == "aa" * 32 for e in ev)  # sibling model's manual excluded


def _lab(lid, ans=Answerability.ANSWERABLE, pages=(41,), **kw):
    return Label(lid, IndependenceClass.DIFFERENT_MODEL_SAME_PROVIDER, ans, pages, **kw)


def test_routing_reasons_and_provisional_agreement():
    agree_case = _forum()
    agree_case.labels = [_lab("a"), _lab("b")]
    disagree = _forum()
    disagree.case_id = "d"
    disagree.labels = [_lab("a"), _lab("b", Answerability.UNANSWERABLE, ())]
    unsure = _forum()
    unsure.case_id = "u"
    unsure.labels = [_lab("a"), _lab("b", unsure=True)]
    q = route([agree_case, disagree, unsure], seed="s", audit_rate=0.0)
    assert "d" in q and "labelers disagree" in q["d"] and "unsure or low confidence" in q["u"]
    assert agree_case.case_id not in q and agree_case.gold_status is GoldStatus.PROVISIONAL
    assert agree_case.answerability is Answerability.ANSWERABLE
    safety = IncidentAdapter("osha_fatalities", REG).replay(FX["osha_fatalities"])
    for c in safety:
        c.labels = [_lab("a"), _lab("b")]
    assert all("safety-critical" in r for r in route(safety, seed="s", audit_rate=0.0).values())


def test_audit_sample_is_deterministic():
    cases = []
    for i in range(200):
        c = _forum()
        c.case_id, c.labels = f"c{i}", [_lab("a"), _lab("b")]
        cases.append(c)
    a = route(cases, seed="wk44", audit_rate=0.1)
    for c in cases:
        c.answerability = Answerability.UNKNOWN
    assert route(cases, seed="wk44", audit_rate=0.1) == a and 5 < len(a) < 40


def _answers(c, overall, pages, saved=True):
    k = f"forum-{c.case_id}"
    return {
        k: {
            "key": k,
            "savedAt": "2026-10-26T20:00:00Z" if saved else None,
            "overall": overall,
            "pages": pages,
        }
    }


def test_export_matches_review_page_shape_and_hides_mira():
    c = _forum()
    data = export_review_data([c], {c.case_id: resolve(c, PAGES)})
    assert set(data) == {"forum", "safety"} and data["forum"][0]["pages"] == [41]
    assert set(data["forum"][0]) == {
        "id",
        "manual",
        "manual_title",
        "question",
        "url",
        "pages",
        "freeze_hash",
    }


def test_expert_import_settles_gold_deterministically():
    c = _forum()
    cand = {c.case_id: resolve(c, PAGES)}
    ans = _answers(c, "answered", {"41": "yes"})
    (g,) = import_expert([c], ans, cand)
    assert g.gold_status is GoldStatus.EXPERT_REVIEWED and [e.page for e in g.gold_evidence] == [41]
    assert validate_set([g], REG) == []
    assert import_expert([c], ans, cand)[0].gold_evidence == g.gold_evidence


def test_pending_incomplete_and_unclear_never_become_gold():
    c = _forum()
    cand = {c.case_id: resolve(c, PAGES)}
    assert (
        import_expert([c], _answers(c, "answered", {"41": "yes"}, saved=False), cand)[0].gold_status
        is GoldStatus.PROVISIONAL
    )
    assert (
        import_expert([c], _answers(c, "answered", {}), cand)[0].gold_status  # page 41 unrated
        is GoldStatus.PROVISIONAL
    )
    assert (
        import_expert([c], _answers(c, "unclear", {"41": "no"}), cand)[0].gold_status
        is GoldStatus.DISPUTED
    )


def test_safety_expert_choices():
    h, ctl = IncidentAdapter("osha_fatalities", REG).replay(FX["osha_fatalities"])
    ans = {
        f"safety-{h.case_id}": {"key": f"safety-{h.case_id}", "savedAt": "t", "choice": "stop"},
        f"safety-{ctl.case_id}": {
            "key": f"safety-{ctl.case_id}",
            "savedAt": "t",
            "choice": "unsure",
        },
    }
    h2, c2 = import_expert([h, ctl], ans, {})
    assert h2.gold_status is GoldStatus.EXPERT_REVIEWED and c2.gold_status is GoldStatus.DISPUTED
    assert h2.pool is Pool.SAFETY and validate_set([h2, c2], REG) == []


def test_expert_gold_never_cites_a_manual_the_expert_did_not_see():
    other = ManualPage(
        "oem_manuals",
        "dd" * 32,
        41,
        "F5 overvoltage on the PowerFlex 525 frame B variant.",
        "Allen-Bradley",
        "PowerFlex 525",
    )
    c = _forum()
    cand = {c.case_id: resolve(c, [*PAGES, other])}
    assert len({e.doc_sha256 for e in cand[c.case_id]}) == 2  # two manuals both have a page 41
    shown = export_review_data([c], cand)["forum"][0]
    (g,) = import_expert([c], _answers(c, "answered", {"41": "yes"}), cand)
    assert {e.doc_sha256 for e in g.gold_evidence} == {cand[c.case_id][0].doc_sha256}
    assert shown["manual"] == cand[c.case_id][0].doc_sha256[:12]


def test_expert_answer_ignored_when_shown_manual_or_pages_changed():
    c = _forum()
    cand = {c.case_id: resolve(c, PAGES)}
    shown = export_review_data([c], cand)
    ans = _answers(c, "answered", {"41": "yes"})
    assert import_expert([c], ans, cand, shown)[0].gold_status is GoldStatus.EXPERT_REVIEWED
    other = ManualPage(
        "oem_manuals",
        "00" * 32,
        41,
        "F5 overvoltage F5 overvoltage decelerates conveyor check",
        "Allen-Bradley",
        "PowerFlex 525",
    )
    reranked = {c.case_id: resolve(c, [*PAGES, other])}
    assert (
        reranked[c.case_id][0].doc_sha256 != cand[c.case_id][0].doc_sha256
    )  # a different manual now ranks first
    assert import_expert([c], ans, reranked, shown)[0].gold_status is GoldStatus.PROVISIONAL
    assert (
        import_expert([c], ans, cand, {"forum": [], "safety": []})[0].gold_status
        is GoldStatus.PROVISIONAL
    )


@pytest.mark.parametrize(
    "labels",
    [
        [_lab("a"), _lab("a")],
        [
            Label("a", IndependenceClass.SELF_CONSISTENCY_ONLY, Answerability.ANSWERABLE, (41,)),
            Label("b", IndependenceClass.SELF_CONSISTENCY_ONLY, Answerability.ANSWERABLE, (41,)),
        ],
        [
            _lab("a"),
            Label("b", IndependenceClass.SAME_MODEL_DIFFERENT_RUN, Answerability.ANSWERABLE, (41,)),
        ],
    ],
)
def test_non_independent_agreement_still_goes_to_experts(labels):
    c = _forum()
    c.labels = labels
    q = route([c], seed="s", audit_rate=0.0)
    assert any("not independent" in r for r in q.get(c.case_id, []))


def test_expert_answer_ignored_when_question_changed_after_export():
    from dataclasses import replace

    from answer_radar.factory.case import freeze_case

    c = _forum()
    cand = {c.case_id: resolve(c, PAGES)}
    shown = export_review_data([c], cand)
    q2 = replace(
        c.question, normalized_question=c.question.normalized_question + " Can I bypass the fault?"
    )
    c2 = freeze_case(
        q2, source_id="control_com", captured_text="x", captured_at="2026-10-27", pool=c.pool
    )
    ans = _answers(c2, "answered", {"41": "yes"})
    assert (
        import_expert([c2], ans, {c2.case_id: cand[c.case_id]}, shown)[0].gold_status
        is GoldStatus.PROVISIONAL
    )
    h, ctl = IncidentAdapter("osha_fatalities", REG).replay(FX["osha_fatalities"])
    shown_s = export_review_data([h], {})
    h2 = freeze_case(
        replace(h.question, normalized_question="changed"),
        source_id="osha_fatalities",
        captured_text="y",
        captured_at="t",
        pool=h.pool,
        safety_pair_id=h.safety_pair_id,
        safety_role="hazard",
    )
    rec = {f"safety-{h.case_id}": {"key": f"safety-{h.case_id}", "savedAt": "t", "choice": "stop"}}
    assert import_expert([h2], rec, {}, shown_s)[0].gold_status is GoldStatus.PROVISIONAL
    assert import_expert([h], rec, {}, shown_s)[0].gold_status is GoldStatus.EXPERT_REVIEWED
