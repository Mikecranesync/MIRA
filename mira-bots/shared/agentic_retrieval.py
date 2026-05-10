"""Agentic retrieval primitives — Component 1: query decomposition.

Spec: docs/specs/agentic-rag-upgrade-spec.md (Component 1).

Splits a complex user question into 2-4 focused sub-queries via a cheap
Groq llama-3.1-8b-instant call so each concern hits the existing retrieval
pipeline (`neon_recall.recall_knowledge`) independently. Per-sub-query
results are merged via Reciprocal Rank Fusion (same RRF_K as
`neon_recall._merge_results`) and deduplicated using the repo's existing
key (`content[:100]`).

Flag-gated by ``MIRA_QUERY_DECOMPOSE`` (default ``0``). Fail-open: any Groq
or parse error returns ``[question]`` so callers behave identically to
today.

C2 (hybrid retrieval) and C3 (self-evaluation) are deferred to follow-up
PRs per the spec rollout plan.
"""

from __future__ import annotations

import json
import logging
import os
import re

import httpx

logger = logging.getLogger(__name__)

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = os.getenv("MIRA_DECOMPOSE_MODEL", "llama-3.1-8b-instant")
GROQ_TIMEOUT = float(os.getenv("MIRA_DECOMPOSE_TIMEOUT", "5"))

MAX_SUBQUERIES = int(os.getenv("MIRA_DECOMPOSE_MAX_SUBQUERIES", "4"))
MIN_TOKENS = int(os.getenv("MIRA_DECOMPOSE_MIN_TOKENS", "6"))

RRF_K = int(os.getenv("MIRA_RRF_K", "60"))

_SYSTEM_PROMPT = (
    "You decompose industrial maintenance questions into focused sub-queries "
    'for retrieval. Output JSON only: {"subqueries": ["...", "..."]}. '
    "Rules:\n"
    "- 2 to 4 sub-queries; each MUST be a self-contained search phrase.\n"
    "- Preserve fault codes, model numbers, and manufacturer names verbatim.\n"
    "- Cover distinct concerns (e.g. fault diagnosis, motor sizing, parameters).\n"
    "- Do NOT invent details not present in the question.\n"
    "- If the question is single-concern, return one entry equal to the question."
)


def is_decompose_enabled() -> bool:
    return os.getenv("MIRA_QUERY_DECOMPOSE", "0") == "1"


async def decompose_query(question: str) -> list[str]:
    """Return 1-4 sub-queries for ``question``. Fail-open to ``[question]``.

    Skip conditions (return ``[question]`` without an LLM call):
      - flag ``MIRA_QUERY_DECOMPOSE`` is not set to ``1``
      - ``GROQ_API_KEY`` missing
      - question shorter than ``MIN_TOKENS`` whitespace tokens

    The original question is always present in the returned list so worst-case
    retrieval is identical to today.
    """
    q = (question or "").strip()
    if not q:
        return [question]

    if not is_decompose_enabled():
        return [question]

    if len(q.split()) < MIN_TOKENS:
        logger.debug("DECOMPOSE_SKIPPED reason=short_query tokens=%d", len(q.split()))
        return [question]

    groq_key = os.getenv("GROQ_API_KEY", "")
    if not groq_key:
        logger.debug("DECOMPOSE_SKIPPED reason=no_groq_key")
        return [question]

    try:
        async with httpx.AsyncClient(timeout=GROQ_TIMEOUT) as client:
            resp = await client.post(
                GROQ_URL,
                headers={"Authorization": f"Bearer {groq_key}"},
                json={
                    "model": GROQ_MODEL,
                    "messages": [
                        {"role": "system", "content": _SYSTEM_PROMPT},
                        {"role": "user", "content": q},
                    ],
                    "temperature": 0.1,
                    "max_tokens": 256,
                    "response_format": {"type": "json_object"},
                },
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
    except Exception as exc:
        logger.warning("DECOMPOSE_FAILED error=%s", str(exc)[:200])
        return [question]

    subqueries = _parse_subqueries(content)
    if not subqueries:
        logger.warning("DECOMPOSE_FAILED reason=parse_empty raw=%s", content[:200])
        return [question]

    # Always include the original question to bound worst-case quality.
    if q not in subqueries:
        subqueries.insert(0, q)

    subqueries = subqueries[:MAX_SUBQUERIES]
    logger.info("DECOMPOSE_OK n=%d", len(subqueries))
    return subqueries


def _parse_subqueries(raw: str) -> list[str]:
    """Extract a clean list[str] of sub-queries from a model response."""
    if not raw:
        return []

    candidate = raw.strip()
    # Tolerate ```json ... ``` fences if the model ignores response_format.
    fenced = re.search(r"\{.*\}", candidate, re.DOTALL)
    if fenced:
        candidate = fenced.group(0)

    try:
        data = json.loads(candidate)
    except json.JSONDecodeError:
        return []

    if not isinstance(data, dict):
        return []

    raw_list = data.get("subqueries") or data.get("queries") or []
    if not isinstance(raw_list, list):
        return []

    out: list[str] = []
    seen: set[str] = set()
    for item in raw_list:
        if not isinstance(item, str):
            continue
        s = item.strip()
        if not s:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return out


def _chunk_key(chunk: dict) -> str:
    """Repo-canonical dedup key — matches ``neon_recall._merge_results``."""
    return (chunk.get("content") or "")[:100]


def merge_subquery_results(
    per_subquery: list[list[dict]],
    limit: int = 6,
) -> list[dict]:
    """Reciprocal Rank Fusion across per-sub-query result lists.

    Dedup by ``content[:100]`` (matches ``neon_recall._merge_results``).
    Each sub-query contributes ``1 / (RRF_K + rank_in_subquery)`` to a chunk's
    score; chunks surfaced by multiple sub-queries dominate. The first
    occurrence of a chunk wins for any non-score fields (manufacturer,
    similarity, etc.).
    """
    scores: dict[str, float] = {}
    best_row: dict[str, dict] = {}

    for rows in per_subquery:
        seen_in_stream: set[str] = set()
        rank = 0
        for row in rows:
            key = _chunk_key(row)
            if not key or key in seen_in_stream:
                continue
            seen_in_stream.add(key)
            rank += 1
            scores[key] = scores.get(key, 0.0) + 1.0 / (RRF_K + rank)
            best_row.setdefault(key, row)

    ordered = sorted(scores.keys(), key=lambda k: -scores[k])
    merged: list[dict] = []
    for key in ordered[:limit]:
        row = dict(best_row[key])
        row["rrf_score"] = round(scores[key], 6)
        merged.append(row)
    return merged
