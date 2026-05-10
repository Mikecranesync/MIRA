"""Agentic retrieval primitives — Components 1 + 2.

Spec: docs/specs/agentic-rag-upgrade-spec.md.

C1 (``decompose_query``): splits a complex question into 2-4 focused
sub-queries via Groq llama-3.1-8b-instant; per-sub-query results merged
via RRF in ``merge_subquery_results``. Flag-gated by
``MIRA_QUERY_DECOMPOSE`` (default ``0``). Fail-open to ``[question]``.

C2 (``evaluate_retrieval``): scores retrieved chunks 1-10 for relevance
to the question via Groq; below threshold, returns a reformulated query
the caller can retry with (1 retry max). Flag-gated by
``MIRA_RAG_SELF_EVAL`` (default ``0``). Fail-open to
``(True, 5.0, None)`` so retrieval is never blocked on Groq errors.
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


# ---------------------------------------------------------------------------
# Component 2 — retrieval self-evaluation
# ---------------------------------------------------------------------------

SELF_EVAL_THRESHOLD = float(os.getenv("MIRA_RAG_SELF_EVAL_THRESHOLD", "0.4"))
SELF_EVAL_CHUNKS = int(os.getenv("MIRA_RAG_SELF_EVAL_CHUNKS", "5"))
SELF_EVAL_CHUNK_CHARS = int(os.getenv("MIRA_RAG_SELF_EVAL_CHARS", "500"))

_EVAL_SYSTEM_PROMPT = (
    "You rate how relevant retrieved document chunks are to an industrial "
    "maintenance question. Output JSON only: "
    '{"score": <1-10 integer>, "reason": "<short>"}. '
    "10 = chunks directly answer the question. 1 = chunks are unrelated. "
    "Be strict: chunks about a different manufacturer or unrelated equipment "
    "score below 4."
)

_REFORMULATE_SYSTEM_PROMPT = (
    "You rewrite an industrial maintenance question into a better search "
    "query, using equipment context when provided. Output JSON only: "
    '{"query": "<rewritten search phrase>"}. '
    "Rules: keep manufacturer, model, and fault codes verbatim; use specific "
    "technical terms; produce a single self-contained search phrase."
)


def is_self_eval_enabled() -> bool:
    return os.getenv("MIRA_RAG_SELF_EVAL", "0") == "1"


async def evaluate_retrieval(
    question: str,
    chunks: list[dict],
    threshold: float = SELF_EVAL_THRESHOLD,
    equipment_context: str | None = None,
) -> tuple[bool, float, str | None]:
    """Score retrieved chunks 1-10 (normalized to 0-1) for relevance.

    Returns ``(is_relevant, normalized_score, reformulated_query_or_None)``.

    Fail-open: any Groq/parse error returns ``(True, 0.5, None)`` so the
    caller proceeds with the original chunks. When ``score < threshold`` and
    Groq successfully proposes a reformulation, the third tuple element is
    the new query; otherwise ``None``.
    """
    q = (question or "").strip()
    if not q or not chunks:
        return (True, 0.5, None)

    groq_key = os.getenv("GROQ_API_KEY", "")
    if not groq_key:
        logger.debug("SELF_EVAL_SKIPPED reason=no_groq_key")
        return (True, 0.5, None)

    sample = []
    for c in chunks[:SELF_EVAL_CHUNKS]:
        text = (c.get("content") or "")[:SELF_EVAL_CHUNK_CHARS]
        if text:
            sample.append(text)
    if not sample:
        return (True, 0.5, None)

    user_msg = f"Question: {q}\n\nChunks:\n" + "\n---\n".join(
        f"[{i + 1}] {t}" for i, t in enumerate(sample)
    )

    try:
        async with httpx.AsyncClient(timeout=GROQ_TIMEOUT) as client:
            resp = await client.post(
                GROQ_URL,
                headers={"Authorization": f"Bearer {groq_key}"},
                json={
                    "model": GROQ_MODEL,
                    "messages": [
                        {"role": "system", "content": _EVAL_SYSTEM_PROMPT},
                        {"role": "user", "content": user_msg},
                    ],
                    "temperature": 0.1,
                    "max_tokens": 128,
                    "response_format": {"type": "json_object"},
                },
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
    except Exception as exc:
        logger.warning("SELF_EVAL_FAILED error=%s", str(exc)[:200])
        return (True, 0.5, None)

    raw_score = _parse_eval_score(content)
    if raw_score is None:
        logger.warning("SELF_EVAL_PARSE_FAILED raw=%s", content[:200])
        return (True, 0.5, None)

    normalized = max(0.0, min(1.0, raw_score / 10.0))
    is_relevant = normalized >= threshold
    logger.info(
        "SELF_EVAL score=%.2f relevant=%s threshold=%.2f",
        normalized,
        is_relevant,
        threshold,
    )

    if is_relevant:
        return (True, normalized, None)

    reformulated = await _reformulate_query(q, equipment_context, groq_key)
    return (False, normalized, reformulated)


def _parse_eval_score(raw: str) -> float | None:
    if not raw:
        return None
    candidate = raw.strip()
    fenced = re.search(r"\{.*\}", candidate, re.DOTALL)
    if fenced:
        candidate = fenced.group(0)
    try:
        data = json.loads(candidate)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    score = data.get("score")
    if isinstance(score, bool):
        return None
    if isinstance(score, (int, float)):
        return float(score)
    if isinstance(score, str):
        try:
            return float(score)
        except ValueError:
            return None
    return None


async def _reformulate_query(
    question: str,
    equipment_context: str | None,
    groq_key: str,
) -> str | None:
    ctx_line = f"Equipment context: {equipment_context}\n" if equipment_context else ""
    user_msg = f"{ctx_line}Original question: {question}"
    try:
        async with httpx.AsyncClient(timeout=GROQ_TIMEOUT) as client:
            resp = await client.post(
                GROQ_URL,
                headers={"Authorization": f"Bearer {groq_key}"},
                json={
                    "model": GROQ_MODEL,
                    "messages": [
                        {"role": "system", "content": _REFORMULATE_SYSTEM_PROMPT},
                        {"role": "user", "content": user_msg},
                    ],
                    "temperature": 0.1,
                    "max_tokens": 128,
                    "response_format": {"type": "json_object"},
                },
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
    except Exception as exc:
        logger.warning("REFORMULATE_FAILED error=%s", str(exc)[:200])
        return None

    candidate = content.strip()
    fenced = re.search(r"\{.*\}", candidate, re.DOTALL)
    if fenced:
        candidate = fenced.group(0)
    try:
        data = json.loads(candidate)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    new_q = data.get("query")
    if not isinstance(new_q, str):
        return None
    new_q = new_q.strip()
    if not new_q or new_q.lower() == question.lower():
        return None
    return new_q


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
