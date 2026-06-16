"""Dialogue Act Classifier — single Groq llama-3.1-8b call returning a typed
`DialogueTurn` (one of the 10 acts in `dialogue_state.py`).

This is the "lightweight LLM call to classify the dialogue act before routing"
referenced in PLAN.md §2.2. Mirrors `conversation_router.route_intent` for
provider/latency profile (same model, ~100-200ms, free tier) but speaks
*dialogue acts* instead of task intents — see PLAN.md §1 for why that
distinction matters.

Why raw httpx + manual JSON parsing instead of `instructor`:
* Honors the project's "no new deps" constraint (PLAN.md §9 fallback path).
* Groq's OpenAI-compatible endpoint emits JSON reliably with a brief
  schema-shaped system prompt; a single retry covers the rare malformed case.
* Keeps the classifier's failure profile identical to today's router — on
  any error we fall back to a keyword-based heuristic so process_full
  never raises.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Optional

import httpx

from .dialogue_state import (
    AnswerAct,
    AskQuestionAct,
    ConfirmAct,
    DenyAct,
    DialogueTurn,
    DontKnowAct,
    GreetAck,
    InformAct,
    MetaControlAct,
    PendingQuestion,
    RequestActionAct,
    SafetyAct,
    SalientEntities,
    turn_from_dict,
)

logger = logging.getLogger("mira-gsd")

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.1-8b-instant"
GROQ_TIMEOUT_S = 5.0
GROQ_MAX_TOKENS = 220


# Prompt anchors. Spelled out in plain language — the Groq 8b model handles
# the dialogue-act distinction far better with examples than with a schema
# alone. Matches the conventions Rasa CALM 2024 uses for command training.
_SYSTEM_PROMPT = """You are MIRA's dialogue-act classifier.

For the user's LATEST message, return exactly ONE JSON object describing
what move the user is making in this turn. Pick from these acts:

- "answer"          : user is responding to MIRA's pending question
- "inform"          : user volunteered information without being asked
- "request_action"  : user wants MIRA to DO something (create work order, find a manual, switch asset, schedule maintenance, check history, reset)
- "ask"             : user is asking a NEW question (not a topic continuation)
- "dont_know"       : user said "I don't know", "not sure", "no idea", etc.
- "confirm"         : user said yes / right / correct / that's it
- "deny"            : user said no / wrong / that's not it
- "meta"            : user said cancel / nevermind / start over / skip / back / stop
- "greet"           : user said hi / hello / thanks — pleasantries only
- "safety"          : user mentioned a SAFETY HAZARD — live work, energized equipment, smoke, sparking, exposed wires

Rules:
1. SAFETY always wins. Any hint of an active hazard → "safety".
2. If MIRA's last question is set and the user replied with a value, return
   "answer" with `slot_fill_value` populated. Never invent a value to fill
   a slot — if the user said "I don't know" or similar, return "dont_know".
