"""Paid pre-labeling lane, exercised offline: budget, independence, exclusions, parsing."""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

from answer_radar.factory.case import Answerability, Evidence, Pool
from answer_radar.factory.discovery import ForumAdapter, MachineStateAdapter
from answer_radar.factory.labeling import route
from answer_radar.factory.prelabel import PROMPT, Budget, Labeler, prelabel
from answer_radar.factory.registry import SourceRegistry
from answer_radar.factory.variants import make_variants
from answer_radar.schema import IndependenceClass

REG = SourceRegistry.load()
FX = json.loads((Path(__file__).parent / "fixtures" / "discovery.json").read_text())
LABS = [Labeler("a", "u1", "m1", "k", 1.0, 1.0), Labeler("b", "u2", "m2", "k", 1.0, 1.0)]
EV = [Evidence("oem_manuals", "aa" * 32, 41, "F5 overvoltage")]


def _forum(i=1):
    rec = {
        "id": f"t-{i}",
        "captured_at": "2026-10-27",
        "opening_post": f"PowerFlex 525 F5 on decel, line {i}",
    }
    return ForumAdapter("control_com", REG).replay([rec])[0]


def _post(reply):
    seen = []

    def post(url, body, headers):
        seen.append(body)
        return {
            "choices": [{"message": {"content": reply}}],
            "usage": {"prompt_tokens": 1000, "completion_tokens": 50},
        }

    return post, seen


GOOD = (
    '{"answerability": "answerable", "pages": [41, 99], "safety_class": "none", "confidence": 0.9}'
)


def test_two_independent_labels_and_pages_limited_to_those_shown():
    post, seen = _post(GOOD)
    c = _forum()
    out = prelabel([c], {c.case_id: EV}, {}, LABS, Budget(1.0), post)
    labels = out[c.case_id]
    assert [lb.labeler_id for lb in labels] == ["a", "b"] and len(seen) == 2
    assert all(
        lb.pages == (41,) and lb.independence is IndependenceClass.INDEPENDENT_PROVIDER_MODEL
        for lb in labels
    )
    assert (
        route([replace(c, labels=labels)], seed="s", audit_rate=0.0) == {}
    )  # agreement -> provisional


def test_no_mira_answer_and_question_only_prompt():
    post, seen = _post(GOOD)
    c = _forum()
    prelabel(
        [c],
        {c.case_id: EV},
        {("aa" * 32, 41): "F5 overvoltage: check decel time"},
        LABS,
        Budget(1.0),
        post,
    )
    prompt = seen[0]["messages"][0]["content"]
    assert c.question.normalized_question in prompt and "check decel time" in prompt
    assert set(PROMPT.split("{question}")[0].lower().split()) & {"mira"} == set()


def test_budget_stops_before_the_cap_and_never_half_labels():
    post, seen = _post(GOOD)
    cases = [_forum(i) for i in range(50)]
    budget = Budget(0.02)  # ~1000 tokens in + 300 out at $1/M per call
    out = prelabel(cases, {c.case_id: EV for c in cases}, {}, LABS, budget, post)
    assert budget.spent_usd <= 0.02 and 0 < len(out) < 50
    assert all(len(v) == 2 for v in out.values()) and len(seen) == 2 * len(out)


def test_unparseable_output_becomes_an_unsure_label_and_routes_to_experts():
    post, _ = _post("I think it is page 41")
    c = _forum()
    labels = prelabel([c], {c.case_id: EV}, {}, LABS, Budget(1.0), post)[c.case_id]
    assert all(lb.unsure and lb.answerability is Answerability.UNKNOWN for lb in labels)
    assert (
        "unsure or low confidence"
        in route([replace(c, labels=labels)], seed="s", audit_rate=0.0)[c.case_id]
    )


def test_holdout_and_variants_are_never_sent():
    post, seen = _post(GOOD)
    c = _forum()
    live = replace(_forum(2), pool=Pool.LIVE, holdout=True, exposed_to_developers=False)
    out = prelabel([live, *make_variants(c), c], {}, {}, LABS, Budget(1.0), post)
    assert list(out) == [c.case_id] and len(seen) == 2


def test_dataset_rows_take_their_own_label_without_a_model():
    post, seen = _post(GOOD)
    (m,) = MachineStateAdapter("uci_ai4i", REG).replay(FX["uci_ai4i"])
    labels = prelabel([m], {}, {}, LABS, Budget(1.0), post)[m.case_id]
    assert seen == [] and labels[0].independence is IndependenceClass.DETERMINISTIC_PROOF
    assert route([replace(m, labels=labels)], seed="s", audit_rate=0.0) == {}


def test_failed_calls_are_charged_worst_case_and_become_unsure():
    def post(url, body, headers):
        raise TimeoutError

    c = _forum()
    budget = Budget(1.0)
    labels = prelabel([c], {c.case_id: EV}, {}, LABS, budget, post)[c.case_id]
    assert budget.spent_usd > 0 and all(lb.unsure for lb in labels)
    assert all(call["error"] == "TimeoutError" for call in budget.calls)


def test_variants_never_enter_the_expert_queue():
    c = _forum()
    vs = make_variants(c)
    q = route([c, *vs], seed="s", audit_rate=0.0)
    assert vs and set(q) == {c.case_id}  # the unlabeled original is queued, its variants are not
