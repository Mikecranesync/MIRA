"""Synthetic user agent — LLM playing an industrial maintenance technician.

Given a scenario seed (one sentence describing the situation), the synthetic user
responds naturally to MIRA's Socratic questions.  Uses InferenceRouter or direct
Groq/Claude API so no extra dependencies are needed.

Realism rules baked into the prompt (Karpathy synthetic-user pattern):
  - Sometimes you don't know the answer — say so honestly ("not sure tbh")
  - Sometimes you give incomplete info and force MIRA to dig
  - Sometimes you change topic mid-conversation ("actually wait—")
  - Sometimes you ask for the manual mid-diagnosis
  - Sometimes you say "skip" or "never mind, back to the main issue"
  - Sometimes you go silent / one-word reply ("yeah", "no", "ok")
  - Shop-floor vocabulary — no engineering precision unless you happen to know it

Usage
-----
    from tests.eval.synthetic_user import SyntheticUser

    user = SyntheticUser("Yaskawa V1000 throwing OC fault, tried resetting")
    response = await user.respond("What does the display show right now?")
    print(response)

    # Full conversation loop:
    transcript = await run_synthetic_conversation(pipeline, scenario_seed, max_turns=8)
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
from pathlib import Path

logger = logging.getLogger("mira-synthetic-user")

# ── Path bootstrap ────────────────────────────────────────────────────────────

_REPO_ROOT = Path(__file__).parent.parent.parent
_MIRA_BOTS = _REPO_ROOT / "mira-bots"
if str(_MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(_MIRA_BOTS))

# ── System prompt ─────────────────────────────────────────────────────────────

_TECHNICIAN_SYSTEM = """\
You are playing the role of an industrial maintenance technician on a factory floor.
You are talking to MIRA, an AI diagnostic assistant, about a real equipment problem.

YOUR CHARACTER:
- 10 years on the floor but no engineering degree — you know the machines, not the theory
- You use shop vocabulary: "the drive", "it faulted out", "tripped the breaker", "making a noise"
- You're busy and slightly stressed — short replies unless something genuinely surprises you
- You have a smartphone so you can take photos, but you're not always near the machine

REALISM RULES (apply randomly, not every turn):
1. Sometimes you don't know the answer. Say: "honestly not sure", "no idea", "haven't checked that"
2. Sometimes give incomplete info first ("yeah it's tripping") then add detail only when pushed
3. Sometimes a one-word reply: "yeah", "nope", "2", "checked it"
4. Sometimes ask MIRA a question back: "wait what does that mean?", "is that the same as X?"
5. Sometimes change topic or add a new symptom: "actually now that I think about it, it also—"
6. Sometimes ask for the manual: "can you just find me the manual for this?"
7. Sometimes try to skip: "can we just get to the fix?" or "back to the main issue"
8. NEVER use engineering jargon you wouldn't realistically know
9. Keep replies under 40 words unless you're describing something specific you're looking at

SCENARIO CONTEXT:
{scenario}

CONVERSATION HISTORY:
{history}

MIRA's latest message to you:
{mira_message}

YOUR RESPONSE (1-3 sentences max, realistic shop-floor tone):"""

_OPENER_SYSTEM = """\
You are an industrial maintenance technician. Write a realistic first message to an AI
diagnostic assistant about the following equipment problem. Use shop-floor vocabulary,
be brief (1-2 sentences), don't be perfectly precise — give just enough to start a conversation.

Problem:
{scenario}