3. If the user issued an imperative ("make a work order", "send me the
   manual", "switch to the pump", "reset", "start over"), return
   "request_action" with the matching `action`.
4. Always extract any equipment vendor / model / fault code mentioned in
   the message into `entities`. Do not hallucinate values that are not in
   the message.
5. Picking the wrong act is worse than low confidence — if you are unsure,
   prefer "inform" over "answer".

Return ONLY the JSON object, no commentary, no code fences. Example shapes:

{"act": "answer", "slot_fill_value": "F012", "entities": {"fault_code": "F012"}, "reasoning": "user gave the fault code"}
{"act": "request_action", "action": "log_work_order", "entities": {"asset_label": "air compressor #1"}, "reasoning": "user asked to make a WO"}
{"act": "dont_know", "reasoning": "user said they don't know"}
{"act": "ask", "question_kind": "procedural", "reasoning": "user asked how to do something"}
{"act": "meta", "command": "cancel", "reasoning": "user said nevermind"}
{"act": "safety", "hazard_summary": "live wire exposed", "reasoning": "user mentioned a hazard"}

Allowed `action` values: log_work_order, switch_asset, find_documentation, schedule_maintenance, check_equipment_history, reset.
Allowed `question_kind` values: procedural, general, definition, comparison.
Allowed `command` values: cancel, reset, skip, back, stop.
"""


# ---------------------------------------------------------------------------
# Regex backstops — fire BEFORE the LLM call as 0-cost short-circuits and
# AFTER it as a fallback when the LLM is unreachable. Same philosophy as
# guardrails.classify_intent today.
# ---------------------------------------------------------------------------

_RX_DONT_KNOW = re.compile(
    r"^\s*(?:i\s+don'?t\s+know|i\s+do\s+not\s+know|don'?t\s+know|dont\s+know"
    r"|not\s+sure|i'?m\s+not\s+sure|no\s+idea|i\s+have\s+no\s+(?:idea|clue)"
    r"|haven'?t\s+(?:a\s+)?clue|can'?t\s+(?:tell|say)|cannot\s+(?:tell|say)"
    r"|unsure|unclear|beats\s+me|who\s+knows)\b",
    re.IGNORECASE,
)

_RX_META = re.compile(
    r"^\s*(?:nevermind|never\s*mind|cancel|stop|skip|back|reset|start\s+over"
    r"|forget\s+it|drop\s+it|abort)\b",
    re.IGNORECASE,
)

_RX_GREETING = re.compile(
    r"^\s*(?:hi|hey|hello|howdy|yo|sup|gm|good\s+morning|good\s+afternoon"
    r"|good\s+evening|thanks|thank\s+you|thx|ty|ok|okay|cool)\s*[!.?]?\s*$",
    re.IGNORECASE,
)

_RX_CONFIRM = re.compile(
    r"^\s*(?:yes|yep|yeah|yup|correct|right|that'?s\s+(?:it|right|correct)"
    r"|sounds\s+good|sounds\s+right|sure|confirm|confirmed|exactly|affirmative)"
    r"\s*[!.?]?\s*$",
    re.IGNORECASE,
)

_RX_DENY = re.compile(
    r"^\s*(?:no|nope|nah|wrong|incorrect|not\s+(?:it|right|correct|that)"
    r"|negative)\s*[!.?]?\s*$",
    re.IGNORECASE,
)

_RX_WO_REQUEST = re.compile(
    r"\b(?:can\s+you\s+|please\s+|could\s+you\s+|would\s+you\s+)?"
    r"(?:make|create|log|file|open|submit|put\s+in|generate|raise|start"
    r"|need|want)\s+"
    r"(?:a\s+|an\s+|the\s+|me\s+a\s+|me\s+an\s+|me\s+the\s+|us\s+a\s+)?"
    r"(?:work\s*order|workorder|work[\s-]ticket|wo\b"
    r"|maintenance\s+(?:request|ticket|order)|repair\s+ticket"
    r"|service\s+(?:ticket|request|order))\b",
    re.IGNORECASE,
)

_RX_DOC_REQUEST = re.compile(
    r"\b(?:send|show|find|get|fetch|pull|grab|give|share)\s+"
    r"(?:me\s+|us\s+)?(?:the\s+|a\s+|an\s+)?"
    r"(?:manual|datasheet|wiring\s+diagram|schematic|spec\s*sheet"
    r"|installation\s+(?:guide|manual)|product\s+manual)",
    re.IGNORECASE,
)

# "add this to documentation for line 3", "save this to plant A",
# "document this for the chiller", "store this for boiler-2".
# Matches the imperative; the engine's handler parses the target name from
# the message and pulls the most-recent extraction off session state.
_RX_STORE_DOC = re.compile(
    r"\b(?:add|save|store|put|attach|file|log)\s+(?:this|that|it|these|them)?"
    r"\s*(?:to|in|into|for|under|against)\s+"
    r"(?:(?:the\s+)?(?:documentation|docs|kb|knowledge\s*(?:base|graph)|kg)\s+"
    r"(?:for|of|under|against)\s+)?"
    r"(?P<target>[\w][\w\s.\-/:#]{0,80}?)\s*[?.!]?\s*$"
    r"|\bdocument\s+(?:this|that|it)\s+(?:for|under|as)\s+"
    r"(?P<target2>[\w][\w\s.\-/:#]{0,80}?)\s*[?.!]?\s*$",
    re.IGNORECASE,
)

_RX_SWITCH_ASSET = re.compile(
    r"\b(?:switch\s+to|now\s+(?:talk\s+about|help\s+(?:me\s+)?with)|let'?s\s+talk\s+about"
    r"|change\s+(?:asset|equipment|machine|topic)\s+to|forget\s+(?:that|the\s+\w+)"
    r"|move\s+on\s+to)\b",
    re.IGNORECASE,
)

_RX_RESET = re.compile(
    r"^\s*(?:reset|/reset|start\s+over|fresh\s+start|new\s+session)\b",
    re.IGNORECASE,
)

_RX_QUESTION = re.compile(
    r"^\s*(?:how|what|why|when|where|who|can|do|does|is|are|will)\b", re.IGNORECASE
)


def _entities_from_message(message: str) -> SalientEntities:
    """Cheap regex extraction — used as a backstop when the LLM omits entities.

    Delegates to the UNS resolver, which already handles vendor + fault-code
    detection consistently (one source of truth across engine, workers, DST).
    """
    from .uns_resolver import resolve_uns_path  # local — avoid import cycle

    ctx = resolve_uns_path(message)
    return SalientEntities(
        vendor=ctx.manufacturer or None,
        fault_code=ctx.fault_code or None,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def classify_dialogue_act(
    user_message: str,
    pending_question: PendingQuestion,
    history: list[dict[str, str]],
    salient_entities: SalientEntities,
    fsm_state: str,
    *,
    api_key: Optional[str] = None,
) -> DialogueTurn:
    """Classify the user's latest message into a typed `DialogueTurn`.

    Order of resolution:
    1. Regex short-circuits for unambiguous moves (don't_know, meta, greet,
       confirm, deny, WO/doc requests). Saves an LLM call on ~30% of turns.
    2. Groq llama-3.1-8b call returning JSON.
    3. Single retry on JSON parse failure (the LLM almost always recovers).
    4. Fallback to a keyword-derived act if Groq is unreachable.

    NEVER raises — process_full callers can rely on this returning some
    DialogueTurn even if the network is on fire.
    """
    msg_stripped = (user_message or "").strip()

    # 1. Cheap-and-correct shortcircuits
    short_act = _shortcircuit_act(msg_stripped, pending_question)
    if short_act is not None:
        logger.debug("DIALOGUE_ACT_SHORTCIRCUIT act=%s msg=%r", short_act.act, msg_stripped[:80])
        return short_act

    # 2. LLM classification
    try:
        turn = await _classify_via_groq(
            msg_stripped, pending_question, history, salient_entities, fsm_state, api_key
        )
        if turn is not None:
            return turn
    except Exception as exc:  # noqa: BLE001 — bot must never raise
        logger.warning("DIALOGUE_ACT_LLM_FAILURE error=%s — using keyword fallback", str(exc)[:160])

    # 3. Final fallback — keyword classifier
    return _fallback_act(msg_stripped, pending_question)


async def _classify_via_groq(
    message: str,
    pending_question: PendingQuestion,
    history: list[dict[str, str]],
    salient_entities: SalientEntities,
    fsm_state: str,
    api_key: Optional[str],
) -> Optional[DialogueTurn]:
    """Single Groq call. Returns None if the response is unusable so the
    caller can fall through to the keyword fallback."""
    key = api_key if api_key is not None else os.getenv("GROQ_API_KEY", "")
    if not key:
        logger.debug("DIALOGUE_ACT_NO_KEY — GROQ_API_KEY not set, falling through")
        return None

    user_block = _format_user_block(message, pending_question, history, salient_entities, fsm_state)
    payload: dict[str, Any] = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_block},
        ],
        "temperature": 0.0,
        "max_tokens": GROQ_MAX_TOKENS,
        "response_format": {"type": "json_object"},
    }

    async with httpx.AsyncClient(timeout=GROQ_TIMEOUT_S) as client:
        for attempt in range(2):  # one retry
            resp = await client.post(
                GROQ_URL,
                headers={"Authorization": f"Bearer {key}"},
                json=payload,
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
            turn = _parse_classifier_response(content)
            if turn is not None:
                logger.info(
                    "DIALOGUE_ACT act=%s pending_slot=%s fsm=%s msg=%r",
                    turn.act,
                    pending_question.slot,
                    fsm_state,
                    message[:80],
                )
                return turn
            if attempt == 0:
                logger.debug("DIALOGUE_ACT_PARSE_RETRY response=%r", content[:200])

    return None


def _parse_classifier_response(content: str) -> Optional[DialogueTurn]:
    """Extract a `DialogueTurn` from the model's JSON response.

    Uses the same three-strategy approach as `response_formatter.parse_response`:
    1. Direct json.loads
    2. Strip markdown code fences then json.loads
    3. First {…} substring then json.loads
    """
    if not content:
        return None

    candidate_strs: list[str] = [content]

    # Strip ```json / ``` fences
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", content, re.DOTALL)
    if fenced:
        candidate_strs.append(fenced.group(1))

    # Substring between first '{' and last '}'
    first = content.find("{")
    last = content.rfind("}")
    if first != -1 and last > first:
        candidate_strs.append(content[first : last + 1])

    for s in candidate_strs:
        try:
            data = json.loads(s)
        except (json.JSONDecodeError, ValueError):
            continue
        turn = turn_from_dict(data)
        if turn is not None:
            return turn

    return None


def _format_user_block(
    message: str,
    pending_question: PendingQuestion,
    history: list[dict[str, str]],
    salient_entities: SalientEntities,
    fsm_state: str,
) -> str:
    pending_block = (
        f"MIRA's pending question (slot={pending_question.slot}): {pending_question.raw_text!r}"
        if pending_question.is_pending
        else "MIRA has no pending question — the user is starting a new turn."
    )
    options_block = (
        f"\nMIRA offered options: {pending_question.options}" if pending_question.options else ""
    )

    salient_block = f"Salient entities so far: {salient_entities.to_dict() or '(none)'}"

    history_block = _format_history(history)

    return (
        f"FSM state: {fsm_state}\n"
        f"{pending_block}{options_block}\n"
        f"{salient_block}\n\n"
        f"Recent conversation:\n{history_block}\n\n"
        f"User's latest message: {message!r}\n\n"
        f"Return one JSON object describing the user's dialogue act:"
    )


def _format_history(history: list[dict[str, str]]) -> str:
    if not history:
        return "(no prior history)"
    lines = []
    for msg in history[-6:]:
        role = msg.get("role", "?").upper()
        content = str(msg.get("content", ""))[:200]
        lines.append(f"[{role}] {content}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Cheap classifiers — used both as short-circuits and as final fallback.
# ---------------------------------------------------------------------------


def _shortcircuit_act(message: str, pending: PendingQuestion) -> Optional[DialogueTurn]:
    """Return a `DialogueTurn` for messages we can confidently classify
    without calling the LLM. Never returns `AnswerAct` — that requires
    LLM-grade entity extraction."""
    if not message:
        return None

    # Reset / meta — must precede greet (some users say "hi reset")
    if _RX_RESET.search(message):
        return MetaControlAct(command="reset", reasoning="reset keyword (shortcircuit)")
    if _RX_META.search(message):
        return MetaControlAct(command="cancel", reasoning="meta keyword (shortcircuit)")

    # Don't-know — only fires when MIRA was actually waiting for an answer.
    # Without a pending question, "I don't know" might be a topic statement
    # ("I don't know what's wrong"), and the LLM can decide.
    if pending.is_pending and len(message) <= 200 and _RX_DONT_KNOW.search(message):
        return DontKnowAct(reasoning="don't-know phrase with pending question (shortcircuit)")

    # Greetings — only when no pending question and short
    if not pending.is_pending and len(message) <= 40 and _RX_GREETING.fullmatch(message):
        return GreetAck(reasoning="greeting / pleasantry (shortcircuit)")

    # Yes/No — only when MIRA asked a yes/no slot. Otherwise let the LLM see
    # the surrounding sentence (a bare "yes" with no pending question is
    # ambiguous).
    if pending.is_pending and pending.slot in (
        "wo_confirmation",
        "fix_confirmation",
        "pm_acceptance",
    ):
        if _RX_CONFIRM.fullmatch(message):
            return ConfirmAct(reasoning="confirm with yes/no slot pending (shortcircuit)")
        if _RX_DENY.fullmatch(message):
            return DenyAct(reasoning="deny with yes/no slot pending (shortcircuit)")

    # Imperative WO request — strongest action signal we have. The Stage 0
    # regex in engine.py is intentionally identical so the two short-circuits
    # converge on the same behaviour with or without the DST flag.
    if _RX_WO_REQUEST.search(message):
        return RequestActionAct(
            action="log_work_order",
            entities=_entities_from_message(message),
            reasoning="WO request keyword (shortcircuit)",
        )

    if _RX_DOC_REQUEST.search(message):
        return RequestActionAct(
            action="find_documentation",
            entities=_entities_from_message(message),
            reasoning="doc-request keyword (shortcircuit)",
        )

    # "add this to documentation for plant A" — must come AFTER doc fetch so
    # "send me the manual for plant A" doesn't get rerouted to store.
    store_match = _RX_STORE_DOC.search(message)
    if store_match:
        target = (store_match.group("target") or store_match.group("target2") or "").strip()
        # The salient asset_label carries the parsed target downstream; the
        # store_documentation handler reads it off `entities.asset_label`.
        ents = _entities_from_message(message)
        if target:
            ents = SalientEntities(
                vendor=ents.vendor,
                model=ents.model,
                fault_code=ents.fault_code,
                asset_label=target,
            )
        return RequestActionAct(
            action="store_documentation",
            entities=ents,
            reasoning="store-documentation keyword (shortcircuit)",
        )

    if _RX_SWITCH_ASSET.search(message):
        return RequestActionAct(
            action="switch_asset",
            entities=_entities_from_message(message),
            reasoning="switch-asset keyword (shortcircuit)",
        )

    return None


def _fallback_act(message: str, pending: PendingQuestion) -> DialogueTurn:
    """Last-resort classifier when the LLM is unreachable. Mirrors the
    keyword `classify_intent` semantics so behaviour is at worst as good as
    today's router-failure path."""
    short = _shortcircuit_act(message, pending)
    if short is not None:
        return short

    # Safety — keyword scan
    from .guardrails import classify_intent

    keyword = classify_intent(message)
    if keyword == "safety":
        return SafetyAct(
            hazard_summary=message[:200], reasoning="keyword classifier flagged safety"
        )

    if pending.is_pending:
        # Default mid-slot: treat as an answer with the raw message as the
        # candidate slot value. The downstream slot handler decides whether
        # the value is usable; an unusable value loops back to a clarifying
        # prompt rather than vanishing the message.
        return AnswerAct(
            slot_fill_value=message[:200],
            entities=_entities_from_message(message),
            reasoning="fallback: pending question, treating as answer",
        )

    if _RX_QUESTION.search(message):
        kind: Any = "procedural" if "how" in message.lower()[:8] else "general"
        return AskQuestionAct(
            question_kind=kind,
            entities=_entities_from_message(message),
            reasoning="fallback: looks like a question",
        )

    return InformAct(
        entities=_entities_from_message(message),
        reasoning="fallback: generic informational turn",
    )


__all__ = [
    "classify_dialogue_act",
    "_shortcircuit_act",
    "_fallback_act",
    "_parse_classifier_response",
    "_RX_STORE_DOC",
]
