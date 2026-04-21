"""
Conversation Router — replaces keyword-based intent classification with LLM-based intent
understanding. At each turn asks: "Given this history and message, what does the user want
RIGHT NOW?" Returns one of the defined intents.
"""
from __future__ import annotations

import json
import logging
import os

import httpx

logger = logging.getLogger("mira-gsd")

INTENTS = [
    "diagnose_equipment",       # User is describing a fault, asking for troubleshooting help
    "find_documentation",       # User wants a manual, datasheet, wiring diagram, installation guide
    "log_work_order",           # User wants to create/log a work order in the CMMS
    "check_equipment_history",  # User asking what happened with this asset before
    "switch_asset",             # User wants to talk about a different machine
    "general_question",         # General industrial knowledge question, not tied to a specific fault
    "schedule_maintenance",     # User wants to schedule a PM or follow-up
    "safety_concern",           # User mentions live work, energized, or dangerous situation
    "continue_current",         # User is clearly continuing whatever flow is active
    "clarify_intent",           # Ambiguous — ask the user what they need
    "greeting_or_chitchat",     # "hey", "thanks", "how are you" — acknowledge and offer help
]

ROUTER_SYSTEM_PROMPT = """You are the MIRA conversation router. Your job is to classify the user's CURRENT intent from their latest message, given the conversation history.

Return ONLY a JSON object with these fields:
{
  "intent": "<one of the intent labels>",
  "confidence": <float 0.0-1.0>,
  "reasoning": "<one sentence explaining why>"
}

Intent labels:
- diagnose_equipment: user is describing a fault, symptom, error code, or asking for troubleshooting
- find_documentation: user wants a manual, datasheet, wiring diagram, installation guide, setup steps, commissioning procedure
- log_work_order: user wants to create, log, or file a work order or maintenance record
- check_equipment_history: user is asking what happened before with this asset, past work orders, previous fixes
- switch_asset: user is changing topic to a different machine or equipment ("now help me with the pump")
- general_question: general industrial knowledge not tied to a specific fault or asset ("what's a VFD?", "explain LOTO")
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
5. find_documentation covers: manual requests, "how to install", "wiring steps", "what are the specs", setup guides"""


async def route_intent(
    user_message: str,
    conversation_history: list[dict],
    current_fsm_state: str = "IDLE",
    asset_identified: str = "",
    llm_client=None,
) -> dict:
    """Route the user's intent using a lightweight LLM call.

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

    response = await _call_router_llm(messages)

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


async def _call_router_llm(messages: list[dict]) -> str:
    """Call Groq llama-3.1-8b-instant for routing — fast and cheap (~200ms)."""
    groq_key = os.getenv("GROQ_API_KEY", "")
    if not groq_key:
        return json.dumps({
            "intent": "continue_current",
            "confidence": 0.5,
            "reasoning": "No router LLM available — GROQ_API_KEY not set",
        })

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {groq_key}"},
                json={
                    "model": "llama-3.1-8b-instant",
                    "messages": messages,
                    "temperature": 0.1,
                    "max_tokens": 150,
                },
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]
    except Exception as exc:
        logger.warning("ROUTER_LLM_FAILURE error=%s", str(exc)[:200])
        return json.dumps({
            "intent": "continue_current",
            "confidence": 0.4,
            "reasoning": f"Router LLM error — {str(exc)[:80]}",
        })
