"""#4015 item 4 — a back-reference to something MIRA "said" in a chat where
MIRA has said nothing must get a clarifying question, never an invented context.

staging-gate run 36257246461: "you said to check the wiring — which wire" on a
fresh chat routed ``diagnose_equipment`` -> ``FIX_STEP`` on one draw (judge
context=1, confirmed by a second judge draw) and ``general_question`` on the
next. ``detect_session_followup`` returns False on IDLE/no-context, so no
deterministic lane owned the turn and the LLM router guessed.
"""

from __future__ import annotations

import sys
import pytest

sys.path.insert(0, "mira-bots")

from shared.guardrails import (  # noqa: E402
    ORPHAN_BACK_REFERENCE_REPLY,
    is_orphan_back_reference,
)

ORPHANS = [
    "you said to check the wiring — which wire",  # staging_questions.yaml session-followup, verbatim
    "You mentioned a fuse, which one?",
    "you told me to reset it, how?",
    "earlier you said the contactor was bad",
    "you suggested checking P02.00, what value",
]

NOT_ORPHANS = [
    "which wire should I check on the GS10",
    "what did the manual say about carrier frequency",
    "the operator said it tripped twice",
    "they told me to check the wiring",
    "what does that mean",
    "",
]

ASSISTANT_SPOKE = [
    {"role": "user", "content": "conveyor stopped"},
    {"role": "assistant", "content": "Check the wiring at the motor terminal box."},
]


@pytest.mark.parametrize("message", ORPHANS)
def test_orphan_back_reference_on_a_fresh_chat(message):
    assert is_orphan_back_reference(message, [])
    assert is_orphan_back_reference(message, None)


@pytest.mark.parametrize("message", NOT_ORPHANS)
def test_ordinary_questions_are_not_back_references(message):
    assert not is_orphan_back_reference(message, [])


@pytest.mark.parametrize("message", ORPHANS)
def test_a_real_prior_assistant_turn_keeps_the_existing_followup_lane(message):
    assert not is_orphan_back_reference(message, ASSISTANT_SPOKE)


def test_injected_cross_session_memory_stands_the_lane_down():
    msg = "[MIRA MEMORY chat=1]\n- told tech to check wiring\n[END MEMORY]\nyou said to check the wiring — which wire"
    assert not is_orphan_back_reference(msg, [])


def test_reply_asks_instead_of_inventing():
    r = ORPHAN_BACK_REFERENCE_REPLY
    assert "?" in r
    assert "earlier message from me" in r
    assert "[Source" not in r
