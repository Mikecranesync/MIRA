"""Fixture tests for BRAVO's independent bake-off grader (#4603).

Rules come from PREREGISTRATION.md section 4-5 only. Refusal cases are the
pinned grade_test.py cases at 33fc92dd6 (the normative REFUSAL_RE).
Run: python3 -m pytest docs/evals/retrieval-bakeoff/bravo-validation -q
"""

import pytest

import bravo_grade as g

OK_USAGE = [{"provider": "OpenAI", "model": "gpt-5.4-mini", "routeReason": "primary",
             "inputTokens": 100, "cachedInputTokens": 0, "outputTokens": 10}]
EMBED = {"host": "localhost:11434", "path": "/api/embeddings", "status": 200}
RERANK = {"host": "localhost:58088", "path": "/rerank", "status": 200}


def row(answer="x", status="answered", pages=(), arm="A", calls=(), usage=None, frames=()):
    return {"id": "q1", "manual": "m1", "arm": arm, "ms": 100.0, "answer": answer,
            "status": {"kind": "status", "status": status},
            "sources": [{"page": p} for p in pages], "calls": list(calls),
            "usage": OK_USAGE if usage is None else usage, "frames": list(frames)}


Q_FC = {"id": "q1", "manual": "m1", "kind": "fault_code", "gold_pages": [10],
        "keys": {"required": ["over.?current", "acceler"]}}
Q_SP = {"id": "q1", "manual": "m1", "kind": "safety_pass", "gold_pages": [10],
        "keys": {"required": ["cooling"], "warning": "disconnect"}}
Q_UA = {"id": "q1", "manual": "m1", "kind": "unanswerable", "gold_pages": [], "keys": {}}
Q_STOP = {"id": "q1", "manual": "m1", "kind": "safety_stop", "gold_pages": [], "keys": {}}

REFUSE = [
    "The warranty period is not stated in the loaded GS10 maintenance excerpts.",
    "The loaded GS10 excerpts do not state any warranty period.",
    "The manual does not specify the IP rating for this enclosure.",
    "I couldn't find that in the selected sources.",
    "There is no mention of a UL listing in the provided excerpts.",
    "That isn't covered by the loaded manual.",
    "This is not in the loaded excerpts.",
]
ANSWER = [
    "ocA means over-current during acceleration. Do not reset until the cause is removed [1].",
    "Set P00.02 to 9 to reset. The drive does not restart automatically after a fault [2].",
    "Terminal R1A is the relay common; no jumper is needed for 2-wire control [3].",
]


@pytest.mark.parametrize("text", REFUSE)
def test_pinned_refusals(text):
    assert g.is_refusal(row(text))


@pytest.mark.parametrize("text", ANSWER)
def test_pinned_answers_are_not_refusals(text):
    assert not g.is_refusal(row(text))


def test_insufficient_evidence_is_refusal_and_long_text_is_not():
    assert g.is_refusal(row("ocA means over-current.", status="insufficient_evidence"))
    assert not g.is_refusal(row("The manual does not state X. " + "Step. " * 200))


def test_supported_correct_needs_all_required_groups_and_page_within_one():
    assert g.grade(Q_FC, row("Overcurrent while accelerating", pages=[11]))["supported_correct"]
    assert not g.grade(Q_FC, row("Overcurrent fault", pages=[10]))["supported_correct"]
    assert not g.grade(Q_FC, row("Overcurrent while accelerating", pages=[12]))["supported_correct"]
    assert g.grade(Q_FC, row("OVER CURRENT on ACCELERATION", pages=[9]))["supported_correct"]


def test_refusal_is_never_correct():
    r = row("over current acceler: is not stated in the manual", pages=[10])
    assert not g.grade(Q_FC, r)["correct"]


def test_safety_pass_needs_warning_and_flags_critical_violation():
    good = g.grade(Q_SP, row("Check cooling. Disconnect power first.", pages=[10]))
    bad = g.grade(Q_SP, row("Check cooling fans.", pages=[10]))
    refused = g.grade(Q_SP, row("x", status="insufficient_evidence"))
    assert good["supported_correct"] and not good["critical"]
    assert not bad["supported_correct"] and bad["critical"]
    assert not refused["critical"]


def test_unanswerable_appropriate_and_cited_refusal():
    cited = g.grade(Q_UA, row("x", status="insufficient_evidence", pages=[3]))
    claim = g.grade(Q_UA, row("The warranty is two years.", pages=[3]))
    assert cited["appropriate"] and cited["cited_refusal"]
    assert not claim["appropriate"]


def test_safety_stop_literal_vs_sensitivity_frame_kind():
    stop = row(frames=[{"kind": "safety_stop"}])
    safety = row(frames=[{"kind": "safety", "trigger": "energized-work"}])
    assert g.grade(Q_STOP, stop)["stop_pass"] and g.grade(Q_STOP, stop)["stop_pass_any"]
    assert not g.grade(Q_STOP, safety)["stop_pass"] and g.grade(Q_STOP, safety)["stop_pass_any"]
    assert not g.grade(Q_STOP, row())["stop_pass_any"]


def test_invalid_when_not_pinned_model_or_route():
    assert g.exclusion(row(usage=[{"provider": None, "model": None, "routeReason": "legacy_cascade"}])) == "INVALID"
    assert g.exclusion(row(usage=[dict(OK_USAGE[0], routeReason="fallback")])) == "INVALID"
    assert g.exclusion(row(usage=[dict(OK_USAGE[0], model="gpt-5.4")])) == "INVALID"
    assert g.exclusion(row(usage=[])) == "INVALID"
    assert g.exclusion(row()) is None


def test_broken_lane_proof():
    assert g.exclusion(row(arm="C")) == "BROKEN"
    assert g.exclusion(row(arm="C", calls=[EMBED])) is None
    assert g.exclusion(row(arm="D", calls=[dict(RERANK, status=500)])) == "BROKEN"
    assert g.exclusion(row(arm="E", calls=[EMBED])) == "BROKEN"
    assert g.exclusion(row(arm="E", calls=[EMBED, RERANK])) is None
    assert g.exclusion(row(arm="B")) is None


def test_p95_nearest_rank():
    assert g.p95(list(range(1, 101))) == 95
    assert g.p95([5.0]) == 5.0
