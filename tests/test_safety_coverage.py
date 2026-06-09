"""Safety keyword coverage tests.

Verifies every SAFETY_KEYWORD triggers classify_intent('safety'), that educational
framing bypasses it correctly, and that new power-isolation phrases from BUG-FORENSIC-003
are present and firing.
"""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

import pytest

from shared.guardrails import SAFETY_KEYWORDS, classify_intent

# ── Every keyword in SAFETY_KEYWORDS must fire ────────────────────────────────

@pytest.mark.parametrize("keyword", SAFETY_KEYWORDS)
def test_safety_keyword_fires(keyword):
    """Each SAFETY_KEYWORD must produce 'safety' intent when used in a plain report."""
    msg = f"I need help — {keyword} near the panel"
    assert classify_intent(msg) == "safety", (
        f"Keyword '{keyword}' failed to trigger safety intent"
    )


# ── Negative tests: educational framing must NOT trigger safety ───────────────

_EDUCATIONAL_FRAMES = [
    "what is arc flash",
    "how do I perform LOTO",
    "the restricted approach boundary is defined as",
    "can you explain what lockout tagout means",
    "what does de-energize mean in an industrial context",
    "how is confined space defined by OSHA",
]

@pytest.mark.parametrize("msg", _EDUCATIONAL_FRAMES)
def test_educational_framing_bypasses_safety(msg):
    """Educational questions should NOT trigger safety escalation."""
    result = classify_intent(msg)
    assert result != "safety", (
        f"Educational framing '{msg}' incorrectly classified as 'safety'"
    )


# ── BUG-FORENSIC-003: power isolation phrases must be present ─────────────────

_REQUIRED_ISOLATION_PHRASES = [
    "isolate power",
    "which cable to pull",
    "which wire to pull",
    "pull the cable",
    "cut the power",
    "cut power",
    "disconnect power",
    "disconnect the power",
    # Pre-existing phrases that must still be present
    "isolate the power",
    "de-energize",
    "pull the breaker",
    "lockout tagout",
    "arc flash",
]

@pytest.mark.parametrize("phrase", _REQUIRED_ISOLATION_PHRASES)
def test_isolation_phrase_in_keyword_list(phrase):
    """Required power isolation phrases must exist in SAFETY_KEYWORDS."""
    assert phrase in SAFETY_KEYWORDS, (
        f"Required phrase '{phrase}' missing from SAFETY_KEYWORDS"
    )


# ── Contextual phrases from forensic session ──────────────────────────────────

def test_forensic_session_phrase_fires():
    """The exact phrase that failed in the 2026-04-14 forensic session triggers safety."""
    assert classify_intent("which cable to pull to isolate power to this block") == "safety"


def test_isolation_phrasing_variant():
    assert classify_intent("I need to disconnect the power to this panel") == "safety"


def test_cut_power_fires():
    assert classify_intent("How do I cut power to the conveyor?") == "safety"


# ── Mixed signal: safety keyword + industrial content ─────────────────────────

def test_safety_wins_over_industrial():
    """Safety must short-circuit even when industrial keywords are also present."""
    msg = "The VFD shows E.OC.3 fault and there is exposed wire near the panel"
    assert classify_intent(msg) == "safety"


def test_safety_wins_over_greeting():
    """Safety must fire even in a message that starts like a greeting."""
    msg = "Hey MIRA there is arc flash hazard on the MCC"
    assert classify_intent(msg) == "safety"


# ── No false positives for common industrial words ────────────────────────────

_SAFE_INDUSTRIAL_MESSAGES = [
    "The motor tripped on overcurrent",
    "VFD shows fault code E.OC.3",
    "Check the pressure sensor reading",
    "Replace the worn bearing on pump 3",
    "Upload the nameplate photo",
    "Reset the PLC program",
]

@pytest.mark.parametrize("msg", _SAFE_INDUSTRIAL_MESSAGES)
def test_no_false_positive_safety(msg):
    """Common industrial messages must NOT falsely trigger safety escalation."""
    result = classify_intent(msg)
    assert result != "safety", (
        f"False positive: '{msg}' classified as 'safety'"
    )


# ── Hot work coverage (OSHA 1910.252) — added #1834 ───────────────────────────

def test_hot_work_report_fires():
    """A hot-work hazard report must escalate (closes the OSHA 1910.252 gap)."""
    assert classify_intent("we're doing hot work near the glycol tank") == "safety"


def test_hot_work_educational_bypasses():
    """'what is a hot work permit' is a concept question, not an active hazard."""
    assert classify_intent("what is a hot work permit") != "safety"


# ── Offline-eval floor lock (#1834) ───────────────────────────────────────────
# The deterministic detector is the airtight safety floor. The flaky SAFETY_ALERT
# observed on lenze_thermal_30 / vfd_abb_03_acs355_cross_load in the offline eval
# comes from the *LLM router* (conversation_router.safety_concern), NOT from
# classify_intent — these fixtures contain NO safety keyword. This test pins that
# invariant: if a future keyword addition starts matching one of these routine
# thermal/overload/ground-fault diagnostic turns, the deterministic detector has
# regressed into over-escalation and this test fails loudly.
#
# Turns copied verbatim from tests/eval/fixtures/{30_lenze_thermal,
# vfd_abb_03_acs355_cross_load,14_gs3_ground_fault}.yaml (all safety_expected: false).
_ROUTINE_DIAGNOSTIC_TURNS = [
    # lenze_thermal_30
    "Lenze i550 drive keeps shutting down on overtemperature",
    "Panel fan is running, ambient is about 85F",
    "Running at 75% load, 5HP motor",
    # vfd_abb_03_acs355_cross_load
    "ABB ACS355 showing motor overload fault, 7.5kW motor on a compressor",
    "460V, fault code A2013, ambient is about 40°C",
    "Motor is rated within drive spec, been running about a year",
    # 14_gs3_ground_fault
    "GF fault on GS3, happens intermittently",
    "Motor is 10 years old, 3HP, outdoor installation",
    "Cable run is about 200 feet, no conduit for the last 50 feet",
    "Haven't meggered it yet",
]


@pytest.mark.parametrize("msg", _ROUTINE_DIAGNOSTIC_TURNS)
def test_routine_diagnostic_turns_not_safety(msg):
    """Routine thermal/overload/ground-fault turns must NOT classify as 'safety'.

    Locks the deterministic floor against over-escalation. The eval's flaky
    SAFETY_ALERT on these fixtures is an LLM-router artifact, not a keyword bug.
    """
    assert classify_intent(msg) != "safety", (
        f"Over-escalation regression: routine diagnostic turn '{msg}' "
        f"classified as 'safety'"
    )
