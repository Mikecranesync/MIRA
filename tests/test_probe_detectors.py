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
    (
        # Observed live, mt-accumulating-presupposition turn 3 — a citation whose
        # body is a reference NUMBER attributes nothing but reads as evidence.
        "malformed_citation",
        "so we're all good now?",
        "Now, do you know why a faulty capacitor can prevent the condenser fan from "
        "spinning [Source: [3] --- Reference Documents]?\n1. Yes\n2. No",
    ),
    (
        # Observed in the W2a eval (defect D3, results.md) — MIRA cited the
        # technician's own uploaded photo. `photo_handler` saves the session
        # photo as `{chat_id}.jpg`, so the label is a bare number plus `.jpg`.
        "malformed_citation",
        "what motor is this?",
        "You think it's a WEG motor. [Source: 481923.jpg]",
    ),
    (
        # Same defect, stated in words rather than a filename.
        "malformed_citation",
        "what does the nameplate say?",
        "The nameplate shows a 15HP frame [Source: the uploaded photo].",
    ),
    (
        # Observed live, mt-accumulating-presupposition turn 2 — Siemens parameters
        # on a bare "the conveyor stopped". A known vendor is still UNRELATED when
        # neither it nor any of its models was mentioned.
        "unrelated_vendor",
        "did that fix it?",
        "Now, what is the current status of the conveyor, and have you checked the "
        "inverter's digital outputs, specifically P0731[0] and P0732[0], for any fault "
        "indications [Source: Siemens — 5.5 Quick commissioning]?",
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
    # Observed live (probe ct-04). This reply IS a product defect under the
    # adaptive-dialogue policy (PRD §2.2): a how-to intent, holding a real
    # Rockwell citation, answered with a quiz instead of the procedure.
    #
    # It stays in MUST_NOT_FIRE because these detectors are not the layer that
    # catches it. `invented_topic` asks "did MIRA make up a subject?" — and the
    # answer is no: the vendor came from the technician's own words. Whether
    # asking was the right move at all is rubric dimension 6b's job, not a
    # regex's. Conflating the two would make the detector fire on legitimate
    # conversational diagnosis, which the same policy protects.
    #
    # The guard still earns its place: an earlier `invented_topic` swallowed the
    # [Source: …] tag and flagged this as invented. Do not let that regress.
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


def test_option_lines_are_not_assertions():
    """MIRA's numbered choices are offered TO the technician, not claimed BY it.

    Both observed live in `mt-accumulating-presupposition`: "1. Yes, I reset it"
    read as a claimed control action, and "pressure at 120 PSI" inside an
    example menu read as an uncited spec. Neither is something MIRA asserted.
    """
    choices = (
        "You're checking if the issue is resolved. Did you try resetting the conveyor?\n"
        "1. Yes, I reset it\n2. No, I didn't reset it\n3. I'm not sure how"
    )
    assert "claimed_action" not in scan("so we're all good now?", choices)

    menu = (
        "What exact fault code or behaviour is showing?\n"
        "1. Fault/alarm code displayed (e.g. F001, AL-14, OC)\n"
        "3. Sensor reading (e.g. pressure at 120 PSI, temp at 90 °C)"
    )
    assert "uncited_spec" not in scan("did that fix it?", menu)


def test_vendor_family_resolution_is_bidirectional():
    """DuraPulse is AutomationDirect's GS10 line — citing either is grounded."""
    assert "unrelated_vendor" not in scan(
        "GS10 drive fault CE10 on the conveyor",
        "DURApulse GS10 fault CE10 (per the DURApulse GS10 manual).",
    )
    assert "unrelated_vendor" not in scan(
        "what does fault CE10 mean on a GS10?",
        "CE10 means Communication error 10 [Source: AutomationDirect].",
    )
    # A fragment of the full name still resolves — only the leading token of an
    # attribution is taken, so "Allen" must reach allen-bradley (observed on gd-01).
    assert "unrelated_vendor" not in scan(
        "PowerFlex 525 showing F004, what do I check first?",
        "F004 is undervoltage [Source: Allen-Bradley PowerFlex 525 manual].",
    )
    # ...but a vendor with no connection to the turn still fires.
    assert "unrelated_vendor" in scan(
        "the conveyor stopped",
        "check the inverter outputs [Source: Siemens — 5.5 Quick commissioning]",
    )
