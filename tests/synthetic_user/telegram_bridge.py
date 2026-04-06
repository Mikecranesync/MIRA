"""Telegram bridge for synthetic user testing.

Connects the synthetic question generator to the real Telegram bot via Telethon,
enabling end-to-end testing through the full adapter stack. Handles multi-turn
GSD conversations by answering bot follow-up questions from SyntheticQuestion
metadata — no LLM needed for the simulated user side.

Prerequisites:
    - Telethon session file (run session_setup.py once interactively)
    - Env vars: TELEGRAM_TEST_API_ID, TELEGRAM_TEST_API_HASH,
      TELEGRAM_TEST_SESSION_PATH
    - @MIRABot running (mira-bot-telegram container on Charlie)
"""

from __future__ import annotations

import logging
import random
import re
import time

from tests.synthetic_user.evaluator import QuestionResult
from tests.synthetic_user.question_bank import EQUIPMENT
from tests.synthetic_user.templates import SyntheticQuestion

logger = logging.getLogger("mira-telegram-bridge")


# ---------------------------------------------------------------------------
# Follow-up answer generation (no LLM)
# ---------------------------------------------------------------------------

_FOLLOWUP_MAP: dict[str, callable] = {
    "equipment": lambda q: f"It's a {q.vendor} {q.equipment_type}",
    "model": lambda q: f"It's a {q.vendor} {q.equipment_type}",
    "fault": lambda q: q.fault_code or "no code displayed",
    "code": lambda q: q.fault_code or "no code displayed",
    "error": lambda q: q.fault_code or "no error code showing",
    "symptom": lambda q: _random_symptom(q),
    "happening": lambda q: _random_symptom(q),
    "seeing": lambda q: _random_symptom(q),
    "location": lambda q: f"Line {random.randint(1, 12)}, building A",
    "where": lambda q: f"Line {random.randint(1, 12)}, building A",
    "history": lambda q: "Started yesterday, ran fine before that",
    "when": lambda q: "It started yesterday during the first shift",
    "how long": lambda q: "About 24 hours now",
}


def _random_symptom(q: SyntheticQuestion) -> str:
    """Pick a symptom from the equipment bank, or fall back to the question text."""
    equip = EQUIPMENT.get(q.equipment_type, {})
    symptoms = equip.get("symptoms", [])
    if symptoms:
        return random.choice(symptoms)
    return f"The {q.equipment_type} isn't working properly"


def generate_followup(question: SyntheticQuestion, bot_reply: str) -> str:
    """Generate a contextual follow-up answer from question metadata.

    Scans the bot reply for trigger words and returns metadata-driven answers.
    Falls back to restating equipment type + original question.
    """
    reply_lower = bot_reply.lower()
    for trigger, gen in _FOLLOWUP_MAP.items():
        if trigger in reply_lower:
            return gen(question)
    # Fallback: restate the equipment + symptom
    return f"It's on the {question.equipment_type}. {question.text}"


def is_followup_question(reply: str) -> bool:
    """Detect whether the bot is asking a follow-up question vs giving a diagnosis."""
    if "?" not in reply:
        return False
    # Safety alerts are not follow-ups even if they contain "?"
    safety_terms = ("stop", "de-energize", "lockout", "loto", "do not proceed")
    reply_lower = reply.lower()
    if any(t in reply_lower for t in safety_terms):
        return False
    return True


# ---------------------------------------------------------------------------
# TelegramBridge
# ---------------------------------------------------------------------------


