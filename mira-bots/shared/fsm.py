"""MIRA FSM — state machine constants, aliases, and transition logic.

Extracted from engine.py to be independently testable.
engine.py delegates state-transition work here.

Dependency direction: fsm ← guardrails (for SAFETY_KEYWORDS)
"""

from __future__ import annotations

import logging
import os

from .guardrails import SAFETY_KEYWORDS

logger = logging.getLogger("mira-gsd")

# Ordered diagnostic ladder — the happy path advances through these states
STATE_ORDER = ["IDLE", "Q1", "Q2", "Q3", "DIAGNOSIS", "FIX_STEP", "RESOLVED"]

ACTIVE_DIAGNOSTIC_STATES = frozenset({"Q1", "Q2", "Q3", "DIAGNOSIS", "FIX_STEP"})

HISTORY_LIMIT = int(os.getenv("MIRA_HISTORY_LIMIT", "20"))

PHOTO_MEMORY_TURNS = int(os.getenv("MIRA_PHOTO_MEMORY_TURNS", "10"))

_Q_STATES = frozenset({"Q1", "Q2", "Q3"})
_MAX_Q_ROUNDS = int(os.getenv("MIRA_MAX_Q_ROUNDS", "3"))

# All valid FSM states (used in transition validation)
VALID_STATES = frozenset(
    STATE_ORDER + ["ASSET_IDENTIFIED", "ELECTRICAL_PRINT", "SAFETY_ALERT", "DIAGNOSIS_REVISION"]
)

# Fuzzy-match common LLM-invented state names to valid FSM states
_STATE_ALIASES: dict[str, str] = {
    "DIAGNOSTICS": "DIAGNOSIS",
    "DIAGNOSTIC": "DIAGNOSIS",
    "DIAGNOSIS_SUMMARY": "DIAGNOSIS",
    "FAULT_ANALYSIS": "DIAGNOSIS",
    "ANALYZING": "DIAGNOSIS",
    "ANALYSIS": "DIAGNOSIS",
    "ROOT_CAUSE": "DIAGNOSIS",
    "TROUBLESHOOT": "Q1",
    "TROUBLESHOOTING": "Q1",
    "QUESTION": "Q1",
    "USER_QUERY": "Q1",
    "INQUIRY": "Q1",
    "NEED_MORE_INFO": "Q1",
    "NEED_INFO": "Q1",
    "PARAMETER_IDENTIFIED": "Q1",
    "READING_IDENTIFIED": "Q1",
    "INSTALLATION_GUIDANCE": "FIX_STEP",
    "INSTALLATION": "FIX_STEP",
    "WIRING_CHECK": "Q2",
    "CONFIGURATION": "Q2",
    "GATHERING_INFO": "Q2",
    "INSPECT": "Q2",
    "VERIFY": "Q2",
    "CHECK_OUTPUT_REACTOR": "Q2",
    "Q4": "Q3",
    "Q5": "Q3",
    "FIX": "FIX_STEP",
    "REPAIR": "FIX_STEP",
    "ACTION": "FIX_STEP",
    "CONFIG_STEP": "FIX_STEP",
    "PARAMETER_SETTINGS": "FIX_STEP",
    "IN_PROGRESS": "FIX_STEP",
    "SUMMARY": "RESOLVED",
    "COMPLETE": "RESOLVED",
    "DONE": "RESOLVED",
    "CLOSED": "RESOLVED",
    "DIAGNOSIS_REVISION": "DIAGNOSIS",
}

import re  # noqa: E402

# Patterns that indicate the user has already supplied fault/alarm specifics
_FAULT_INFO_RE = re.compile(
    r"""
    (?:[A-Z]{1,3}-?\d{3,})              # F30001, AL-14, E001
    | \b[A-Z]{2,3}\b(?=\s+fault)        # OC fault, OL fault (common VFD 2-letter codes)
    | \b(?:fault\s+code|alarm\s+(?:code|number)|error\s+code|fault\s+number)\b
    | \b(?:tripping\s+on|tripped\s+on|showing\s+(?:fault|error|alarm))\b
    | \b(?:displays?|shows?|reading)\s+[A-Z0-9]{2,}  # "shows OC", "displays F7"
    """,
    re.IGNORECASE | re.VERBOSE,
)


def advance_state(state: dict, parsed: dict) -> dict:
    """Advance FSM state based on parsed LLM response.

    Mutates and returns state dict.
    Caller is responsible for persisting the returned state.
    """
    current = state["state"]
    reply_lower = parsed.get("reply", "").lower()

    if (
        any(kw in reply_lower for kw in SAFETY_KEYWORDS)
        or parsed.get("next_state") == "SAFETY_ALERT"
    ):
        state["state"] = "SAFETY_ALERT"
        state["final_state"] = "SAFETY_ALERT"
        state["exchange_count"] += 1
        return state

    if current == "ELECTRICAL_PRINT":
        state["state"] = "ELECTRICAL_PRINT"
        state["exchange_count"] += 1
        return state

    if parsed.get("next_state"):
        proposed = _STATE_ALIASES.get(parsed["next_state"], parsed["next_state"])
        if proposed in VALID_STATES:
            state["state"] = proposed
        else:
            logger.warning(
                "Invalid FSM state '%s' from LLM (current: %s) — holding at %s",
                proposed,
                current,
                current,
            )
    else:
        if current == "ASSET_IDENTIFIED":
            state["state"] = "Q1"
        elif current == "DIAGNOSIS_REVISION":
            state["state"] = "DIAGNOSIS"
        elif current in STATE_ORDER:
            idx = STATE_ORDER.index(current)
            if idx + 1 < len(STATE_ORDER):
                state["state"] = STATE_ORDER[idx + 1]

    if state["state"] in ("RESOLVED", "SAFETY_ALERT"):
        state["final_state"] = state["state"]

    # Q-trap escape: if FSM has been in Q-states for _MAX_Q_ROUNDS consecutive
    # turns, force a commit to DIAGNOSIS so the technician gets an answer.
    ctx_q = state.get("context") or {}
    if state["state"] in _Q_STATES:
        ctx_q["q_rounds"] = ctx_q.get("q_rounds", 0) + 1
        if ctx_q["q_rounds"] >= _MAX_Q_ROUNDS:
            logger.info(
                "Q_TRAP_COMMIT chat_id=%s q_rounds=%d current=%s → DIAGNOSIS",
                state.get("chat_id", "?"),
                ctx_q["q_rounds"],
                state["state"],
            )
            state["state"] = "DIAGNOSIS"
            ctx_q["q_rounds"] = 0
    else:
        ctx_q.pop("q_rounds", None)
    state["context"] = ctx_q

    if not state.get("fault_category"):
        for cat in (
            "comms",
            "communication",
            "power",
            "electrical",
            "mechanical",
            "vibration",
            "thermal",
            "temperature",
            "hydraulic",
            "pressure",
        ):
            if cat in reply_lower:
                normalized = {
                    "communication": "comms",
                    "electrical": "power",
                    "vibration": "mechanical",
                    "temperature": "thermal",
                    "pressure": "hydraulic",
                }
                state["fault_category"] = normalized.get(cat, cat)
                break

    state["exchange_count"] += 1
    return state
