"""Hermetic tests for photo_diagnosis.simulator. No network, no free text."""

from __future__ import annotations

import random
import sys
from pathlib import Path

import pytest

TOOLS_QA = Path(__file__).resolve().parents[2] / "tools" / "qa"
if str(TOOLS_QA) not in sys.path:
    sys.path.insert(0, str(TOOLS_QA))

from photo_diagnosis.simulator import (  # noqa: E402
    DONT_KNOW,
    MANUAL_UPLOAD_REPLY_TEXT,
    MAX_NUDGES,
    NUDGE,
    REPEAT_PREFIX,
    RETAKE_REPLY_TEXT,
    ClassifierResult,
    SimulatorAlreadyStopped,
    TechSimulator,
)

CASE = {
    "id": "sim-case-1",
    "kind": "diagnosis",
    "type": "D",
    "reported_facts": "Guard door closed, pressed reset, CH1/CH2 lights won't come on.",
    "photo": "x.jpg",
    "checks": [
        {"id": "door_switch", "description": "door switch", "discriminates": ["a"]},
        {"id": "feedback_loop", "description": "feedback loop", "discriminates": ["a", "b"]},
    ],
    "hidden_facts": [
        {"id": "f1", "text": "Both channels make.", "revealed_by": ["door_switch"]},
        {
            "id": "f2",
            "text": "No continuity across the feedback loop at rest.",
            "revealed_by": ["feedback_loop"],
        },
    ],
    "hypotheses": [
        {"id": "a", "text": "welded K1", "status": "true_cause", "ruled_out_by": None},
        {"id": "b", "text": "open wire", "status": "acceptable_alternative", "ruled_out_by": None},
    ],
    "legit_product_asks": {
        "identity_confirm": "Confirming: Pilz PNOZ X3 on the guard-door circuit?",
        "retake_photo": "fixtures/clear_retake.jpg",
        "manual_upload": None,
    },
}


def _const_classifier(result: ClassifierResult):
    return lambda reply, checks: result


def test_opening_uses_reported_facts_and_flags_photo():
    sim = TechSimulator(CASE, _const_classifier(ClassifierResult()))
    opening = sim.opening()
    assert opening.startswith(CASE["reported_facts"])
    assert "[photo attached]" in opening


def test_new_check_reveals_verbatim_fact_text():
    sim = TechSimulator(CASE, _const_classifier(ClassifierResult(check_ids=["door_switch"])))
    turn = sim.respond("Can you check the door switch continuity?")
    assert turn.kind == "facts"
    assert turn.text == "Both channels make."
    assert turn.revealed_fact_ids == ["f1"]


def test_two_new_checks_join_facts_in_fixture_order():
    sim = TechSimulator(
        CASE, _const_classifier(ClassifierResult(check_ids=["feedback_loop", "door_switch"]))
    )
    turn = sim.respond("Check both the door switch and the feedback loop.")
    # fixture order is f1 (door_switch) then f2 (feedback_loop), regardless
    # of the order the classifier returned the ids in.
    assert turn.text == "Both channels make.\nNo continuity across the feedback loop at rest."
    assert turn.revealed_fact_ids == ["f1", "f2"]


def test_repeat_of_already_revealed_check_is_prefixed_and_counted():
    sim = TechSimulator(CASE, _const_classifier(ClassifierResult(check_ids=["door_switch"])))
    sim.respond("check door switch")
    turn = sim.respond("check door switch again")
    assert turn.kind == "repeat"
    assert turn.text == REPEAT_PREFIX + "Both channels make."
    assert turn.repeat_check_ids == ["door_switch"]


def test_irrelevant_ask_returns_exact_dont_know_constant():
    sim = TechSimulator(
        CASE, _const_classifier(ClassifierResult(check_ids=["not_a_real_check"], actionable=True))
    )
    turn = sim.respond("Check the quantum flux capacitor.")
    assert turn.kind == "dont_know"
    assert turn.text == DONT_KNOW


def test_identity_confirm_product_ask_returns_fixture_text():
    sim = TechSimulator(CASE, _const_classifier(ClassifierResult(product_ask="identity_confirm")))
    turn = sim.respond("Is this the Pilz PNOZ X3 on the guard-door circuit?")
    assert turn.kind == "product_ask"
    assert turn.product_ask == "identity_confirm"
    assert turn.text == CASE["legit_product_asks"]["identity_confirm"]


