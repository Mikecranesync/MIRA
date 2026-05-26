"""Tests for classify_intent_v2 — conversational-engine front-desk classifier.

Spec: docs/specs/conversational-engine-upgrade-spec.md §3.2, §3.3
"""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

from shared.guardrails import LAYER1_INTENTS, classify_intent, classify_intent_v2

# ---------------------------------------------------------------------------
# Backwards compatibility — every v2 verdict is either a known v1 intent or
# one of the five new conversational intents.

KNOWN_V1 = {
    "safety",
    "industrial",
    "instructional",
    "documentation",
    "greeting",
    "help",
    "off_topic",
}
KNOWN_V2_NEW = {
    "general_knowledge",
    "small_talk",
    "clarification_needed",
    "attachment_only",
    "disengage",
}


def test_v2_returns_known_intents_only():
    samples = [
        "what is a VFD",
        "I have a fault",
        "morning, what's new?",
        "thanks",
        "PowerFlex 525 F0004 on line 5",
        "show me the manual for siemens g120",
        "hi",
    ]
    for s in samples:
        verdict = classify_intent_v2(s)
        assert verdict in (KNOWN_V1 | KNOWN_V2_NEW), f"{s!r} -> {verdict!r}"


# ---------------------------------------------------------------------------
# Safety always wins — even with photo, even with disengage tokens.


def test_v2_safety_tier1_wins_over_attachment():
    verdict = classify_intent_v2(
        "live panel",
        photo_present=True,
        uns_confidence=0.0,
    )
    assert verdict == "safety"


def test_v2_safety_tier1_wins_over_disengage():
    verdict = classify_intent_v2("live panel thanks", photo_present=False)
    assert verdict == "safety"


# ---------------------------------------------------------------------------
# Rule §3.2 step 2 — attachment with empty caption.


def test_v2_empty_photo_caption_routes_to_attachment_only():
    verdict = classify_intent_v2("", photo_present=True)
    assert verdict == "attachment_only"
    verdict = classify_intent_v2("?", photo_present=True)
    assert verdict == "attachment_only"


def test_v2_photo_with_caption_does_not_route_attachment_only():
    verdict = classify_intent_v2("this is my drive showing F0004", photo_present=True)
    # Has context — should NOT be attachment_only.
    assert verdict != "attachment_only"


# ---------------------------------------------------------------------------
# Rule §3.2 step 3 — in-session followup keeps industrial routing.


def test_v2_session_followup_in_active_state_keeps_industrial():
    # session_followup=True + non-IDLE state -> industrial regardless of phrasing
    verdict = classify_intent_v2(
        "yes",
        session_followup=True,
        fsm_state="Q2",
    )
    assert verdict == "industrial"


# ---------------------------------------------------------------------------
# Rule §3.2 step 4 — disengage shortcut on short messages.


def test_v2_disengage_short_message():
    for s in ("thanks", "thx", "nevermind", "got it"):
        assert classify_intent_v2(s) == "disengage", s


def test_v2_disengage_does_not_swallow_long_followup():
    # "thanks for the help, what about voltage" should NOT be disengage.
    verdict = classify_intent_v2("thanks for the help, what about voltage on a vfd")
    assert verdict != "disengage"


# ---------------------------------------------------------------------------
# Rule §3.2 step 6a — definition phrase + no context -> general_knowledge.


def test_v2_definition_phrase_no_context_routes_general_knowledge():
    cases = [
        "what is a VFD",
        "what is a soft starter",
        "how does PID work",
        "what's the difference between PNP and NPN",
        "explain modbus",
    ]
    for s in cases:
        verdict = classify_intent_v2(s, uns_confidence=0.0, has_session_asset=False)
        assert verdict == "general_knowledge", f"{s!r} -> {verdict!r}"


def test_v2_definition_phrase_with_uns_context_stays_industrial():
    # When the UNS resolver already locked context, an educational ask
    # routes through Layer 3 so the answer can be grounded.
    verdict = classify_intent_v2(
        "what does F0004 mean on this drive",
        uns_confidence=0.9,
        has_session_asset=True,
    )
    assert verdict == "industrial"


# ---------------------------------------------------------------------------
# Rule §3.2 step 6b — industrial without context -> clarification_needed.


def test_v2_industrial_without_context_routes_clarification():
    cases = [
        "I have a fault",
        "the line is down",
        "something's wrong",
        "motor won't start",
    ]
    for s in cases:
        verdict = classify_intent_v2(s, uns_confidence=0.0, has_session_asset=False)
        assert verdict == "clarification_needed", f"{s!r} -> {verdict!r}"


def test_v2_industrial_with_session_asset_stays_industrial():
    # Prior turn locked in equipment — current message follows up on it.
    verdict = classify_intent_v2(
        "I have a fault",
        uns_confidence=0.0,
        has_session_asset=True,
    )
    assert verdict == "industrial"


def test_v2_industrial_with_high_uns_confidence_stays_industrial():
    verdict = classify_intent_v2(
        "PowerFlex 525 throwing F0004",
        uns_confidence=0.9,
    )
    assert verdict == "industrial"


# ---------------------------------------------------------------------------
# Rule §3.2 step 7 — small talk beats single-word greeting.


def test_v2_multi_word_greeting_routes_small_talk():
    cases = [
        "morning, what's new",
        "good morning",
        "hey how are you",
        "what's up",
    ]
    for s in cases:
        verdict = classify_intent_v2(s)
        assert verdict == "small_talk", f"{s!r} -> {verdict!r}"


def test_v2_single_word_greeting_stays_greeting():
    assert classify_intent_v2("hi") == "greeting"
    assert classify_intent_v2("hello") == "greeting"


# ---------------------------------------------------------------------------
# LAYER1_INTENTS contract — every Layer-1 intent classify_intent_v2 can
# emit appears in the set (and the set has no extras).


def test_layer1_intents_set_covers_classifier_outputs():
    layer1_emittable = {
        "general_knowledge",
        "small_talk",
        "greeting",
        "help",
        "disengage",
        "off_topic",
        "clarification_needed",
        "attachment_only",
    }
    assert layer1_emittable == LAYER1_INTENTS


# ---------------------------------------------------------------------------
# Regression — v1 invocations must keep working exactly as before.


def test_classify_intent_v1_unchanged():
    # If this fails, v2 leaked into v1 — that's a regression.
    assert classify_intent("hi") == "greeting"
    assert classify_intent("PowerFlex 525 F0004") == "industrial"
    assert classify_intent("live panel") == "safety"
    assert classify_intent("how do I configure baud rate") == "instructional"
