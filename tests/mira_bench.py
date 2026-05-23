"""MIRA vs ungrounded-LLM benchmark — v2 (2026-05-23).

For each question in mira_bench_questions.yaml:

  1. Embed the question via local Ollama nomic-embed-text.
  2. Call shared.neon_recall.recall_knowledge against the staging Neon
     branch (BM25 + vector + structured fault). Read-only.
  3. v2: re-rank the returned chunks using the question's `equipment` tag
     so PowerFlex chunks don't bleed into a Micro820/GS11 question. The
     re-rank lives ONLY in the test harness — neon_recall.py is not
     modified.
  4. Score the retrieved chunk set (relevance / coverage / citation
     quality) — heuristic, no LLM.
  5. Generate a GROUNDED answer: same LLM cascade, system prompt that
     forces the model to cite the retrieved chunks and refuse-if-empty.
  6. Generate a BASELINE answer: same cascade, NO retrieval, generic
     industrial-maintenance system prompt.
  7. v2: score each answer on six LLM-judged 1-5 dims + objective
     `factual_accuracy` (component-match) + `fabrication_penalty`
     (deduction for unsupported specific claims). See
     `tests/mira_bench_scorer.py` for the formula.
  8. Write a Markdown side-by-side report.

Usage:
    doppler run --project factorylm --config stg -- python3 tests/mira_bench.py \
        --output docs/evaluations/runs/2026-05-23-v2/

Rules:
- Read-only against NeonDB.
- Staging branch only (factorylm/stg).
- Tenant ID comes from QUICKSTART_TENANT_ID (UUID) — MIRA_TENANT_ID
  in stg is the literal string "staging" which is not a valid UUID.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.append(str(ROOT / "mira-bots"))
sys.path.append(str(ROOT / "tests"))

from mira_bench_scorer import (  # noqa: E402
    DIMENSIONS,
    MAX_LLM_TOTAL,
    MAX_TOTAL,
    score_answer,
    score_retrieval,
)
from shared.inference.router import InferenceRouter  # noqa: E402
from shared.neon_recall import recall_knowledge  # noqa: E402

# SQL for equipment-targeted fallback retrieval — read-only.
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger("mira-bench")
# Silence noisy SQLAlchemy/recall info logs in the bench output
logging.getLogger("mira-gsd").setLevel(logging.WARNING)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

QUESTIONS_PATH = ROOT / "tests" / "mira_bench_questions.yaml"
RETRIEVAL_LIMIT = 5
# v2: pull more candidates than we'll keep so the equipment-scope rerank
# has something to choose from; we then trim to RETRIEVAL_LIMIT for the
# prompt.
RETRIEVAL_OVERFETCH = 15
EMBED_MODEL = os.environ.get("EMBED_TEXT_MODEL", "nomic-embed-text:latest")
OLLAMA_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")


GROUNDED_SYSTEM = """You are MIRA, an industrial maintenance assistant.

You will be given a maintenance question and a small set of KB chunks
retrieved from the customer's manuals and reference documents. Use ONLY
those chunks to answer.

