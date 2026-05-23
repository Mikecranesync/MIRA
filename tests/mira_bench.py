"""MIRA vs ungrounded-LLM benchmark.

For each question in mira_bench_questions.yaml:

  1. Embed the question via local Ollama nomic-embed-text.
  2. Call shared.neon_recall.recall_knowledge against the staging Neon
     branch (BM25 + vector + structured fault). Read-only.
  3. Score the retrieved chunk set (relevance / coverage / citation
     quality) — heuristic, no LLM.
  4. Generate a GROUNDED answer: same LLM cascade, system prompt that
     forces the model to cite the retrieved chunks and refuse-if-empty.
  5. Generate a BASELINE answer: same cascade, NO retrieval, generic
     industrial-maintenance system prompt.
  6. LLM-judge both answers on six 1-5 dimensions (correctness,
     citation_quality, completeness, safety, hallucination_resistance,
     usefulness).
  7. Write a Markdown side-by-side report.

Usage:
    doppler run --project factorylm --config stg -- python3 tests/mira_bench.py \
        --output docs/evaluations/runs/2026-05-23/

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

from shared.inference.router import InferenceRouter  # noqa: E402
from shared.neon_recall import recall_knowledge  # noqa: E402

from mira_bench_scorer import (  # noqa: E402
    DIMENSIONS,
    score_answer,
    score_retrieval,
)

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
        # Empty-retrieval case is a real finding — let the model state
        # the no-coverage answer instead of pretending.
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
    logger.info("Q %s — %s", qid, question)

    embedding = await embed_text(question)
    if embedding is None:
        logger.warning("Q %s — embedding failed, BM25/fault streams only", qid)

    # Run blocking recall in a thread (sqlalchemy is sync)
    retrieved = await asyncio.to_thread(
        recall_knowledge,
        embedding,
        tenant_id,
        RETRIEVAL_LIMIT,
        question,
    )
    retrieval_metrics = score_retrieval(retrieved, q.get("required_documents") or [])

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
    lines.append("# MIRA vs ungrounded-LLM benchmark")
    lines.append("")
    lines.append(f"**Run:** {meta['run_id']}")
    lines.append(f"**Started:** {meta['started']}")
    lines.append(f"**Tenant:** `{meta['tenant_id']}`")
    lines.append(f"**Cascade:** {meta['cascade']}")
    lines.append(f"**Retrieval limit:** {RETRIEVAL_LIMIT}")
    lines.append("")

    # Aggregate
    gtot = sum(r["grounded_score"]["total"] for r in results)
    btot = sum(r["baseline_score"]["total"] for r in results)
    n = len(results)
    max_total = n * 30
    lines.append("## Aggregate")
    lines.append("")
    lines.append(f"| | MIRA grounded | ungrounded LLM |")
    lines.append(f"|---|---|---|")
    lines.append(f"| total (of {max_total}) | **{gtot}** | **{btot}** |")
    lines.append(f"| avg per question (of 30) | **{gtot/n:.1f}** | **{btot/n:.1f}** |")
    lines.append("")

    # Per-dimension aggregate
    lines.append("### Per-dimension average (1-5)")
    lines.append("")
    lines.append("| dimension | MIRA grounded | ungrounded LLM | delta |")
    lines.append("|---|---|---|---|")
    for d in DIMENSIONS:
        ga = sum(r["grounded_score"]["scores"][d] for r in results) / n
        ba = sum(r["baseline_score"]["scores"][d] for r in results) / n
        lines.append(f"| {d} | {ga:.2f} | {ba:.2f} | {ga - ba:+.2f} |")
    lines.append("")

    # Retrieval aggregate
    avg_chunks = sum(r["retrieval"]["n_chunks"] for r in results) / n
    avg_rel = sum(r["retrieval"]["relevance"] for r in results) / n
    avg_cov = sum(r["retrieval"]["coverage"] for r in results) / n
    avg_cit = sum(r["retrieval"]["citation_quality"] for r in results) / n
    empty_retrievals = sum(1 for r in results if r["retrieval"]["n_chunks"] == 0)
    lines.append("### Retrieval quality")
    lines.append("")
    lines.append(f"- avg chunks/question: **{avg_chunks:.1f}**")
    lines.append(f"- avg relevance: **{avg_rel:.2f}**")
    lines.append(f"- avg coverage: **{avg_cov:.2f}**")
    lines.append(f"- avg citation-ready: **{avg_cit:.2f}**")
    lines.append(f"- empty-retrieval questions: **{empty_retrievals} / {n}**")
    lines.append("")

    # Per-question detail
    lines.append("## Per-question detail")
    lines.append("")
    for r in results:
        lines.append(f"### {r['id']} · {r['category']} · {r['difficulty']}")
        lines.append("")
        lines.append(f"**Q:** {r['question']}")
        lines.append("")
        lines.append(
            f"**Retrieval:** {r['retrieval']['n_chunks']} chunks · "
            f"relevance {r['retrieval']['relevance']} · "
            f"coverage {r['retrieval']['coverage']} · "
            f"citation-ready {r['retrieval']['citation_quality']} · "
            f"embedding_ok={r['embedding_ok']}"
        )
        if r["retrieval"]["sources"]:
            lines.append("")
            lines.append("Sources retrieved:")
            for s in r["retrieval"]["sources"]:
                lines.append(f"- {s}")
        lines.append("")

        lines.append("**Scores (1-5 each, total /30):**")
        lines.append("")
        lines.append("| dimension | MIRA grounded | ungrounded LLM |")
        lines.append("|---|---|---|")
        for d in DIMENSIONS:
            g = r["grounded_score"]["scores"].get(d, 0)
            b = r["baseline_score"]["scores"].get(d, 0)
            lines.append(f"| {d} | {g} | {b} |")
        lines.append(
            f"| **total** | **{r['grounded_score']['total']}** | "
            f"**{r['baseline_score']['total']}** |"
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

    # Force cloud cascade — even if Doppler sets local
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
    }

    # Run questions sequentially — keeps the cascade rate-limit visible
    # and the logs readable. ~6 LLM calls per question × 10 questions
    # is well under the per-provider hourly budget.
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
                "question": q["question"],
                "error": str(exc),
                "retrieval": {"n_chunks": 0, "relevance": 0.0, "coverage": 0.0,
                              "citation_quality": 0.0, "sources": []},
                "grounded_answer": "",
                "baseline_answer": "",
                "grounded_score": {"scores": {d: 0 for d in DIMENSIONS}, "total": 0, "notes": ""},
                "baseline_score": {"scores": {d: 0 for d in DIMENSIONS}, "total": 0, "notes": ""},
                "embedding_ok": False,
            }
        results.append(r)
        gtot = r["grounded_score"]["total"]
        btot = r["baseline_score"]["total"]
        logger.info(
            "Q %s done — grounded=%d/30 baseline=%d/30 chunks=%d",
            r["id"], gtot, btot, r["retrieval"]["n_chunks"],
        )

    # Persist raw JSON + markdown
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
