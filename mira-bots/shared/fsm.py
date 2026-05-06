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

# Per-state loop guard: if the FSM stays in the same state for this many
# consecutive turns, force-advance to the next STATE_ORDER entry (or RESOLVED).
_MAX_TURNS_PER_STATE = int(os.getenv("MIRA_MAX_TURNS_PER_STATE", "6"))

# All valid FSM states (used in transition validation)
VALID_STATES = frozenset(
    STATE_ORDER
    + [
        "ASSET_IDENTIFIED",
        "ELECTRICAL_PRINT",
        "SAFETY_ALERT",
        "DIAGNOSIS_REVISION",
        "QUERY_UNDERSTANDING",
    ]
)

# Fuzzy-match common LLM-invented state names to valid FSM states
_STATE_ALIASES: dict[str, str] = {
    "CLARIFY_QUERY": "QUERY_UNDERSTANDING",
    "CLARIFICATION_NEEDED": "QUERY_UNDERSTANDING",
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
    "REPAIR_INQUIRY": "FIX_STEP",
    "ACTION": "FIX_STEP",
    "CONFIG_STEP": "FIX_STEP",
    "PARAMETER_SETTINGS": "FIX_STEP",
    "IN_PROGRESS": "FIX_STEP",
    "SUMMARY": "RESOLVED",
    "COMPLETE": "RESOLVED",
    "DONE": "RESOLVED",
    "CLOSED": "RESOLVED",
    "DIAGNOSIS_REVISION": "DIAGNOSIS",
    # LLM-invented states observed in corpus loop run (2026-04-28)
    "LISTEN": "Q1",
    "CONTINUE": "Q2",
    "INVESTIGATING": "Q2",
    "IDEA_GENERATION": "DIAGNOSIS",
    "ASSESS": "Q2",
    "CLARIFY": "Q1",
    "GATHER": "Q1",
    "ESCALATE": "SAFETY_ALERT",
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


def advance_state(state: dict, parsed: dict, user_message: str = "") -> dict:
    """Advance FSM state based on parsed LLM response.

    Mutates and returns state dict.
    Caller is responsible for persisting the returned state.

    ``user_message`` is the current turn's user input. It is optional for
    backwards compatibility but required for the CRA-8 Phase 2 Q1→Q2 hard
    promotion (history is appended *after* this function runs, so we need the
    current message passed in explicitly to detect asset+fault both-known.)
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

    ctx_q = state.get("context") or {}

    # CRA-8 Phase 2 — hard Q1 → Q2 promotion when asset+fault are both known.
    # Cluster C's Rule 9 reword + Example 8 in active.yaml is LLM-stochastic;
    # this rule guarantees the FSM moves past Q1 once the technician has named
    # both an asset AND a fault code/symptom. Bypasses the LLM's next_state
    # without touching any other transition. Spec §8 Risk 2 mitigation,
    # accepted as a default by Mike on 2026-05-06.
    #
    # Asset evidence comes from (in order):
    #   1. state["asset_identified"]
    #   2. context.dialogue.salient_entities.vendor / .model (DST, read-only)
    #   3. vendor name OR model token in the current user message (covers
    #      text-only fixtures where the engine never explicitly pins
    #      asset_identified, e.g. "It's a GS20" — GS20 is a model, not a vendor)
    # Fault evidence: _FAULT_INFO_RE matched in the current user message OR the
    # most recent user message in history (whichever has it first).
    if state["state"] == "Q1":
        # Search for asset evidence
        asset_evidence = state.get("asset_identified") or ""
        if not asset_evidence:
            dialogue_blob = ctx_q.get("dialogue") or {}
            ents = dialogue_blob.get("salient_entities") or {}
            asset_evidence = ents.get("vendor") or ents.get("model") or ""
        if not asset_evidence and user_message:
            from .guardrails import vendor_name_from_text  # local import: avoid cycle
            from .response_formatter import _looks_like_model_number  # noqa: PLC0415

            asset_evidence = (
                vendor_name_from_text(user_message) or _looks_like_model_number(user_message) or ""
            )
        # Search for fault evidence — current message first, then history fallback
        fault_msg = ""
        if user_message and _FAULT_INFO_RE.search(user_message):
            fault_msg = user_message
        else:
            for turn in reversed(ctx_q.get("history") or []):
                if turn.get("role") == "user":
                    text = str(turn.get("content") or "")
                    if text and _FAULT_INFO_RE.search(text):
                        fault_msg = text
                    break
        if asset_evidence and fault_msg:
            logger.info(
                "Q1_TO_Q2_FORCE chat_id=%s asset=%r fault=%r — bypassing LLM Q1",
                state.get("chat_id", "?"),
                asset_evidence,
                fault_msg[:120],
            )
            state["state"] = "Q2"

    # Q-trap escape: if FSM has been in Q-states for _MAX_Q_ROUNDS consecutive
    # turns, force a commit to DIAGNOSIS so the technician gets an answer.
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

    # Per-state loop guard: if the FSM stays in the same state for
    # _MAX_TURNS_PER_STATE consecutive turns, force-advance to break the loop.
    tracker = ctx_q.get("state_turns", {})
    if tracker.get("state") == state["state"]:
        tracker["count"] = tracker.get("count", 1) + 1
    else:
        tracker = {"state": state["state"], "count": 1}
    if tracker["count"] >= _MAX_TURNS_PER_STATE and state["state"] in STATE_ORDER:
        idx = STATE_ORDER.index(state["state"])
        forced = STATE_ORDER[idx + 1] if idx + 1 < len(STATE_ORDER) else "RESOLVED"
        logger.warning(
            "TURN_LOOP_ESCAPE chat_id=%s state=%s turns=%d → %s",
            state.get("chat_id", "?"),
            state["state"],
            tracker["count"],
            forced,
        )
        state["state"] = forced
        tracker = {"state": forced, "count": 1}
    ctx_q["state_turns"] = tracker

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
