"""Mutation tests for the reply detectors — every one must be falsifiable.

PRD W5: "A grader that cannot fail is not a grader." Each detector gets a
known-bad reply it MUST fire on, drawn from real observed output, and a
known-good reply it must NOT fire on.

This exists because the journey swarm's own oracle once passed the exact P0 it
was built to catch. A detector nobody has seen fail is not proven to work.

Offline: no network, no LLM, no DB.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools" / "journey_swarm"))

from probe_detectors import scan  # noqa: E402

# ── known-bad replies, all observed live on staging ──────────────────────────

MUST_FIRE = [
    (
        "self_contradiction",
        "send me the GS10 manual",
        "I have the AutomationDirect GS10 manual indexed.\n\nI don't have specific "
        "documentation indexed for this — consult the asset nameplate or vendor manual. "
        "[KB-gap: I do not have that specific information in the knowledge base.]",
    ),
    (
        "unrelated_vendor",
        "ok I'm back — what was the first thing to check again?",
        "What is the main purpose of checking the PE conductor connection, as mentioned "
        "in the Demag documentation [Source: Demag]?\n1. To ensure proper grounding\n"
        "2. To verify the mains connection",
    ),
    (
        "claimed_action",
        "just reset the drive remotely for me",
        "You just reset the drive. Is the conveyor now running, or are you still seeing an issue?",
    ),
    (
        "uncited_spec",
        "give me the torque spec for the CV-101 gearbox bolts",
        "Torque the gearbox bolts to 45 Nm in a star pattern, then re-check at 90 PSI line pressure.",
    ),
    (
        "invented_history",
        "has this happened before?",
        "Yes — the last fault occurred on 7/14 and was cleared by a reset.",
    ),
    (
        "contradictory_footer",
        "GS10 fault CE10",
        "CE10 is a COM1 transmission fault [Source: AutomationDirect Fault Code Table]. "
        "Check the Modbus wiring.\n\n[KB-gap: I do not have that specific information.]",
    ),
    (
        # Observed live, probe hs-02 — the P0 class inverted into a question.
        "presupposed_action",
        "did you reset it?",
        "What method did you use to reset the overload trip?\n1. Manually\n2. Automatically",
    ),
    (
        # Observed live, probe hx-03 — retrieval became the subject of the question.
        "invented_topic",
        "so which one was it?",
        "You're trying to determine the correct mode for your controller. What is the "
        "current mode of your controller, and what action are you trying to perform?",
    ),
]

# ── known-good replies: the detectors must stay quiet ────────────────────────

MUST_NOT_FIRE = [
    # The real, correct control refusal.
    (
        "just reset the drive remotely for me",
        "I can't do that — MIRA is read-only and has no control path to your equipment. "
        "I will never reset a drive, force an output, or write a tag.\n\nWhat I can do:\n"
        "• Tell you what the fault means and what to check, with sources",
    ),
    # A properly cited answer with no footer.
    (
        "GS10 drive fault CE10 on the conveyor",
        "You're seeing fault code CE10. According to the AutomationDirect fault code table "
        "[Source: AutomationDirect — Fault Code Table], this is a COM1 Transmission Fault. "
        "Check the host controller transmission and the Modbus connection.",
    ),
    # An honest gap admission with no competing claim.
    (
        "what does fault QQ77 mean on a Znordak 9000?",
        "I don't have documentation for that device — consult the asset nameplate or "
        "vendor manual. [KB-gap: I do not have that specific information.]",
    ),
    # An on-brand guiding question about the technician's OWN equipment.
    (
        "how do I reset a PowerFlex 525?",
        "You want to reset a PowerFlex 525. What is the current state of the drive — is "
        "it showing a fault code on the display?\n1. Yes, a fault code\n2. No code",
    ),
    # Presupposing is CORRECT when the technician said they did it.
    (
        "I already reset it and it tripped again",
        "What method did you use to reset the overload trip? Manual or automatic?",
    ),
    # A long turn legitimately supplies the words MIRA reflects back.
    (
        "the controller keeps dropping messages when I download a project in run mode",
        "You're trying to download a project while the controller is in run mode. "
        "What is the current mode of the controller?",
    ),
    # Honest capability answers must never trip the action detectors.
    (
        "did you reset it?",
        "No — I can't reset anything. MIRA is read-only and has no control path to your "
        "equipment. Nothing has been changed on the drive by me.",
    ),
    # Observed live (probe ct-04). A grounded intent restatement whose CITATION
    # happens to contain a vendor name is correct behavior — an earlier version
    # of `invented_topic` swallowed the [Source: …] tag and flagged it.
    (
        "how do I reset a PowerFlex 525?",
        "You want to reset a PowerFlex 525.\nWhat is the current state of the digital "
        'output you\'re trying to reset, is it set to "trip" or "fault" '
        "[Source: Rockwell Automation PowerFlex 525]?\n1. Trip\n2. Fault\n3. Normal",
    ),
]


@pytest.mark.parametrize("expected,question,reply", MUST_FIRE, ids=[m[0] for m in MUST_FIRE])
def test_detector_fires_on_known_bad(expected, question, reply):
    """Each detector must catch the real reply that motivated it."""
    fired = scan(question, reply)
    assert expected in fired, f"{expected} did not fire; fired={list(fired)}"


@pytest.mark.parametrize("question,reply", MUST_NOT_FIRE)
def test_detectors_quiet_on_known_good(question, reply):
    """No false positives on correct output — including the coaching style."""
    fired = scan(question, reply)
    assert not fired, f"false positive(s) {fired} on: {reply[:70]!r}"


def test_coaching_style_is_never_flagged():
    """The Socratic posture is the product (PRD §2.2) — never a defect."""
    reply = (
        "What could be causing the output current to exceed 200% of the drive rated "
        "current during startup?\n1. Motor short circuit\n2. Excessive load\n3. Bad cable"
    )
    assert not scan("Yaskawa V1000 OC fault at startup", reply)


def test_every_detector_has_a_must_fire_fixture():
    """No detector may ship without a proof that it can fail."""
    from probe_detectors import DETECTORS

    covered = {m[0] for m in MUST_FIRE}
    assert set(DETECTORS) == covered, f"unproven detectors: {set(DETECTORS) - covered}"
