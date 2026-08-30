"""Arena judges — deterministic first, model-judged second (budget-declared).

Deterministic checks (Tier 1, run everywhere, $0):
  * wrapper degradation   — the answer refuses for a FactoryLM reason the case
                            forbids (approved context, select a source, no
                            notebook/manual, "not in the selected sources")
  * asset-evidence claim  — an asset-specific measurement/history sentence
                            appears in a case that has no private context
  * critical facts        — objectively checkable substrings
  * forbidden phrases     — per case

Model judging (Tier 2/3) is a blind pair prompt this module BUILDS; the
runner only sends it when a dollar budget was declared (zero-token law).
Scores use the plan's weighted rubric; the verdict per case is
MIRA wins / Tie / Baseline wins plus numbers.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Any

RUBRIC_DIMENSIONS = (
    "correctness",
    "troubleshooting_usefulness",
    "visual_understanding",
    "natural_conversation",
    "evidence_source_quality",
    "followup_intelligence",
    "citation_link_usefulness",
)

# Refusal shapes MIRA's gates produce today. Any of these on a `must_answer`
# case is the plan's canonical failure (§9): the model could answer, MIRA blocked.
DEGRADATION_PATTERNS = (
    r"approved (asset )?context",
    r"select (a|the) source",
    r"no notebook",
    r"no manual (is )?(has been )?loaded",
    r"i couldn'?t find that in the selected sources",
    r"not found in the selected sources",
    r"needs approved",
    r"uns_required|approved_context|no_sources_selected|insufficient_evidence",
)

# An asset-specific claim: a named asset + a measurement/time assertion.
ASSET_CLAIM_PATTERNS = (
    r"\b(cv-?\d{2,4}|conveyor \d+|launch \d+)\b[^.]{0,80}\b(drew|was at|measured|recorded|tripped|faulted|showed)\b[^.]{0,40}\b\d",
    r"\b(at|around) \d{1,2}:\d{2}(:\d{2})?\b[^.]{0,60}\b(cv-?\d{2,4}|this machine|the machine)\b[^.]{0,60}\b(drew|was at|measured|recorded|tripped|faulted)\b",
)

HEDGE_PATTERNS = (
    r"can'?t (tell|verify|confirm)",
    r"don'?t have (the )?(machine )?history",
    r"history (for that period )?is (unavailable|not available)",
    r"i cannot verify",
)


@dataclass
class DeterministicVerdict:
    case_id: str
    system: str
    degraded: bool
    degradation_hits: list[str] = field(default_factory=list)
    asset_claim_without_evidence: bool = False
    asset_claim_hits: list[str] = field(default_factory=list)
    missing_critical_facts: list[str] = field(default_factory=list)
    forbidden_hits: list[str] = field(default_factory=list)
    empty_answer: bool = False

    @property
    def hard_fail(self) -> bool:
        return (
            self.degraded
            or self.asset_claim_without_evidence
            or self.empty_answer
            or bool(self.forbidden_hits)
        )

    def to_dict(self) -> dict[str, Any]:
        d = self.__dict__.copy()
        d["hard_fail"] = self.hard_fail
        return d


def _hits(patterns: tuple[str, ...], text: str) -> list[str]:
    return [p for p in patterns if re.search(p, text, re.I)]


def judge_deterministic(case: dict[str, Any], system: str, answer: str) -> DeterministicVerdict:
    exp = case.get("expected", {})
    text = answer or ""
    v = DeterministicVerdict(case_id=case["id"], system=system, degraded=False)
    v.empty_answer = len(text.strip()) < 20
    if exp.get("must_answer"):
        v.degradation_hits = _hits(DEGRADATION_PATTERNS, text)
        # A hedge that names the missing evidence is NOT degradation when the
        # rest of the answer exists (plan §9.2). Degradation = refusal-shaped
        # AND short, or refusal-shaped with no substantive content.
        substantive = len(text.strip()) >= 200
        hedged = bool(_hits(HEDGE_PATTERNS, text))
        v.degraded = bool(v.degradation_hits) and not (substantive and hedged)
    if exp.get("must_not_claim_asset_evidence") and not case.get("private_context"):
        v.asset_claim_hits = _hits(ASSET_CLAIM_PATTERNS, text)
        v.asset_claim_without_evidence = bool(v.asset_claim_hits)
    low = text.lower()
    v.missing_critical_facts = [f for f in exp.get("critical_facts", []) if f.lower() not in low]
    v.forbidden_hits = [p for p in exp.get("forbidden_phrases", []) if p.lower() in low]
    return v


def weighted_score(scores: dict[str, float], weights: dict[str, float]) -> float:
    """0–100 weighted score; a missing dimension scores 0 for that weight."""
    total_w = sum(weights.get(d, 0) for d in RUBRIC_DIMENSIONS) or 1.0
    return round(
        sum(float(scores.get(d, 0)) * weights.get(d, 0) for d in RUBRIC_DIMENSIONS) / total_w, 2
    )


def verdict_for(mira: float, baseline: float, tie_margin: float = 3.0) -> str:
    if mira - baseline > tie_margin:
        return "MIRA wins"
    if baseline - mira > tie_margin:
        return "Baseline wins"
    return "Tie"


def blind_pair(case: dict[str, Any], answers: dict[str, str], seed: int) -> dict[str, Any]:
    """Deterministic blind ordering: Answer A / Answer B with the mapping
    recorded separately so the evaluator (human or model) cannot see it."""
    systems = sorted(answers)
    digest = hashlib.sha256(f"{case['id']}|{seed}".encode()).digest()
    flip = (digest[0] & 1) == 1
    order = list(reversed(systems)) if flip else systems
    return {
        "case_id": case["id"],
        "answer_a": answers[order[0]],
        "answer_b": answers[order[1]],
        "mapping": {"A": order[0], "B": order[1]},
    }


def judge_prompt(case: dict[str, Any], pair: dict[str, Any]) -> list[dict[str, str]]:
    """The blind rubric prompt for a model judge. No system names appear."""
    dims = "\n".join(f"- {d}" for d in RUBRIC_DIMENSIONS)
    user_turns = "\n".join(f"USER: {t['text']}" for t in case["turns"] if t["role"] == "user")
    expected = "\n".join(
        f"- {t['text']}" for t in case["turns"] if t["role"] == "assistant_expected"
    )
    return [
        {
            "role": "system",
            "content": (
                "You are a blind evaluator of two assistant answers to the same real-world troubleshooting request. "
                "Score EACH answer 0-10 on each dimension. Reward correctness, honest uncertainty, and useful next checks; "
                "penalize invented facts, refusals of answerable questions, jargon about internal systems, and cosmetic citations. "
                'Return ONLY JSON: {"A": {dimension: score...}, "B": {...}, "notes": string}.'
            ),
        },
        {
            "role": "user",
            "content": (
                f"CASE {case['id']} ({case['category']}): {case['title']}\n\n{user_turns}\n\n"
                f"Reference expectations (not a script):\n{expected}\n\nDimensions:\n{dims}\n\n"
                f"=== Answer A ===\n{pair['answer_a']}\n\n=== Answer B ===\n{pair['answer_b']}"
            ),
        },
    ]


def parse_judge_json(text: str) -> dict[str, Any] | None:
    m = re.search(r"\{[\s\S]*\}", text or "")
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
    except ValueError:
        return None
    return obj if isinstance(obj, dict) and "A" in obj and "B" in obj else None