class TelegramBridge:
    """Bridges synthetic questions to @MIRABot via Telethon.

    Handles multi-turn GSD conversations: send question → if bot asks
    follow-up → answer from question metadata → repeat until diagnosis
    or max_turns.
    """

    def __init__(
        self,
        bot_username: str,
        max_turns: int = 4,
        timeout: int = 60,
    ) -> None:
        self.bot_username = bot_username
        self.max_turns = max_turns
        self.timeout = timeout
        self._client = None
        self._bot_entity = None

    async def _ensure_connected(self) -> None:
        """Lazily connect Telethon client and resolve bot entity."""
        if self._client is None:
            from mira_bots.telegram_test_runner.session import get_client

            self._client = await get_client()
            self._bot_entity = await self._client.get_entity(self.bot_username)

    async def _send_and_collect(
        self,
        text: str,
        image_path: str | None = None,
    ) -> str:
        """Send a message and collect the bot's reply using silence detection.

        Wraps the Telethon test runner's collect_reply pattern.
        """
        from mira_bots.telegram_test_runner.runner_async import collect_reply

        reply = await collect_reply(
            self._client,
            self._bot_entity,
            image_path,
            text,
            self.timeout,
        )
        return reply or ""

    async def run_conversation(
        self,
        question: SyntheticQuestion,
    ) -> QuestionResult:
        """Run a full multi-turn conversation for one synthetic question.

        Returns a QuestionResult with the full transcript captured.
        """
        await self._ensure_connected()
        t0 = time.monotonic()
        transcript: list[dict] = []

        # Determine if this is a photo question
        image_path: str | None = None
        if question.ground_truth and question.ground_truth.get("image"):
            image_path = question.ground_truth["image"]

        # Turn 1: send the synthetic question
        reply = await self._send_and_collect(question.text, image_path)
        t1 = time.monotonic()

        transcript.append({
            "turn_number": 1,
            "role": "user",
            "text": question.text,
            "timestamp_ms": 0,
            "fsm_state": None,
            "sources": None,
        })
        transcript.append({
            "turn_number": 2,
            "role": "bot",
            "text": reply,
            "timestamp_ms": int((t1 - t0) * 1000),
            "fsm_state": None,
            "sources": None,
        })

        # Multi-turn loop: answer follow-up questions from metadata
        for turn_num in range(2, self.max_turns + 1):
            if not is_followup_question(reply):
                break  # Bot gave a diagnosis or safety alert, not a question

            followup = generate_followup(question, reply)
            t_send = time.monotonic()
            reply = await self._send_and_collect(followup)
            t_recv = time.monotonic()

            transcript.append({
                "turn_number": len(transcript) + 1,
                "role": "user",
                "text": followup,
                "timestamp_ms": int((t_send - t0) * 1000),
                "fsm_state": None,
                "sources": None,
            })
            transcript.append({
                "turn_number": len(transcript) + 1,
                "role": "bot",
                "text": reply,
                "timestamp_ms": int((t_recv - t0) * 1000),
                "fsm_state": None,
                "sources": None,
            })

        total_ms = int((time.monotonic() - t0) * 1000)

        # Infer confidence from reply content (same heuristic as bot path)
        confidence = _infer_confidence_from_reply(reply)

        return QuestionResult(
            question_id=question.id,
            question_text=question.text,
            persona_id=question.persona_id,
            topic_category=question.topic_category,
            adversarial_category=question.adversarial_category,
            equipment_type=question.equipment_type,
            vendor=question.vendor,
            expected_intent=question.expected_intent,
            expected_weakness=question.expected_weakness,
            ground_truth=question.ground_truth,
            path="telethon",
            reply=reply,
            confidence=confidence,
            next_state=None,  # FSM state not exposed via Telegram
            sources=None,
            latency_ms=total_ms,
            error=None,
            transcript=transcript,
        )


# ---------------------------------------------------------------------------
# Confidence inference (mirrors evaluator._HIGH_CONF / _LOW_CONF)
# ---------------------------------------------------------------------------

_HIGH_CONF = re.compile(
    r"(replace|fault code|check wiring|part number|disconnect|de-energize|lockout)",
    re.IGNORECASE,
)
_LOW_CONF = re.compile(
    r"(might be|could be|possibly|not sure|uncertain|hard to say)",
    re.IGNORECASE,
)


def _infer_confidence_from_reply(reply: str) -> str:
    """Infer confidence level from reply keywords."""
    has_high = bool(_HIGH_CONF.search(reply))
    has_low = bool(_LOW_CONF.search(reply))
    if has_high and not has_low:
        return "high"
    if has_low and not has_high:
        return "low"
    if has_high and has_low:
        return "medium"
    return "none"
