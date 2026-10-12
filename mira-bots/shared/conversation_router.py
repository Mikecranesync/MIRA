"""
Conversation Router — replaces keyword-based intent classification with LLM-based intent
understanding. At each turn asks: "Given this history and message, what does the user want
RIGHT NOW?" Returns one of the defined intents.
"""

from __future__ import annotations

import json
import logging

from .inference.router import InferenceRouter

logger = logging.getLogger("mira-gsd")

INTENTS = [
    "diagnose_equipment",  # User is describing a fault, asking for troubleshooting help
    "find_documentation",  # User wants to FETCH a manual, datasheet, or wiring diagram
    "store_documentation",  # User wants to FILE this turn's photo/extraction under a named plant/equipment
    "answer_question",  # Procedural how-to question — answer from knowledge, no doc fetch needed
    "log_work_order",  # User wants to create/log a work order in the CMMS
    "check_equipment_history",  # User asking what happened with this asset before
    "switch_asset",  # User wants to talk about a different machine
    "general_question",  # General industrial knowledge question, not tied to a specific fault
    "schedule_maintenance",  # User wants to schedule a PM or follow-up
    "safety_concern",  # User mentions live work, energized, or dangerous situation
    "continue_current",  # User is clearly continuing whatever flow is active
    "clarify_intent",  # Ambiguous — ask the user what they need
    "greeting_or_chitchat",  # "hey", "thanks", "how are you" — acknowledge and offer help
]

ROUTER_SYSTEM_PROMPT = """You are the MIRA conversation router. Your job is to classify the user's CURRENT intent from their latest message, given the conversation history.

Return ONLY a JSON object with these fields:
{
  "intent": "<one of the intent labels>",
  "confidence": <float 0.0-1.0>,
  "reasoning": "<one sentence explaining why>"
}

Intent labels:
- diagnose_equipment: user is describing a fault, symptom, error code, asking for troubleshooting, OR asking about the state/status of a specific machine ("what is the current state of the conveyor?", "is the pump running?", "why is the line stopped?") — a state question about a named asset is diagnosis, even with no fault mentioned
- find_documentation: user wants a manual, datasheet, wiring diagram, installation guide, setup steps, commissioning procedure
- store_documentation: user wants MIRA to FILE the current turn's photo, schematic, or extraction under a named plant or equipment ("add this to documentation for plant A", "save this to chiller-7", "document this for line 3", "store this for boiler-2")
- log_work_order: user wants to create, log, or file a work order or maintenance record
- check_equipment_history: user is asking what happened before with this asset, past work orders, previous fixes
- switch_asset: user is changing topic to a different machine or equipment ("now help me with the pump")
- general_question: general industrial knowledge not tied to a specific fault or asset ("what's a VFD?", "explain LOTO") — NEVER when the user names a specific machine or asks about its current state, even without a fault
- schedule_maintenance: user wants to schedule preventive maintenance, a follow-up check, or a PM task
- safety_concern: ANY mention of live work, energized equipment, skipping lockout, or dangerous situations — ALWAYS route here regardless of what else they said
- continue_current: user's message is clearly a direct answer to the last question MIRA asked (e.g., option selection "2", providing a measurement, answering yes/no)
- clarify_intent: message is ambiguous and you genuinely cannot determine what they want
- greeting_or_chitchat: greetings, thanks, or small talk — not a real task request

CRITICAL RULES:
1. safety_concern ALWAYS wins — if there's any safety signal, route there regardless of other content
2. continue_current should be the default when the user is mid-conversation and answering a question
3. If the diagnostic FSM is active (history shows MIRA asking diagnostic questions), prefer continue_current unless the user CLEARLY changed topic
4. Don't over-route to clarify_intent — make a decision, even if confidence is moderate
5. find_documentation covers: manual requests, datasheet lookups, wiring diagrams — the user explicitly wants to FETCH a document ("send me the manual", "do you have the datasheet", "show me the wiring diagram")
6. answer_question covers: procedural how-to questions the LLM can answer from knowledge — "how do I connect via Ethernet?", "what are the steps to configure the IP?", "give me quick steps to set parameter X" — user wants STEP-BY-STEP INSTRUCTIONS, not a document download
7. Any question referencing a specific asset, component, PLC tag, or live signal — including its state or status — is asset-specific: route to diagnose_equipment (or check_equipment_history for past events), NEVER general_question. MIRA must confirm the machine location before answering these."""


