"""Post-LLM citation compliance check for MIRA RAG responses (CRA-11 / Unit 2).

This module is intentionally small and dependency-free so it can be imported
by both the engine and offline tests without dragging in psycopg2, sqlalchemy,
or the rest of the bot stack.

The check is **observational only** — it never blocks a response. It writes
a structured log line so we can track citation-compliance rate over time and
feed the 90-day MVP success metric (≥9/10 technical replies cite a source).
"""

from __future__ import annotations

import logging
import re

from .workers.rag_worker import CITATION_TAG_RE

logger = logging.getLogger("mira-gsd")


# Phrases that mean "this answer is technical and a citation is owed".
# Kept conservative so we don't warn on greetings, clarifying questions, or
# short reflective turns.
_TECHNICAL_REPLY_RE = re.compile(
    r"(parameter|fault code|set\s+to\s+\d|torque|current\s*limit|voltage|"
    r"frequency|\d+\s*(?:hz|v|kv|a|ma|rpm|°c|°f|psi|nm|kw|w)|"
    r"replace|wiring|terminal|relay|breaker|contactor|overload|"
    r"check\s+(?:the|wiring|fuse|voltage|continuity)|measure|verify|"
    r"reset|de-energize|lockout)",
    re.IGNORECASE,
)

_TECHNICAL_FSM_STATES = frozenset({"DIAGNOSIS", "FIX_STEP"})


def check_citation_compliance(
    reply: str,
    kb_status: dict | None,
    *,
    fsm_state: str = "",
    chat_id: str = "",
) -> dict:
    """Inspect a final LLM reply for inline ``[Source: ...]`` citations.

    Citation is *required* when:
      * the KB returned chunks (``kb_status['status']`` is ``covered`` or
        ``partial``) — meaning the LLM had docs to cite, AND
      * the reply contains technical advice (parameter values, fault codes,
        wiring instructions, electrical specs, action verbs like
        "replace/measure/reset"), OR the FSM is in a diagnostic state where
        every reply should be grounded.

    The check NEVER blocks the response — it only emits a structured log line.

    Returns a dict suitable for telemetry::

        {
            "required":  bool,
            "present":   bool,
            "tag_count": int,
            "kb_status": str,
        }
    """
    status = (kb_status or {}).get("status", "unknown")
    technical_state = fsm_state in _TECHNICAL_FSM_STATES
    technical_reply = bool(_TECHNICAL_REPLY_RE.search(reply or ""))
    required = status in ("covered", "partial") and (technical_state or technical_reply)

    tags = CITATION_TAG_RE.findall(reply or "")
    present = bool(tags)
    result = {
        "required": required,
        "present": present,
        "tag_count": len(tags),
        "kb_status": status,
    }

    if required and not present:
        logger.warning(
            "CITATION_COMPLIANCE_MISS chat_id=%s kb_status=%s fsm=%s "
            "reply_len=%d — technical reply without [Source:] tag",
            chat_id,
            status,
            fsm_state,
            len(reply or ""),
        )
    elif required and present:
        logger.info(
            "CITATION_COMPLIANCE_OK chat_id=%s kb_status=%s fsm=%s tags=%d",
            chat_id,
            status,
            fsm_state,
            len(tags),
        )
    return result
