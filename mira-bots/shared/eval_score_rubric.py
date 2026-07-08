"""Auto-scorer rubric — the LLM-judge prompt + strict-JSON parser.

Lives here (importable, pure, no I/O) so both the Celery scorer
(``mira-crawler/tasks/eval_scorer.py``) and its unit tests can reuse it without
pulling in a provider or a DB. See ``docs/specs/bot-eval-loop-spec.md`` §
"Auto-scorer rubric" and ``.claude/plans/use-avail-skills-to-functional-wave.md``
(Phase 2).

The judge scores a bot reply 1-5 on five criteria, then an ``overall`` 1-5.
``overall`` is stored in ``conversation_eval.auto_score``; the per-criterion map
goes to ``auto_score_breakdown``.

**Provider:** the scorer calls ``InferenceRouter.complete()`` — cascade
Groq → Cerebras → Together. (The spec text says "Gemini"; that is stale —
Gemini was replaced by Together and Anthropic is banned, PRD §4 / PR #610.)
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional

# The five rubric criteria, in output order. Each is scored 1-5.
CRITERIA: tuple[str, ...] = (
    "answered_question",
    "no_hallucination",
    "no_redundant_questions",
    "cited_sources_when_claimed",
    "appropriate_tone",
)

_SCORE_MIN = 1
_SCORE_MAX = 5

SYSTEM_PROMPT = """You are a strict evaluator of a maintenance chatbot's reply to a technician.
Score the reply 1-5 on each criterion (1 = fails badly, 5 = excellent). Then give an
integer `overall` 1-5 and a 1-2 sentence `reasoning`. Return STRICT JSON only — no prose,
no markdown fences.

Criteria:
1. answered_question — Did the bot address what the user asked, or did it deflect / re-ask
   for information the user already provided?
2. no_hallucination — Are the technical claims supportable from general engineering knowledge
   or the cited KB? Penalize fabricated part numbers, fault codes, voltages.
3. no_redundant_questions — Did the bot avoid asking for manufacturer/model/code the user
   already typed this turn or earlier?
4. cited_sources_when_claimed — If the bot referenced a manual / KB chunk, was a citation present?
5. appropriate_tone — Crisp, technician-grade, no excessive hedging or sycophancy.

Output exactly this shape:
{
  "answered_question": 1-5,
  "no_hallucination": 1-5,
  "no_redundant_questions": 1-5,
  "cited_sources_when_claimed": 1-5,
  "appropriate_tone": 1-5,
  "overall": 1-5,
  "reasoning": "1-2 sentences"
}"""


def build_messages(
    *,
    user_message: str,
    bot_response: str,
    intent: Optional[str] = None,
    has_citations: bool = False,
) -> list[dict[str, str]]:
    """Build the chat messages for ``InferenceRouter.complete()``.

    The router sanitizes PII by default, so we pass the raw turn text — the
    rubric only needs the intent shape, not literal IPs/serials.
    """
    user = (
        f"intent: {intent or 'unknown'}\n"
        f"bot_claimed_citations: {str(bool(has_citations)).lower()}\n"
        f"--- USER MESSAGE ---\n{user_message}\n"
        f"--- BOT REPLY ---\n{bot_response}\n"
        "--- END ---\n"
        "Score the BOT REPLY. Return strict JSON only."
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]


def _extract_json(text: str) -> Optional[dict[str, Any]]:
    """Best-effort JSON extraction from an LLM response (fences / stray prose)."""
    text = (text or "").strip()
    if not text:
        return None
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        obj = json.loads(text)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            return None
        try:
            obj = json.loads(match.group(0))
            return obj if isinstance(obj, dict) else None
        except json.JSONDecodeError:
            return None


def _clamp_score(value: Any) -> Optional[int]:
    """Coerce a value to an int in [1, 5]; None if not a usable number."""
    try:
        n = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    return max(_SCORE_MIN, min(_SCORE_MAX, n))


def parse_score(raw: str) -> Optional[dict[str, Any]]:
    """Parse a judge response into a validated score dict, or None if unusable.

    Returns a dict with:
      - ``overall``: int 1-5
      - ``breakdown``: {criterion: int 1-5} for every criterion the model returned
        (missing criteria are omitted, not defaulted)
      - ``reasoning``: str (may be empty)

    ``overall`` falls back to the mean of the present criteria (rounded, clamped)
    when the model omits or garbles it — a row we can't score at all returns None.
    """
    parsed = _extract_json(raw)
    if parsed is None:
        return None

    breakdown: dict[str, int] = {}
    for crit in CRITERIA:
        clamped = _clamp_score(parsed.get(crit))
        if clamped is not None:
            breakdown[crit] = clamped

    overall = _clamp_score(parsed.get("overall"))
    if overall is None:
        if not breakdown:
            # Nothing usable at all.
            return None
        overall = _clamp_score(sum(breakdown.values()) / len(breakdown))
        if overall is None:  # pragma: no cover - mean of ints is always numeric
            return None

    reasoning = str(parsed.get("reasoning", "") or "").strip()
    return {"overall": overall, "breakdown": breakdown, "reasoning": reasoning}