async def route_intent(
    user_message: str,
    conversation_history: list[dict],
    current_fsm_state: str = "IDLE",
    asset_identified: str = "",
    llm_client=None,
    session_id: str | None = None,
) -> dict:
    """Route the user's intent using a lightweight LLM call.

    `session_id` is the caller's own session identity (the engine's
    `str(chat_id)`, i.e. tenant_platform_chat), so the classification's token
    usage is attributed to the tenant and platform it served — not to a
    constant that the usage writer would read as a fictitious tenant
    (Codex r1 on #4359). The classification PURPOSE is the log line, not the
    session id.

    Returns: {"intent": str, "confidence": float, "reasoning": str}
    """
    recent_history = conversation_history[-6:] if conversation_history else []

    context = {
        "current_fsm_state": current_fsm_state,
        "asset_identified": asset_identified or "none",
        "conversation_turn": len(conversation_history),
    }

    messages = [
        {"role": "system", "content": ROUTER_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Context: {json.dumps(context)}\n\n"
                f"Recent conversation:\n{_format_history(recent_history)}\n\n"
                f'User\'s latest message: "{user_message}"\n\nClassify the intent:'
            ),
        },
    ]

    response = await _call_router_llm(messages, session_id=session_id)

    try:
        result = json.loads(response)
        if result.get("intent") not in INTENTS:
            result["intent"] = "continue_current"
        return result
    except (json.JSONDecodeError, KeyError):
        return {
            "intent": "continue_current",
            "confidence": 0.3,
            "reasoning": "Router parse failure — defaulting to continue",
        }


def _format_history(history: list[dict]) -> str:
    lines = []
    for msg in history:
        role = msg.get("role", "?").upper()
        content = str(msg.get("content", ""))[:200]
        lines.append(f"[{role}] {content}")
    return "\n".join(lines) if lines else "(no prior history)"


# One shared cascade for the whole process, built on first use so a test can
# install its own and so import never touches the environment.
_router: InferenceRouter | None = None


def _get_router() -> InferenceRouter:
    global _router
    if _router is None:
        _router = InferenceRouter()
    return _router


def reset_router_for_tests() -> None:
    global _router
    _router = None


# 300, not 150: gpt-oss reasoning length scales with input length, and this
# call carries conversation history — 150 produced truncated-JSON parse
# failures in the staging gate.
ROUTER_MAX_TOKENS = 300


def accounting_session_id(
    tenant_id: str | None, platform: str | None, chat_id: str | int | None
) -> str:
    """The usage-accounting identity for a classification: ``tenant_platform_chat``.

    `InferenceRouter.write_api_usage` splits its session id on the first two
    underscores into tenant, platform and the rest, so the id must be BUILT in
    that shape from the authenticated tenant and the surface — never taken
    from an FSM chat key, whose spelling is the surface's own (Ignition's is
    ``ignition:acme:press7``, which the writer would read as tenant
    ``ignition:acme:press7`` / platform ``unknown``; Codex r2 on #4359).
    A missing part is recorded as ``unknown``, never as a word that reads like
    a tenant. Pure.
    """
    tenant = (tenant_id or "").strip() or "unknown"
    surface = (platform or "").strip() or "unknown"
    chat = (str(chat_id) if chat_id is not None else "").strip() or "unknown"
    return f"{tenant}_{surface}_{chat}"


async def _call_router_llm(messages: list[dict], session_id: str | None = None) -> str:
    """Classify intent through the shared InferenceRouter cascade (OpenAI first).

    This used to POST straight to Groq with its own key check. With Groq
    billing-restricted that meant ROUTER_LLM_FAILURE on every turn and intent
    silently falling back to continue_current while the one provider that
    works was never tried — and the shared router's budget guard never saw
    the call. Now the cascade, its key gating, the gpt-5 request dialect and
    the spend guard are all the router's; this module only shapes the prompt.
    """
    router = _get_router()
    if not router.enabled:
        return json.dumps(
            {
                "intent": "continue_current",
                "confidence": 0.5,
                "reasoning": "No router LLM available — no cloud provider configured",
            }
        )

    # PII scrub before the message leaves this module (#1528 adversarial
    # triage). InferenceRouter.complete() sanitizes by default too; scrubbing
    # here as well keeps the guarantee local instead of resting on a default
    # argument elsewhere. sanitize_context is a pure, idempotent staticmethod.
    messages = InferenceRouter.sanitize_context(messages)

    # Bounded lane (Codex r1 on #4359): ROUTER_MAX_TOKENS is a HARD per-attempt
    # cap — no reasoning-burn retry at the router's 8,192-token headroom — and
    # the usage row carries the caller's session (tenant_platform_chat), not a
    # constant the writer would split into a fictitious tenant/platform.
    try:
        content, _usage = await router.complete(
            messages,
            max_tokens=ROUTER_MAX_TOKENS,
            session_id=session_id or "unknown_unknown_unknown",
            reasoning_retry=False,
        )
    except Exception as exc:
        logger.warning("ROUTER_LLM_FAILURE error=%s", str(exc)[:200])
        return json.dumps(
            {
                "intent": "continue_current",
                "confidence": 0.4,
                "reasoning": f"Router LLM error — {str(exc)[:80]}",
            }
        )
    if not content:
        # complete() returns "" when every provider failed; it already logged
        # each provider's failure, this line names the consequence.
        logger.warning("ROUTER_LLM_FAILURE error=every provider failed")
        return json.dumps(
            {
                "intent": "continue_current",
                "confidence": 0.4,
                "reasoning": "Router LLM error — every provider failed",
            }
        )
    return content
