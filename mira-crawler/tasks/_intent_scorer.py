"""Intent scoring helper — single Groq call, fail-open.

Scores Reddit posts / YouTube comments for buying intent on a 0-100 scale.
Used by ``tasks.reddit_intent`` and ``tasks.youtube_intent``.

Backend: Groq ``llama-3.1-8b-instant`` (free tier, OpenAI-compatible).
No cascade fallback here — intent scoring is best-effort and skips on failure;
the cascade lives in the diagnostic engine path, not in low-priority crawl
enrichment. Logged misses surface in worker logs.

Returns ``(score, category, suggested_reply)`` — ``(0, "", "")`` on any error.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Optional

import httpx

logger = logging.getLogger("mira-crawler.tasks._intent_scorer")

_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
_GROQ_MODEL = os.getenv("INTENT_SCORER_MODEL", "llama-3.1-8b-instant")
_TIMEOUT = float(os.getenv("INTENT_SCORER_TIMEOUT_S", "20"))

VALID_CATEGORIES = {
    "cmms_search",
    "pain_signal",
    "competitor_mention",
    "technical_help",
    "other",
}

_SYSTEM_PROMPT = """You score industrial-maintenance social posts for buying intent.

Output ONLY a JSON object with exactly these keys:
  score: integer 0-100 (how likely this author is in-market for a maintenance/CMMS solution)
  category: one of cmms_search | pain_signal | competitor_mention | technical_help | other
  suggested_reply: <=240 chars, written as Mike Harper — 15-year PLC + maintenance vet
                   who built MIRA. Casual, helpful, no marketing language, no emojis,
                   no signature. Ends with a question OR an offer to DM. Empty string
                   if no useful reply.

Scoring rubric:
  90-100: explicit "looking for", "recommend X", "evaluating", "switching from Y"
  70-89:  describes acute pain ("paper work orders are killing us")
  50-69:  technical fault question we can help with (PLC fault, alarm, VFD)
  30-49:  general industrial discussion, low buying signal
  0-29:   off-topic / hobbyist / sarcasm

No prose. No markdown fences. JSON only."""


def _extract_json(text: str) -> Optional[dict]:
    """Best-effort JSON extraction from an LLM response."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Fallback: find first { ... } block
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            return None
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return None


def score_intent(title: str, content: str, source_hint: str = "") -> tuple[int, str, str]:
    """Score a post/comment for buying intent.

    Args:
        title: Post title or empty string (comments have no title).
        content: Body text.
        source_hint: e.g. ``"reddit r/PLC"`` or ``"youtube video <id>"`` — included in prompt.

    Returns:
        ``(score, category, suggested_reply)`` — ``(0, "", "")`` on any failure.
    """
    api_key = os.environ.get("GROQ_API_KEY", "")
    if not api_key:
        logger.warning("GROQ_API_KEY not set — intent scorer disabled")
        return (0, "", "")

    snippet = (content or "").strip()[:1500]
    if not snippet and not title:
        return (0, "", "")

    user_msg = (
        f"Source: {source_hint}\n"
        f"Title: {title or '(no title)'}\n"
        f"Body: {snippet}\n\n"
        "Return JSON only."
    )

    try:
        resp = httpx.post(
            _GROQ_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": _GROQ_MODEL,
                "messages": [
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                "temperature": 0.2,
                "max_tokens": 400,
                "response_format": {"type": "json_object"},
            },
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("intent scorer HTTP error: %s", exc)
        return (0, "", "")

    try:
        data = resp.json()
        raw = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, ValueError) as exc:
        logger.warning("intent scorer response shape error: %s", exc)
        return (0, "", "")

    parsed = _extract_json(raw)
    if not parsed:
        logger.warning("intent scorer could not parse JSON: %s", raw[:200])
        return (0, "", "")

    try:
        score = int(parsed.get("score", 0))
    except (TypeError, ValueError):
        score = 0
    score = max(0, min(100, score))

    category = str(parsed.get("category", "other")).strip().lower()
    if category not in VALID_CATEGORIES:
        category = "other"

    suggested_reply = str(parsed.get("suggested_reply", "")).strip()[:500]

    return (score, category, suggested_reply)
