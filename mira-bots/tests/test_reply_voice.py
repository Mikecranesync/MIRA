"""The apology voice never reaches a technician (prod, 2026-08-16).

The live defect, straight off the bot log:

    parse_response fallback; raw="You are absolutely right! My apologies. I am
    unable to access external files or previous conversation history."

The model dropped the JSON response contract, `parse_response` took its
plain-text branch, and that prose went out verbatim — sycophancy, a capability
claim that is FALSE of this platform, and then H4's canned KB-gap line bolted
underneath it, so one message admitted the same nothing twice in two voices.

Pinned here:

- the exact live string is sanitized: no banned phrase survives, and the whole
  pipeline (`sanitize_voice` → `enforce_citation_or_gap_admission`) leaves
  EXACTLY one gap statement;
- a normal grounded answer passes through byte-identical;
- the coupling that makes the ordering work — every phrase this module treats
  as a gap admission is one H4 also recognises.

Offline: no network, no LLM, no DB. Pure text.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "mira-bots"))

os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_test.db")

import pytest  # noqa: E402

from shared.reply_voice import (  # noqa: E402
    GAP_ADMISSION,
    GAP_MARKER_PHRASES,
    gap_statement_count,
    is_capability_disclaimer,
    is_gap_statement,
    sanitize_voice,
)

# The reply as the log captured it. `parse_response` truncates its warning at
# 200 chars, so this is the full captured span, not a paraphrase.
LIVE_RAW = (
    "You are absolutely right! My apologies. I am unable to access external "
    "files or previous conversation history."
)

# Everything the technician must never read.
BANNED_SUBSTRINGS = (
    "absolutely right",
    "my apologies",
    "i apologize",
    "i apologise",
    "great question",
    "unable to access",
    "as an ai",
)


def _banned_hits(text: str) -> list[str]:
    lowered = text.lower()
    return [phrase for phrase in BANNED_SUBSTRINGS if phrase in lowered]


# ── 1. the live string ───────────────────────────────────────────────────────


def test_live_raw_loses_every_banned_phrase():
    assert _banned_hits(LIVE_RAW), "fixture must actually contain the defect"
    assert _banned_hits(sanitize_voice(LIVE_RAW)) == []


def test_live_raw_ends_with_exactly_one_gap_statement():
    sanitized = sanitize_voice(LIVE_RAW)
    assert gap_statement_count(sanitized) == 1
    assert sanitized == GAP_ADMISSION


def test_live_raw_through_the_full_pipeline_admits_the_gap_once():
    """sanitize_voice → H4 is the shipped order; H4 must add nothing on top."""
    from shared.engine import enforce_citation_or_gap_admission

    sanitized = sanitize_voice(LIVE_RAW)
    final = enforce_citation_or_gap_admission(sanitized, dispatch_kind="industrial")

    assert final == sanitized, "H4 appended a second admission"
    assert gap_statement_count(final) == 1
    assert _banned_hits(final) == []


def test_unsanitized_live_raw_would_have_earned_a_second_admission():
    """The regression this ordering prevents — proves the guard is load bearing."""
    from shared.engine import enforce_citation_or_gap_admission

    unguarded = enforce_citation_or_gap_admission(LIVE_RAW, dispatch_kind="industrial")
    assert gap_statement_count(unguarded) > 1
    assert _banned_hits(unguarded)


# ── 2. a good reply is untouched ─────────────────────────────────────────────


GOOD_REPLY = (
    "F0004 on a PowerFlex 525 is a ground fault on the drive output.\n"
    "\n"
    "1. Lock out the drive and verify zero energy at T1/T2/T3.\n"
    "2. Megger U, V, W to ground. Under 1 megohm means the motor or the cable "
    "is the fault, not the drive.\n"
    "3. Disconnect the motor leads and re-test the drive alone to split it.\n"
    "\n"
    "[Source: PowerFlex 525 Adjustable Frequency AC Drive User Manual — Fault "
    "Codes]"
)


def test_good_reply_passes_through_byte_identical():
    assert sanitize_voice(GOOD_REPLY) == GOOD_REPLY


@pytest.mark.parametrize(
    "reply",
    [
        "The GS10 trips OC on acceleration when the ramp is shorter than the load allows.",
        "Which fault code is on the keypad right now?",
        "Set P00.11 to 10 seconds and retry. [Source: GS10 User Manual]",
        "I can't see the fault code in the photo you sent — send a closer shot of the keypad.",
        "Absolutely necessary to lock out before you open that cabinet.",
        "I don't have specific documentation indexed for this — consult the asset "
        "nameplate or vendor manual.",
        "",
        "   ",
    ],
)
def test_clean_replies_are_never_rewritten(reply):
    assert sanitize_voice(reply) == reply


# ── 3. sycophancy ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "reply,expected",
    [
        ("You are absolutely right! The drive is a GS10.", "The drive is a GS10."),
        ("You're right. The drive is a GS10.", "The drive is a GS10."),
        ("My apologies. The drive is a GS10.", "The drive is a GS10."),
        ("My apologies, the drive is a GS10.", "The drive is a GS10."),
        ("I apologize for the confusion. The drive is a GS10.", "The drive is a GS10."),
        ("Great question! The drive is a GS10.", "The drive is a GS10."),
        ("That's a great question. The drive is a GS10.", "The drive is a GS10."),
        ("Thanks for the photo. The drive is a GS10.", "The drive is a GS10."),
        ("Of course! The drive is a GS10.", "The drive is a GS10."),
        ("Certainly. The drive is a GS10.", "The drive is a GS10."),
        ("I understand how frustrating that is. The drive is a GS10.", "The drive is a GS10."),
    ],
)
def test_leading_filler_is_removed_and_the_claim_survives(reply, expected):
    assert sanitize_voice(reply) == expected


def test_stacked_filler_in_one_sentence_is_fully_stripped():
    assert sanitize_voice("Of course! My apologies, the breaker is 40 A.") == (
        "The breaker is 40 A."
    )


def test_a_reply_that_is_only_filler_becomes_the_gap_line():
    assert sanitize_voice("You are absolutely right! My apologies.") == GAP_ADMISSION


def test_list_structure_survives_a_strip():
    reply = "My apologies. Do this:\n- Great question! Check L1 to L2.\n- Megger the motor."
    assert sanitize_voice(reply) == "Do this:\n- Check L1 to L2.\n- Megger the motor."


# ── 4. false capability claims ───────────────────────────────────────────────


@pytest.mark.parametrize(
    "sentence",
    [
        "I am unable to access external files or previous conversation history.",
        "I'm unable to access the internet.",
        "I cannot browse the web for that datasheet.",
        "I don't have access to previous conversations.",
        "I do not retain chat history between sessions.",
        "As an AI language model, I have no way to open that.",
        "As an AI, I cannot help with that.",
    ],
)
def test_capability_disclaimers_are_detected(sentence):
    assert is_capability_disclaimer(sentence)


@pytest.mark.parametrize(
    "sentence",
    [
        "I can't see the fault code in the photo you sent.",
        "I cannot read the serial number — the plate is glared out.",
        "I am unable to confirm the wiring without the schematic.",
        "The drive cannot access the encoder feedback at that scaling.",
        "I don't have the ability to write to the PLC, and I never will.",
    ],
)
def test_turn_local_limits_are_not_disclaimers(sentence):
    """An honest, specific limitation is information — it must survive."""
    assert not is_capability_disclaimer(sentence)


def test_a_disclaimer_is_replaced_not_merely_deleted():
    reply = "The plate reads GS10. I am unable to access external files."
    assert sanitize_voice(reply) == f"The plate reads GS10. {GAP_ADMISSION}"


# ── 5. one admission, not two ────────────────────────────────────────────────


def test_a_second_gap_admission_is_dropped():
    reply = (
        "I don't have specific documentation indexed for that drive. "
        "Check the keypad for the active fault. "
        "I do not have that specific information in the knowledge base."
    )
    sanitized = sanitize_voice(reply)
    assert gap_statement_count(sanitized) == 1
    assert "Check the keypad for the active fault." in sanitized


def test_a_disclaimer_after_a_real_admission_is_dropped_outright():
    reply = (
        "I don't have specific documentation indexed for that drive. "
        "I am unable to access external files."
    )
    sanitized = sanitize_voice(reply)
    assert gap_statement_count(sanitized) == 1
    assert "unable to access" not in sanitized.lower()
    assert sanitized.count(GAP_ADMISSION) == 0  # the model's own wording is kept


def test_a_single_admission_is_never_dropped():
    reply = "That model is not indexed here. Read the value off the nameplate instead."
    assert sanitize_voice(reply) == reply
    assert gap_statement_count(reply) == 1


# ── 6. the coupling that makes the ordering safe ─────────────────────────────


def test_gap_markers_are_a_subset_of_the_h4_vocabulary():
    """If H4 didn't recognise these, collapsing here would just move the
    second admission downstream — the exact defect this slice closes."""
    from shared.engine import _H4_GAP_PHRASES

    assert set(GAP_MARKER_PHRASES) <= set(_H4_GAP_PHRASES)


@pytest.mark.parametrize("phrase", GAP_MARKER_PHRASES)
def test_every_gap_marker_suppresses_the_h4_append(phrase):
    from shared.engine import enforce_citation_or_gap_admission

    reply = f"Torque limit is set high on this line. {phrase} something about it."
    assert is_gap_statement(reply)
    assert enforce_citation_or_gap_admission(reply, dispatch_kind="industrial") == reply


def test_the_gap_admission_line_satisfies_h4():
    from shared.engine import enforce_citation_or_gap_admission

    assert is_gap_statement(GAP_ADMISSION)
    assert (
        enforce_citation_or_gap_admission(GAP_ADMISSION, dispatch_kind="industrial")
        == GAP_ADMISSION
    )


# ── 7. wiring ────────────────────────────────────────────────────────────────


def test_supervisor_process_applies_the_voice_guard_before_h4():
    source = (REPO / "mira-bots" / "shared" / "engine.py").read_text(encoding="utf-8")
    guard = source.index("reply = sanitize_voice(reply)")
    h4 = source.index("reply = enforce_citation_or_gap_admission(")
    assert guard < h4, "the voice guard must run before the H4 enforcer"