RULES:
1. Ground every technical fact in a numbered chunk. After each fact,
   append the citation inline as [#N] where N is the chunk number.
2. If the chunks do not contain enough information to answer, say so
   explicitly: "The KB does not contain enough information to answer
   confidently." Then list what additional documents would be needed.
3. Lead with the most important fact. Then ordered steps.
4. Include safety warnings (de-energize, LOTO, qualified person, verify
   zero voltage, DC bus discharge) whenever the task touches power
   wiring, drives, or live control.
5. Be terse. A maintenance tech is reading on a phone in a noisy plant.
6. Never invent register numbers, fault codes, or parameter names not
   present in the chunks.
"""

BASELINE_SYSTEM = """You are an industrial maintenance assistant with broad
knowledge of PLCs, VFDs, and Modbus. Answer the user's question to the best
of your ability. Be concise and practical. Include safety warnings where
appropriate.
"""


# ---------------------------------------------------------------------------
# Equipment-scope re-rank wrapper (v2)
# ---------------------------------------------------------------------------

# Aliases the wrapper uses to detect equipment in a question. The right-hand
# side is the set of substrings we search for in a chunk's manufacturer,
# model_number, source_url, and content. This is intentionally not a full
# BM25 reranker — its only job is to keep PowerFlex chunks out of a
# Micro820 answer.
EQUIPMENT_ALIASES: dict[str, set[str]] = {
    "gs11": {"gs11", "gs-11", "gs 11"},
    "gs10": {"gs10", "gs-10", "gs 10"},
    "micro820": {
        "micro820", "micro 820", "micro-820",
        "2080-lc20", "2080-lc30", "2080-lc",
    },
    "ccw": {"ccw", "connected components workbench"},
    "rs-485": {"rs-485", "rs485", "rs 485"},
    "vfd": {"vfd", "drive", "inverter"},
    "powerflex": {"powerflex", "power flex", "pflex"},
    "guardmaster": {"guardmaster", "guard master"},
    "v1000": {"v1000", "v-1000"},
}

# Equipment that, if mentioned in a chunk, hurts a question that asked
# about a DIFFERENT product. Used as a negative signal when no positive
# match is present.
NEGATIVE_EQUIPMENT = ["powerflex", "guardmaster", "v1000"]


def _equipment_tokens(equipment_list: list[str]) -> set[str]:
    """Map a question's equipment list to the full substring search set."""
    tokens: set[str] = set()
    for tag in equipment_list:
        key = tag.lower().strip()
        tokens |= EQUIPMENT_ALIASES.get(key, {key})
    return tokens


# Top-level SHARED_TENANT_ID — the seeds use the shared pool when the
# tenant_id is null. The recall_knowledge fn already searches BOTH tenant
# pools; we mirror that here so direct ILIKE pulls reach the seeded chunks.
SHARED_TENANT_ID = "00000000-0000-0000-0000-000000000000"


def _equipment_sql_fetch(
    tenant_id: str,
    question_equipment: list[str],
    limit: int,
) -> list[dict]:
    """Fallback: pull chunks directly by equipment match via SQL.

    The production BM25/vector retriever frequently misses our seeded
    GS10/GS11/Micro820 chunks because the tokenizer favours longer chapter
    chunks with NULL manufacturer. This fallback queries the same
    knowledge_entries table read-only and ILIKE-matches the question's
    equipment tags against manufacturer / model_number / content.

    Conforms to the task rule "do equipment scoping as a wrapper, not by
    modifying production code".
    """
    if not question_equipment:
        return []
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        return []
    tokens = _equipment_tokens(question_equipment)
    if not tokens:
        return []
    try:
        engine = create_engine(
            url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )
        # Build clauses. Priority: chunks whose manufacturer/model_number
        # carries the equipment token rank ABOVE chunks where the token
        # is only in `content`. The seeded GS10/GS11/Micro820 chunks all
        # carry tagged manufacturer/model — we want those first.
        clauses_meta: list[str] = []
        clauses_content: list[str] = []
        params: dict[str, Any] = {
            "tid": tenant_id,
            "shared_tid": SHARED_TENANT_ID,
            "lim": limit,
        }
        for i, tok in enumerate(tokens):
            pkey = f"tok{i}"
            params[pkey] = f"%{tok}%"
            clauses_meta.append(
                f"(model_number ILIKE :{pkey} OR manufacturer ILIKE :{pkey})"
            )
            clauses_content.append(f"(content ILIKE :{pkey})")
        meta_or = " OR ".join(clauses_meta)
        content_or = " OR ".join(clauses_content)
        sql = (
            "SELECT content, manufacturer, model_number, equipment_type, "
            "       source_type, source_url, source_page, metadata, "
            f"       CASE WHEN ({meta_or}) THEN 0 ELSE 1 END AS prio "
            "FROM knowledge_entries "
            "WHERE (tenant_id = :tid OR tenant_id = :shared_tid) "
            f"  AND (({meta_or}) OR ({content_or})) "
            "ORDER BY prio ASC "
            "LIMIT :lim"
        )
        with engine.connect() as conn:
            rows = conn.execute(text(sql), params).mappings().fetchall()
        return [dict(r) for r in rows]
    except Exception as exc:
        logger.warning("equipment SQL fallback failed: %s", exc)
        return []


def _dedup_chunks(chunks: list[dict]) -> list[dict]:
    """Drop duplicates on (manufacturer, model_number, source_page, first 80 chars).

    Preserves order — first occurrence wins.
    """
    seen: set[tuple] = set()
    out: list[dict] = []
    for ch in chunks:
        key = (
            ch.get("manufacturer") or "",
            ch.get("model_number") or "",
            ch.get("source_page") or "",
            (ch.get("content") or "")[:80],
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(ch)
    return out


def _rerank_for_equipment(
    chunks: list[dict],
    question_equipment: list[str],
    limit: int,
) -> tuple[list[dict], dict[str, Any]]:
    """Re-rank chunks so the question's equipment family floats to the top.

    Score per chunk:
      +2  per positive equipment-alias hit (manufacturer / model OR content)
      -1  per negative-equipment hit (powerflex / guardmaster / v1000)
          when NO positive hit is present (chunk is purely "other equipment")
      tie-broken by original order (BM25/vector ranking preserved)

    Returns (kept_chunks, debug_dict). Debug dict carries impact counts.
    """
    if not question_equipment:
        return chunks[:limit], {
            "rerank": "skipped (no equipment tag on question)",
            "kept": len(chunks[:limit]),
            "dropped": max(0, len(chunks) - limit),
            "positive_hits": 0,
            "negative_hits": 0,
            "candidates_in": len(chunks),
        }

    pos_tokens = _equipment_tokens(question_equipment)

    scored: list[tuple[int, int, dict]] = []
    pos_hits = 0
    neg_hits = 0
    for orig_idx, ch in enumerate(chunks):
        meta_blob = " ".join([
            str(ch.get("manufacturer") or ""),
            str(ch.get("model_number") or ""),
        ]).lower()
        content_blob = str(ch.get("content") or "").lower()
        # Strong signal: equipment in manufacturer/model_number (5 pts each)
        meta_pos = sum(1 for tok in pos_tokens if tok in meta_blob)
        # Weaker signal: equipment in content only (1 pt each)
        content_pos = sum(
            1 for tok in pos_tokens
            if tok in content_blob and tok not in meta_blob
        )
        neg = sum(
            1 for tok in NEGATIVE_EQUIPMENT
            if tok in meta_blob or tok in content_blob
        )
        if meta_pos + content_pos > 0:
            score = 5 * meta_pos + 1 * content_pos
            pos_hits += 1
        else:
            score = -neg
            if neg > 0:
                neg_hits += 1
        scored.append((-score, orig_idx, ch))

    scored.sort(key=lambda t: (t[0], t[1]))
    kept = [t[2] for t in scored[:limit]]
    dropped = [t[2] for t in scored[limit:]]
    return kept, {
        "rerank": "applied",
        "question_equipment": question_equipment,
        "candidates_in": len(chunks),
        "kept": len(kept),
        "dropped": len(dropped),
        "positive_hits": pos_hits,
        "negative_hits": neg_hits,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def embed_text(text: str) -> list[float] | None:
    """Embed a string via local Ollama. Return None on failure."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{OLLAMA_URL}/api/embeddings",
                json={"model": EMBED_MODEL, "prompt": text},
            )
            resp.raise_for_status()
            return resp.json().get("embedding")
    except Exception as exc:
        logger.warning("embed_text failed: %s", exc)
        return None


def format_chunks_for_prompt(chunks: list[dict]) -> str:
    parts: list[str] = []
    for i, ch in enumerate(chunks, 1):
        mfr = ch.get("manufacturer") or "?"
        model = ch.get("model_number") or "?"
        page = ch.get("source_page")
        stype = ch.get("source_type") or "?"
        header = f"[#{i}] {mfr} / {model} — {stype}"
        if page:
            header += f" (p.{page})"
        body = (ch.get("content") or "").strip()
        if len(body) > 1400:
            body = body[:1400] + " …"
        parts.append(f"{header}\n{body}")
    return "\n\n".join(parts)


async def generate_grounded(
    router: InferenceRouter, question: str, chunks: list[dict]
) -> str:
    if not chunks:
        kb_block = "(no KB chunks retrieved)"
    else:
        kb_block = format_chunks_for_prompt(chunks)
    user = (
        f"QUESTION: {question}\n\n"
        f"RETRIEVED KB CHUNKS:\n{kb_block}\n\n"
        "Answer per the rules. Cite chunks inline as [#N]."
    )
    content, _ = await router.complete(
        [
            {"role": "system", "content": GROUNDED_SYSTEM},
            {"role": "user", "content": user},
        ],
        max_tokens=900,
        session_id="bench-grounded",
    )
    return content.strip()


async def generate_baseline(router: InferenceRouter, question: str) -> str:
    content, _ = await router.complete(
        [
            {"role": "system", "content": BASELINE_SYSTEM},
            {"role": "user", "content": question},
        ],
        max_tokens=900,
        session_id="bench-baseline",
    )
    return content.strip()


# ---------------------------------------------------------------------------
# Run one question end-to-end
# ---------------------------------------------------------------------------


async def run_question(
    router: InferenceRouter,
    q: dict[str, Any],
    tenant_id: str,
) -> dict[str, Any]:
    qid = q["id"]
    question = q["question"]
    equipment = q.get("equipment") or []
    logger.info("Q %s — %s (equipment=%s)", qid, question, equipment)

    embedding = await embed_text(question)
    if embedding is None:
        logger.warning("Q %s — embedding failed, BM25/fault streams only", qid)

    bm25_retrieved = await asyncio.to_thread(
        recall_knowledge,
        embedding,
        tenant_id,
        RETRIEVAL_OVERFETCH,
        question,
    )
    # v2 fallback: also pull chunks DIRECTLY by equipment ILIKE match. The
    # production retriever often misses the seeded GS10/GS11/Micro820 chunks
    # because of BM25 term weighting; this pass guarantees they're in the
    # candidate set for rerank.
    sql_fallback = await asyncio.to_thread(
        _equipment_sql_fetch, tenant_id, equipment, RETRIEVAL_OVERFETCH
    )
    raw_retrieved = _dedup_chunks(list(bm25_retrieved) + list(sql_fallback))
    retrieved, rerank_dbg = _rerank_for_equipment(
        raw_retrieved, equipment, RETRIEVAL_LIMIT
    )
    rerank_dbg["bm25_in"] = len(bm25_retrieved)
    rerank_dbg["sql_fallback_in"] = len(sql_fallback)
    retrieval_metrics = score_retrieval(retrieved, q.get("required_documents") or [])
    retrieval_metrics["rerank"] = rerank_dbg

    grounded_answer, baseline_answer = await asyncio.gather(
        generate_grounded(router, question, retrieved),
        generate_baseline(router, question),
    )

    expected = q.get("expected_answer_components") or []
    grounded_score, baseline_score = await asyncio.gather(
        score_answer(router, question, expected, grounded_answer, "MIRA-grounded"),
        score_answer(router, question, expected, baseline_answer, "ungrounded-LLM"),
    )

    return {
        "id": qid,
        "category": q.get("category"),
        "difficulty": q.get("difficulty"),
        "equipment": equipment,
        "question": question,
        "embedding_ok": embedding is not None,
        "retrieval": retrieval_metrics,
        "grounded_answer": grounded_answer,
        "baseline_answer": baseline_answer,
        "grounded_score": grounded_score,
        "baseline_score": baseline_score,
    }


# ---------------------------------------------------------------------------
# Report writer
# ---------------------------------------------------------------------------


def render_report(results: list[dict[str, Any]], meta: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append("# MIRA vs ungrounded-LLM benchmark — v2")
    lines.append("")
    lines.append(f"**Run:** {meta['run_id']}")
    lines.append(f"**Started:** {meta['started']}")
    lines.append(f"**Tenant:** `{meta['tenant_id']}`")
    lines.append(f"**Cascade:** {meta['cascade']}")
    lines.append(
        f"**Retrieval limit:** {RETRIEVAL_LIMIT} "
        f"(overfetch {RETRIEVAL_OVERFETCH}, equipment rerank)"
    )
    lines.append(
        f"**Scorer:** 6 LLM dims + factual_accuracy + fabrication_penalty "
        f"(max /{MAX_TOTAL})"
    )
    lines.append("")

    gtot = sum(r["grounded_score"]["total"] for r in results)
    btot = sum(r["baseline_score"]["total"] for r in results)
    gtot_raw = sum(r["grounded_score"]["total_raw"] for r in results)
    btot_raw = sum(r["baseline_score"]["total_raw"] for r in results)
    g_llm = sum(r["grounded_score"]["llm_total"] for r in results)
    b_llm = sum(r["baseline_score"]["llm_total"] for r in results)
    g_pen = sum(r["grounded_score"]["fabrication"]["penalty"] for r in results)
    b_pen = sum(r["baseline_score"]["fabrication"]["penalty"] for r in results)
    n = len(results)
    max_total = n * MAX_TOTAL
    max_llm = n * MAX_LLM_TOTAL
    lines.append("## Aggregate")
    lines.append("")
    lines.append("| | MIRA grounded | ungrounded LLM |")
    lines.append("|---|---|---|")
    lines.append(f"| total (of {max_total}) | **{gtot}** | **{btot}** |")
    lines.append(f"| total_raw (pre-fabrication) (of {max_total}) | {gtot_raw} | {btot_raw} |")
    lines.append(f"| LLM-only sum (of {max_llm}, v1-comparable) | {g_llm} | {b_llm} |")
    lines.append(f"| fabrication penalty (sum) | {g_pen} | {b_pen} |")
    lines.append(f"| avg per question (of {MAX_TOTAL}) | **{gtot/n:.1f}** | **{btot/n:.1f}** |")
    lines.append("")

    lines.append("### Per-dimension average (1-5)")
    lines.append("")
    lines.append("| dimension | MIRA grounded | ungrounded LLM | delta |")
    lines.append("|---|---|---|---|")
    for d in DIMENSIONS:
        ga = sum(r["grounded_score"]["scores"].get(d, 0) for r in results) / n
        ba = sum(r["baseline_score"]["scores"].get(d, 0) for r in results) / n
        lines.append(f"| {d} | {ga:.2f} | {ba:.2f} | {ga - ba:+.2f} |")
    lines.append("")

    avg_chunks = sum(r["retrieval"]["n_chunks"] for r in results) / n
    avg_rel = sum(r["retrieval"]["relevance"] for r in results) / n
    avg_cov = sum(r["retrieval"]["coverage"] for r in results) / n
    avg_cit = sum(r["retrieval"]["citation_quality"] for r in results) / n
    empty_retrievals = sum(1 for r in results if r["retrieval"]["n_chunks"] == 0)
    pos_hits = sum(r["retrieval"]["rerank"].get("positive_hits", 0) for r in results)
    rerank_dropped = sum(r["retrieval"]["rerank"].get("dropped", 0) for r in results)
    lines.append("### Retrieval quality")
    lines.append("")
    lines.append(f"- avg chunks/question: **{avg_chunks:.1f}**")
    lines.append(f"- avg relevance: **{avg_rel:.2f}**")
    lines.append(f"- avg coverage: **{avg_cov:.2f}**")
    lines.append(f"- avg citation-ready: **{avg_cit:.2f}**")
    lines.append(f"- empty-retrieval questions: **{empty_retrievals} / {n}**")
    lines.append(
        f"- equipment-rerank: {pos_hits} chunks with positive equipment hits, "
        f"{rerank_dropped} dropped to overfetch tail"
    )
    lines.append("")

    lines.append("## Per-question detail")
    lines.append("")
    for r in results:
        lines.append(f"### {r['id']} · {r['category']} · {r['difficulty']}")
        lines.append("")
        lines.append(f"**Q:** {r['question']}")
        lines.append("")
        rerank = r["retrieval"]["rerank"]
        lines.append(
            f"**Retrieval:** {r['retrieval']['n_chunks']} chunks · "
            f"relevance {r['retrieval']['relevance']} · "
            f"coverage {r['retrieval']['coverage']} · "
            f"citation-ready {r['retrieval']['citation_quality']} · "
            f"embedding_ok={r['embedding_ok']}"
        )
        lines.append(
            f"**Rerank:** equipment={r.get('equipment') or '(none)'} · "
            f"pos_hits={rerank.get('positive_hits', 0)} · "
            f"neg_hits={rerank.get('negative_hits', 0)} · "
            f"bm25_in={rerank.get('bm25_in', '?')} · "
            f"sql_fallback_in={rerank.get('sql_fallback_in', '?')} · "
            f"candidates_in={rerank.get('candidates_in', '?')} · "
            f"dropped={rerank.get('dropped', 0)}"
        )
        if r["retrieval"]["sources"]:
            lines.append("")
            lines.append("Sources retrieved:")
            for s in r["retrieval"]["sources"]:
                lines.append(f"- {s}")
        lines.append("")

        lines.append(f"**Scores (1-5 each, total /{MAX_TOTAL} after fabrication penalty):**")
        lines.append("")
        lines.append("| dimension | MIRA grounded | ungrounded LLM |")
        lines.append("|---|---|---|")
        for d in DIMENSIONS:
            g = r["grounded_score"]["scores"].get(d, 0)
            b = r["baseline_score"]["scores"].get(d, 0)
            lines.append(f"| {d} | {g} | {b} |")
        lines.append(
            f"| _LLM 6-dim sum_ | {r['grounded_score']['llm_total']} | "
            f"{r['baseline_score']['llm_total']} |"
        )
        lines.append(
            f"| _factual_accuracy ratio_ | {r['grounded_score']['factual']['ratio']} | "
            f"{r['baseline_score']['factual']['ratio']} |"
        )
        lines.append(
            f"| _fabrication penalty_ | -{r['grounded_score']['fabrication']['penalty']} | "
            f"-{r['baseline_score']['fabrication']['penalty']} |"
        )
        lines.append(
            f"| **total** | **{r['grounded_score']['total']}** | "
            f"**{r['baseline_score']['total']}** |"
        )
        lines.append("")
        if r["grounded_score"]["fabrication"]["flagged"]:
            lines.append(
                "_Grounded fabrications flagged:_ "
                + ", ".join(r["grounded_score"]["fabrication"]["flagged"])
            )
            lines.append("")
        if r["baseline_score"]["fabrication"]["flagged"]:
            lines.append(
                "_Baseline fabrications flagged:_ "
                + ", ".join(r["baseline_score"]["fabrication"]["flagged"])
            )
            lines.append("")
        if r["grounded_score"]["factual"]["missing"]:
            lines.append(
                "_Grounded missing components:_ "
                + ", ".join(r["grounded_score"]["factual"]["missing"])
            )
            lines.append("")
        if r["baseline_score"]["factual"]["missing"]:
            lines.append(
                "_Baseline missing components:_ "
                + ", ".join(r["baseline_score"]["factual"]["missing"])
            )
            lines.append("")
        if r["grounded_score"].get("notes"):
            lines.append(f"_Judge on grounded:_ {r['grounded_score']['notes']}")
            lines.append("")
        if r["baseline_score"].get("notes"):
            lines.append(f"_Judge on baseline:_ {r['baseline_score']['notes']}")
            lines.append("")

        lines.append("<details><summary>MIRA grounded answer</summary>")
        lines.append("")
        lines.append("```")
        lines.append(r["grounded_answer"])
        lines.append("```")
        lines.append("")
        lines.append("</details>")
        lines.append("")
        lines.append("<details><summary>ungrounded LLM answer</summary>")
        lines.append("")
        lines.append("```")
        lines.append(r["baseline_answer"])
        lines.append("```")
        lines.append("")
        lines.append("</details>")
        lines.append("")
        lines.append("---")
        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--output",
        type=Path,
        default=ROOT / "docs/evaluations/runs" / datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        help="Output directory for the run artifacts",
    )
    ap.add_argument(
        "--only",
        type=str,
        default="",
        help="Comma-separated question IDs to run (default: all)",
    )
    args = ap.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    if "NEON_DATABASE_URL" not in os.environ:
        print(
            "ERROR: NEON_DATABASE_URL not set — run under doppler "
            "(`doppler run --project factorylm --config stg -- ...`)",
            file=sys.stderr,
        )
        return 2

    tenant_id = os.environ.get("QUICKSTART_TENANT_ID") or os.environ.get("MIRA_TENANT_ID") or ""
    if not tenant_id:
        print("ERROR: no tenant id available", file=sys.stderr)
        return 2

    os.environ["INFERENCE_BACKEND"] = "cloud"
    router = InferenceRouter()
    if not router.enabled:
        print("ERROR: InferenceRouter disabled — check GROQ/CEREBRAS/GEMINI keys", file=sys.stderr)
        return 2

    with QUESTIONS_PATH.open() as f:
        cfg = yaml.safe_load(f)
    questions: list[dict] = cfg["questions"]
    if args.only:
        only_ids = {s.strip() for s in args.only.split(",") if s.strip()}
        questions = [q for q in questions if q["id"] in only_ids]

    started = datetime.now(timezone.utc).isoformat(timespec="seconds")
    run_id = started.replace(":", "").replace("-", "")
    meta = {
        "run_id": run_id,
        "started": started,
        "tenant_id": tenant_id,
        "cascade": " → ".join(p.name for p in router.providers),
        "questions": len(questions),
        "version": "v2",
    }

    results: list[dict[str, Any]] = []
    for q in questions:
        try:
            r = await run_question(router, q, tenant_id)
        except Exception as exc:
            logger.exception("Q %s crashed: %s", q["id"], exc)
            r = {
                "id": q["id"],
                "category": q.get("category"),
                "difficulty": q.get("difficulty"),
                "equipment": q.get("equipment", []),
                "question": q["question"],
                "error": str(exc),
                "retrieval": {
                    "n_chunks": 0, "relevance": 0.0, "coverage": 0.0,
                    "citation_quality": 0.0, "sources": [],
                    "rerank": {
                        "rerank": "errored", "candidates_in": 0,
                        "kept": 0, "dropped": 0,
                        "positive_hits": 0, "negative_hits": 0,
                    },
                },
                "grounded_answer": "",
                "baseline_answer": "",
                "grounded_score": {
                    "scores": {d: 0 for d in DIMENSIONS},
                    "total": 0, "total_raw": 0, "llm_total": 0, "notes": "",
                    "factual": {"score_1to5": 0, "matched": [], "missing": [], "ratio": 0.0},
                    "fabrication": {"penalty": 0, "n_claims": 0, "n_unsupported": 0, "flagged": []},
                },
                "baseline_score": {
                    "scores": {d: 0 for d in DIMENSIONS},
                    "total": 0, "total_raw": 0, "llm_total": 0, "notes": "",
                    "factual": {"score_1to5": 0, "matched": [], "missing": [], "ratio": 0.0},
                    "fabrication": {"penalty": 0, "n_claims": 0, "n_unsupported": 0, "flagged": []},
                },
                "embedding_ok": False,
            }
        results.append(r)
        gtot = r["grounded_score"]["total"]
        btot = r["baseline_score"]["total"]
        logger.info(
            "Q %s done — grounded=%d/%d baseline=%d/%d chunks=%d",
            r["id"], gtot, MAX_TOTAL, btot, MAX_TOTAL, r["retrieval"]["n_chunks"],
        )

    raw_path = args.output / "mira-bench-raw.json"
    md_path = args.output / "mira-bench-results.md"
    with raw_path.open("w") as f:
        json.dump({"meta": meta, "results": results}, f, indent=2)
    with md_path.open("w") as f:
        f.write(render_report(results, meta))

    print(f"\nWrote {raw_path}")
    print(f"Wrote {md_path}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
