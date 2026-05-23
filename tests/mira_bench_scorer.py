"""LLM-judge scorer for the MIRA vs ungrounded-LLM benchmark.

The judge is the same Groq model the engine uses, accessed via the
production InferenceRouter. We rate each answer on six 1-5 dimensions
and ask the judge to emit a strict JSON object.

Read-only: never writes to NeonDB. Only outbound LLM calls.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
from pathlib import Path
from typing import Any

# Order matters: append (not insert) so stdlib (email/...) wins over
# mira-bots/email/ when httpx pulls urllib.
ROOT = Path(__file__).resolve().parent.parent
sys.path.append(str(ROOT / "mira-bots"))

from shared.inference.router import InferenceRouter  # noqa: E402

logger = logging.getLogger("mira-bench.scorer")

DIMENSIONS: list[str] = [
    "correctness",
    "citation_quality",
    "completeness",
    "safety",
    "hallucination_resistance",
    "usefulness",
]

JUDGE_SYSTEM = """You are an expert industrial maintenance engineer grading answers about
PLC programming, VFD configuration, and Modbus communications.

You will be shown a maintenance question, a list of expected answer
components (technical facts that ought to appear), and a candidate
answer. Rate the candidate on six 1-5 dimensions, where 5 is best:

  correctness            — Are the technical facts right? (registers, baud
                            rate, parity, wiring, CCW steps.) Penalize
                            wrong facts heavily.
  citation_quality       — Does the answer cite specific manual pages,
                            sections, or document chunks? Vague "see the
                            manual" is 1; per-fact citations is 5.
  completeness           — Does it cover the question's scope (wiring,
                            params, programming, testing, etc.)?
  safety                 — Does it include appropriate safety warnings
                            (de-energize, LOTO, qualified person, DC bus)
                            when the task warrants them? If the task
                            involves wiring / power / drives, missing
                            safety is 1-2.
  hallucination_resistance — When information is missing or uncertain,
                            does the answer admit it instead of making
                            things up? Confidently-wrong facts are 1.
  usefulness             — Could a maintenance tech actually follow this?
                            Concrete, ordered steps with units = high.

Respond with ONLY a strict JSON object:

{
  "correctness": <int 1-5>,
  "citation_quality": <int 1-5>,
  "completeness": <int 1-5>,
  "safety": <int 1-5>,
  "hallucination_resistance": <int 1-5>,
  "usefulness": <int 1-5>,
  "notes": "<2-3 sentence rationale>"
}

No prose outside the JSON object.
"""

_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


def _extract_json(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        pass
    m = _JSON_RE.search(text)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


def _clamp(v: Any) -> int:
    try:
        i = int(v)
    except Exception:
        return 0
    return max(1, min(5, i))


async def score_answer(
    router: InferenceRouter,
    question: str,
    expected_components: list[str],
    answer: str,
    candidate_label: str,
) -> dict[str, Any]:
    """Score one answer. Returns a dict with the six dimensions + notes.

    On judge failure (cascade exhausted, JSON parse error) returns a
    record with all-zero scores and `error` populated.
    """
    user_msg = (
        f"QUESTION:\n{question}\n\n"
        f"EXPECTED COMPONENTS (facts that ought to appear, partial credit OK):\n"
        + "\n".join(f"- {c}" for c in expected_components)
        + f"\n\nCANDIDATE ({candidate_label}) ANSWER:\n{answer}\n\n"
        "Score the candidate on the six dimensions. Return ONLY the JSON object."
    )
    messages = [
        {"role": "system", "content": JUDGE_SYSTEM},
        {"role": "user", "content": user_msg},
    ]
    content, usage = await router.complete(
        messages, max_tokens=512, session_id=f"bench-judge-{candidate_label}"
    )
    parsed = _extract_json(content)
    if not parsed:
        return {
            "scores": {d: 0 for d in DIMENSIONS},
            "total": 0,
            "notes": "",
            "error": "judge returned unparseable output",
            "raw": content[:400],
            "provider": usage.get("provider", "?"),
        }
    scores = {d: _clamp(parsed.get(d, 0)) for d in DIMENSIONS}
    total = sum(scores.values())
    return {
        "scores": scores,
        "total": total,
        "notes": str(parsed.get("notes", ""))[:600],
        "error": None,
        "provider": usage.get("provider", "?"),
    }


def score_retrieval(retrieved: list[dict], required_docs: list[str]) -> dict[str, Any]:
    """Heuristic scoring of the retrieved chunk set (no LLM call).

    relevance — share of chunks whose content contains any required-doc
                keyword token; 0-1.
    coverage  — share of required docs touched by at least one chunk.
    citation_quality — share of chunks carrying a (source_type, source_page)
                tuple suitable for a citation.
    """
    if not retrieved:
        return {
            "n_chunks": 0,
            "relevance": 0.0,
            "coverage": 0.0,
            "citation_quality": 0.0,
            "sources": [],
        }
    # Token set from required docs (lowercase, length >= 4)
    required_tokens: list[set[str]] = []
    for doc in required_docs:
        toks = {t for t in re.findall(r"[A-Za-z0-9]+", doc.lower()) if len(t) >= 4}
        required_tokens.append(toks)

    hits = 0
    covered: set[int] = set()
    cited = 0
    sources: list[str] = []
    for ch in retrieved:
        body = (ch.get("content") or "").lower()
        any_match = False
        for idx, toks in enumerate(required_tokens):
            if toks and any(tok in body for tok in toks):
                any_match = True
                covered.add(idx)
        if any_match:
            hits += 1
        if ch.get("source_page") or ch.get("source_url") or ch.get("source_type"):
            cited += 1
        src = (
            f"{ch.get('manufacturer') or '?'} / "
            f"{ch.get('model_number') or '?'} / "
            f"p.{ch.get('source_page') or '?'} "
            f"({ch.get('source_type') or '?'})"
        )
        sources.append(src)

    n = len(retrieved)
    return {
        "n_chunks": n,
        "relevance": round(hits / n, 3),
        "coverage": round(len(covered) / max(1, len(required_docs)), 3),
        "citation_quality": round(cited / n, 3),
        "sources": sources,
    }


if __name__ == "__main__":
    # Smoke-test the judge with a synthetic answer.
    async def _main():
        os.environ.setdefault("INFERENCE_BACKEND", "cloud")
        r = InferenceRouter()
        if not r.enabled:
            print("InferenceRouter disabled — set INFERENCE_BACKEND=cloud and API keys")
            return
        out = await score_answer(
            r,
            question="What is the default baud rate of the GS10 serial port?",
            expected_components=["9600", "8N1", "no parity"],
            answer="The GS10 default baud rate is 9600 with 8N1 framing per the manual.",
            candidate_label="smoke",
        )
        print(json.dumps(out, indent=2))

    asyncio.run(_main())
