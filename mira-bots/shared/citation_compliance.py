"""Post-LLM citation compliance check and enforcement for MIRA RAG responses (CRA-11 / Unit 2).

This module is intentionally small and dependency-free so it can be imported
by both the engine and offline tests without dragging in psycopg2, sqlalchemy,
or the rest of the bot stack.

## Modes

**Observational (default — backward-compatible):**
    ``check_citation_compliance(reply, kb_status, ...)``
    Logs CITATION_COMPLIANCE_OK / _MISS. Never blocks. Returns a result dict.

**Enforce mode (Phase 7):**
    ``enforce_citation(reply, kb_status, router, message, state, ...)``
    1. Checks compliance (same logic as observational).
    2. If the reply fails AND KB had docs to cite → ONE second LLM pass via
       the existing cascade router, instructing the model to add ≥1 citation
       from the retrieved sources.
    3. If the rewrite still has no citation (or the LLM call fails) → returns
       a KB-gap admission: "I don't have verified evidence for X; want me to
       file a tech-knowledge request?"
    4. If the reply passes (already cited) → returns it unchanged; zero extra
       latency.

The rewrite prompt is kept small (<= 256 tokens from the original reply) to
minimise cascade cost. Uses InferenceRouter.complete() via the caller-supplied
``router`` argument — no new providers, no Anthropic.
"""

from __future__ import annotations

import logging
import re
from typing import TYPE_CHECKING, Optional

from .workers.rag_worker import CITATION_TAG_RE

if TYPE_CHECKING:
    from .inference.router import InferenceRouter

logger = logging.getLogger("mira-gsd")


# ---------------------------------------------------------------------------
# Observational helpers (unchanged from original)
# ---------------------------------------------------------------------------

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

# KB-gap admission template.  {topic} is filled from the first 60 chars of
# the user message; if not supplied, falls back to "this equipment".
_GAP_ADMISSION = (
    "I don't have verified evidence for {topic} in the knowledge base. "
    "Want me to file a tech-knowledge request so a specialist can add it?"
)

# Rewrite instruction injected as a system message in the second-pass call.
_REWRITE_SYSTEM = (
    "You are a MIRA technical writer. The following MIRA reply is correct but "
    "lacks inline citations. Rewrite it so that every technical claim is "
    "followed by a [Source: ...] tag copied verbatim from the source labels "
    "provided in the original system prompt. Do NOT invent new sources. "
    "Keep the reply concise and action-oriented. Output ONLY the revised reply."
)


def check_citation_compliance(
    reply: str,
    kb_status: Optional[dict],
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


# ---------------------------------------------------------------------------
# Phase 7 — enforce mode
# ---------------------------------------------------------------------------


async def enforce_citation(
    reply: str,
    kb_status: Optional[dict],
    router: "InferenceRouter",
    message: str,
    *,
    fsm_state: str = "",
    chat_id: str = "",
) -> tuple[str, str]:
    """Enforce citation compliance on a reply that may lack ``[Source:]`` tags.

    **Caller contract:**
    - Call this INSTEAD of ``check_citation_compliance`` in ``process_full`` /
      ``_handle_session_followup`` once enforcement is desired.
    - Returns ``(final_reply, citation_check_label)`` where
      ``citation_check_label`` is one of ``"pass"``, ``"rewritten"``,
      ``"admitted_gap"`` — the value written to ``decision_traces.citation_check``.

    **Latency contract:**
    - Most replies already cite → early-return with zero extra LLM calls.
    - Only uncited replies that required a citation trigger ONE rewrite call
      (max_tokens=512, short messages keep latency low).
    - If the rewrite still lacks a citation, or the LLM call errors, returns
      the KB-gap admission string — never raises, never blocks.

    **Does NOT modify:**
    - The retrieval logic, the FSM, the cascade router config, or the UNS gate.
    """
    result = check_citation_compliance(
        reply,
        kb_status,
        fsm_state=fsm_state,
        chat_id=chat_id,
    )

    # Fast path: citation present, or not required.
    if not result["required"] or result["present"]:
        return reply, "pass"

    # Slow path: citation required but missing — attempt ONE rewrite via router.
    topic = (message or "").strip()[:60] or "this equipment"
    logger.info(
        "CITATION_ENFORCE_REWRITE chat_id=%s fsm=%s — launching citation rewrite",
        chat_id,
        fsm_state,
    )

    try:
        rewrite_messages = [
            {"role": "system", "content": _REWRITE_SYSTEM},
            {
                "role": "user",
                "content": (f"Original reply (needs citation added):\n\n{reply[:1024]}"),
            },
        ]
        rewritten, _usage = await router.complete(
            rewrite_messages,
            max_tokens=512,
            session_id=f"{chat_id}_cite_rewrite",
        )
        if rewritten and CITATION_TAG_RE.search(rewritten):
            logger.info(
                "CITATION_ENFORCE_REWRITE_OK chat_id=%s fsm=%s",
                chat_id,
                fsm_state,
            )
            return rewritten.strip(), "rewritten"
        # Rewrite came back but still no citation tag — fall through to admission.
        logger.warning(
            "CITATION_ENFORCE_REWRITE_NO_TAG chat_id=%s fsm=%s — "
            "rewrite produced no citation; using gap admission",
            chat_id,
            fsm_state,
        )
    except Exception as exc:
        logger.warning(
            "CITATION_ENFORCE_REWRITE_FAIL chat_id=%s fsm=%s error=%s",
            chat_id,
            fsm_state,
            exc,
        )

    # Gap admission: tell the technician honestly we lack verified evidence.
    admission = _GAP_ADMISSION.format(topic=topic)
    logger.info(
        "CITATION_ENFORCE_ADMITTED_GAP chat_id=%s fsm=%s topic=%r",
        chat_id,
        fsm_state,
        topic,
    )
    return admission, "admitted_gap"