Your opening message (20-50 words):"""


# ── SyntheticUser ─────────────────────────────────────────────────────────────


class SyntheticUser:
    """LLM-backed technician that responds to MIRA's questions.

    Parameters
    ----------
    scenario_seed:
        One sentence describing the equipment problem (e.g. "Yaskawa V1000
        throwing OC fault, resetting doesn't help").
    provider:
        "auto" selects the first available key (Groq → Claude → Gemini).
        Pass "groq" or "claude" to force a specific provider.
    """

    def __init__(
        self,
        scenario_seed: str,
        provider: str = "auto",
    ) -> None:
        self.scenario_seed = scenario_seed
        self._provider = provider
        self._history: list[dict[str, str]] = []  # {"role": "mira"|"user", "content": ...}
        self._opener_sent = False

    async def opening_message(self) -> str:
        """Generate the first message the technician sends to MIRA."""
        prompt = _OPENER_SYSTEM.format(scenario=self.scenario_seed)
        reply = await _llm_call(
            [{"role": "user", "content": prompt}],
            provider=self._provider,
            max_tokens=120,
        )
        self._opener_sent = True
        self._history.append({"role": "user", "content": reply})
        return reply

    async def respond(self, mira_message: str) -> str:
        """Respond to one MIRA message. Maintains conversation history."""
        self._history.append({"role": "mira", "content": mira_message})

        history_str = _format_history(self._history[:-1])  # exclude last mira msg
        prompt = _TECHNICIAN_SYSTEM.format(
            scenario=self.scenario_seed,
            history=history_str or "(this is the start of the conversation)",
            mira_message=mira_message,
        )

        reply = await _llm_call(
            [{"role": "user", "content": prompt}],
            provider=self._provider,
            max_tokens=150,
        )
        self._history.append({"role": "user", "content": reply})
        return reply

    @property
    def history(self) -> list[dict[str, str]]:
        """Full conversation history as [{"role": ..., "content": ...}] list."""
        return list(self._history)


# ── Full conversation runner ───────────────────────────────────────────────────


async def run_synthetic_conversation(
    pipeline,  # LocalPipeline instance
    scenario_seed: str,
    max_turns: int = 8,
    chat_id: str | None = None,
    provider: str = "auto",
    verbose: bool = True,
) -> dict:
    """Run a complete synthetic conversation through the local pipeline.

    Returns a dict with:
      - transcript: list of {"role": "user"|"mira", "content": ..., "latency_ms": ...}
      - final_fsm_state: str
      - scenario: str
      - turns: int
    """
    import uuid

    if chat_id is None:
        chat_id = f"synthetic-{uuid.uuid4().hex[:8]}"

    user = SyntheticUser(scenario_seed, provider=provider)
    transcript: list[dict] = []

    # Opening message from the "technician"
    opening = await user.opening_message()
    if verbose:
        print(f"\n[Technician] {opening}")

    reply, status, latency = await pipeline.call(chat_id, opening)
    transcript.append({"role": "user", "content": opening, "latency_ms": 0})
    transcript.append({"role": "mira", "content": reply, "latency_ms": latency, "http_status": status})

    if verbose:
        print(f"[MIRA] {reply[:300]}{'...' if len(reply) > 300 else ''}")

    # Dialogue loop
    for turn_n in range(1, max_turns):
        if not reply or status >= 500:
            logger.warning("Pipeline returned error on turn %d — stopping", turn_n)
            break

        # Synthetic user responds to MIRA
        user_reply = await user.respond(reply)
        if verbose:
            print(f"\n[Technician] {user_reply}")

        reply, status, latency = await pipeline.call(chat_id, user_reply)
        transcript.append({"role": "user", "content": user_reply, "latency_ms": 0})
        transcript.append({"role": "mira", "content": reply, "latency_ms": latency, "http_status": status})

        if verbose:
            print(f"[MIRA] {reply[:300]}{'...' if len(reply) > 300 else ''}")

        # Stop when FSM reaches a terminal state, not on keyword sniff
        fsm_state = pipeline.fsm_state(chat_id)
        if fsm_state in ("RESOLVED", "SAFETY_ALERT"):
            if verbose:
                print(f"[synthetic_user] FSM reached {fsm_state} — stopping.")
            break

    fsm_state = pipeline.fsm_state(chat_id)

    return {
        "transcript": transcript,
        "final_fsm_state": fsm_state,
        "scenario": scenario_seed,
        "turns": len([t for t in transcript if t["role"] == "user"]),
        "chat_id": chat_id,
    }


# ── LLM call helpers ──────────────────────────────────────────────────────────

_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
_CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions"


async def _llm_call(
    messages: list[dict],
    provider: str = "auto",
    max_tokens: int = 150,
) -> str:
    """Call an LLM provider and return the text response."""
    import httpx

    if provider == "auto":
        provider = _pick_provider()

    t0 = time.monotonic()
    try:
        if provider == "groq":
            result = await _call_groq(messages, max_tokens)
        elif provider == "cerebras":
            result = await _call_cerebras(messages, max_tokens)
        elif provider == "gemini":
            result = await _call_gemini(messages, max_tokens)
        else:
            result = "I'm not sure, let me check."  # final fallback

        elapsed = int((time.monotonic() - t0) * 1000)
        logger.debug("synthetic_user LLM (%s) → %dms %d chars", provider, elapsed, len(result))
        return result.strip() or "Let me check."
    except Exception as exc:  # noqa: BLE001
        logger.warning("Synthetic user LLM error (%s): %s", provider, exc)
        return "Not sure, can you rephrase?"


def _pick_provider() -> str:
    """Return the first available provider: Groq → Cerebras → Gemini."""
    if os.getenv("GROQ_API_KEY"):
        return "groq"
    if os.getenv("CEREBRAS_API_KEY"):
        return "cerebras"
    if os.getenv("GEMINI_API_KEY"):
        return "gemini"
    return "fallback"


async def _call_groq(messages: list[dict], max_tokens: int) -> str:
    import httpx

    model = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            _GROQ_URL,
            headers={
                "Authorization": f"Bearer {os.getenv('GROQ_API_KEY', '')}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": 0.85,  # Slightly higher for realistic variation
            },
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


async def _call_cerebras(messages: list[dict], max_tokens: int) -> str:
    import httpx

    model = os.getenv("CEREBRAS_MODEL", "llama-3.3-70b")
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            _CEREBRAS_URL,
            headers={
                "Authorization": f"Bearer {os.getenv('CEREBRAS_API_KEY', '')}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": 0.85,
            },
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


async def _call_gemini(messages: list[dict], max_tokens: int) -> str:
    import httpx

    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    url = f"https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            url,
            headers={
                "Authorization": f"Bearer {os.getenv('GEMINI_API_KEY', '')}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": 0.85,
            },
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


# ── Formatting helper ─────────────────────────────────────────────────────────

def _format_history(history: list[dict[str, str]]) -> str:
    lines = []
    for entry in history[-12:]:  # Last 12 entries to keep prompt short
        role = "MIRA" if entry["role"] == "mira" else "You"
        lines.append(f"{role}: {entry['content']}")
    return "\n".join(lines)
