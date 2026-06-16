from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Literal

logger = logging.getLogger("mira-gsd")


@dataclass
class QueryTriageResult:
    confidence: Literal["high", "medium", "low"]
    understood_query: str
    gaps: list[str] = field(default_factory=list)
    inferred_context: dict[str, str] = field(default_factory=dict)
    is_answerable_from_general_knowledge: bool = False
    reasoning: str = ""


_TRIAGE_PROMPT = """You are MIRA's query triage assistant. Classify query understanding.

Return ONLY valid JSON:
{"confidence":"high|medium|low","understood_query":"...","gaps":[],"inferred_context":{},"is_answerable_from_general_knowledge":true|false,"reasoning":"one line"}

CONFIDENCE:
- high: equipment+fault identifiable OR answerable from general engineering knowledge (no KB needed)
- medium: equipment type clear, model/vendor/code missing — enough to attempt retrieval
- low: genuinely ambiguous even with context, needs 1 clarifying question

GAPS (pick from): manufacturer, model_number, fault_code, operating_condition, equipment_type
IS_ANSWERABLE_FROM_GENERAL_KNOWLEDGE: true for "what causes cavitation", "how does a VFD work"
false for "what does fault F-201 mean on my GS20"
"""


class QueryTriageWorker:
    def __init__(self, router=None):
        self.router = router
        self.enabled = router is not None and getattr(router, "enabled", False)

    async def process(
        self, user_message: str, history: list[dict], asset: str = ""
    ) -> QueryTriageResult:
        if not self.enabled or self.router is None:
            return self._fail_open(user_message, "disabled")
        ctx = f"\nKnown equipment: {asset}" if asset else ""
        hist_text = (
            "\n".join(f"{m['role'].upper()}: {m.get('content', '')[:80]}" for m in history[-4:])
            or "(none)"
        )
        user_prompt = f"Message: {user_message}\nHistory:\n{hist_text}{ctx}"
        try:
            text, _ = await asyncio.wait_for(
                self.router.complete(
                    [
                        {"role": "system", "content": _TRIAGE_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    max_tokens=200,
                    session_id="query_triage",
                ),
                timeout=2.0,
            )
        except asyncio.TimeoutError:
            return self._fail_open(user_message, "timeout")
        except Exception as e:
            return self._fail_open(user_message, f"error:{str(e)[:30]}")
        if not text:
            return self._fail_open(user_message, "empty")
        try:
            d = json.loads(text)
            return QueryTriageResult(
                confidence=d.get("confidence", "high"),
                understood_query=d.get("understood_query", user_message),
                gaps=d.get("gaps", []),
                inferred_context=d.get("inferred_context", {}),
                is_answerable_from_general_knowledge=d.get(
                    "is_answerable_from_general_knowledge", False
                ),
                reasoning=d.get("reasoning", ""),
            )
        except Exception:
            return self._fail_open(user_message, "parse_error")

    @staticmethod
    def _fail_open(msg: str, reason: str) -> QueryTriageResult:
        return QueryTriageResult(confidence="high", understood_query=msg, reasoning=reason)
