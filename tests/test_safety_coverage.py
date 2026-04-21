"""Safety keyword coverage tests.

Verifies every SAFETY_KEYWORD triggers classify_intent('safety'), that educational
framing bypasses it correctly, and that new power-isolation phrases from BUG-FORENSIC-003
are present and firing.
"""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

import pytest

from shared.guardrails import SAFETY_KEYWORDS, classify_intent, strip_mentions, _EDUCATIONAL_QUESTION_RE

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