def test_retake_photo_product_ask_is_structured_and_carries_the_fixed_reply():
    sim = TechSimulator(CASE, _const_classifier(ClassifierResult(product_ask="retake_photo")))
    turn = sim.respond("Can you send a clearer photo?")
    assert turn.kind == "product_ask"
    assert turn.product_ask == "retake_photo"
    assert turn.text == RETAKE_REPLY_TEXT  # the fixed constant, not invented prose
    assert turn.product_ask_path == CASE["legit_product_asks"]["retake_photo"]


def test_product_ask_with_null_fixture_value_falls_back_to_dont_know():
    sim = TechSimulator(CASE, _const_classifier(ClassifierResult(product_ask="manual_upload")))
    turn = sim.respond("Can you attach the manual?")
    assert turn.kind == "dont_know"
    assert turn.text == DONT_KNOW


def test_nudge_then_stop_after_max_nudges():
    sim = TechSimulator(
        CASE, _const_classifier(ClassifierResult(check_ids=[], product_ask=None, actionable=False))
    )
    seen_kinds = []
    for _ in range(MAX_NUDGES):
        turn = sim.respond("Hmm, interesting.")
        seen_kinds.append(turn.kind)
        assert turn.text == NUDGE
    assert seen_kinds == ["nudge"] * MAX_NUDGES
    final = sim.respond("Hmm, interesting again.")
    assert final.kind == "stop"
    assert sim.stopped is True


def test_responding_after_stop_raises():
    sim = TechSimulator(CASE, _const_classifier(ClassifierResult(actionable=False)))
    sim.force_stop()
    with pytest.raises(SimulatorAlreadyStopped):
        sim.respond("anything")


def test_precedence_new_fact_beats_product_ask_in_same_reply():
    # classifier flags both a new check AND a product ask in one reply —
    # new facts win (spec precedence: new facts > repeat > product_ask > dont_know).
    sim = TechSimulator(
        CASE,
        _const_classifier(
            ClassifierResult(check_ids=["door_switch"], product_ask="identity_confirm")
        ),
    )
    turn = sim.respond("Confirming the Pilz, and checking the door switch.")
    assert turn.kind == "facts"


def test_classifier_cannot_invent_a_fact_for_an_unknown_check_id():
    # A classifier bug/hallucination returning a check id the fixture never
    # defined must not crash or leak anything — it is filtered out, and
    # with nothing else to go on this reply is treated as an irrelevant ask.
    sim = TechSimulator(CASE, _const_classifier(ClassifierResult(check_ids=["nonexistent_check"])))
    turn = sim.respond("Check the thing that doesn't exist.")
    assert turn.kind == "dont_know"
    assert turn.revealed_fact_ids == []


# ---------------------------------------------------------------------------
# Property test — every emitted SimTurn.text is fixture text or one of the
# three fixed constants. Fuzzed over random classifier outputs.

_FIXTURE_TEXTS = {f["text"] for f in CASE["hidden_facts"]}
_FIXTURE_TEXTS.add(CASE["legit_product_asks"]["identity_confirm"])
_CHECK_IDS = [c["id"] for c in CASE["checks"]] + ["bogus_a", "bogus_b"]
_PRODUCT_ASKS = ["identity_confirm", "retake_photo", "manual_upload", None, "bogus_ask"]


def _is_allowed_text(text: str) -> bool:
    if text in ("", DONT_KNOW, NUDGE, RETAKE_REPLY_TEXT, MANUAL_UPLOAD_REPLY_TEXT):
        return True
    if text in _FIXTURE_TEXTS:
        return True
    if text.startswith(REPEAT_PREFIX):
        remainder = text[len(REPEAT_PREFIX) :]
        parts = remainder.split("; ")
        return all(p in _FIXTURE_TEXTS for p in parts)
    # multi-fact "facts" turns are newline-joined fixture texts
    if "\n" in text:
        return all(p in _FIXTURE_TEXTS for p in text.split("\n"))
    return False


def test_property_every_sim_turn_text_is_fixture_text_or_a_fixed_constant():
    rng = random.Random(20261001)
    for _ in range(500):
        n_checks = rng.randint(0, 2)
        check_ids = rng.sample(_CHECK_IDS, k=n_checks) if n_checks else []
        product_ask = rng.choice(_PRODUCT_ASKS)
        actionable = rng.choice([True, False])
        result = ClassifierResult(
            check_ids=check_ids, product_ask=product_ask, actionable=actionable
        )
        sim = TechSimulator(CASE, _const_classifier(result))
        # drive a short random sequence of turns against the SAME simulator
        # so revealed/repeat state actually varies across the run.
        for _turn_i in range(rng.randint(1, 4)):
            if sim.stopped:
                break
            turn = sim.respond("some reply")
            assert _is_allowed_text(turn.text), f"disallowed text: {turn.text!r}"
