"""Phase 3 retrieval gate — A/B the production path vs the bench's harness path.

Retrieval-only (score_retrieval is heuristic — no LLM keys needed). For every
bench question, score two retrieval modes:

  BASELINE  prod recall (MIRA_EQUIPMENT_RERANK off) + the bench's harness crutches
            (_equipment_sql_fetch direct pull + _rerank_for_equipment on fixture
            equipment tags). This reproduces the published 0.62 retrieval path.

  PROD      prod recall with MIRA_EQUIPMENT_RERANK=1 and NO harness crutches —
            the real production path that live surfaces use.

Gate: PROD avg relevance >= BASELINE (no regression) — ideally higher. Proves the
in-prod rerank matches/beats the harness-assisted path, so the harness crutch can
be removed and the flag shipped.

    NEON_DATABASE_URL=... python3 phase3_retrieval_ab.py [--ollama-url ...]
"""
from __future__ import annotations

import argparse
import importlib
import os
import statistics
import sys
from pathlib import Path

import httpx
import yaml

ROOT = Path(__file__).resolve().parents[3]
sys.path.append(str(ROOT / "mira-bots"))
sys.path.append(str(ROOT / "tests"))

import shared.neon_recall as nr  # noqa: E402
from mira_bench import (  # noqa: E402
    RETRIEVAL_LIMIT,
    RETRIEVAL_OVERFETCH,
    _dedup_chunks,
    _equipment_sql_fetch,
    _rerank_for_equipment,
)
from mira_bench_scorer import score_retrieval  # noqa: E402

TID = os.getenv("MIRA_TENANT_ID", "78917b56-f85f-43bb-9a08-1bb98a6cd6c3")
EMBED_MODEL = os.getenv("EMBED_TEXT_MODEL", "nomic-embed-text:latest")
QUESTIONS = ROOT / "tests" / "mira_bench_questions.yaml"


def embed(client, base, q):
    r = client.post(f"{base}/api/embeddings", json={"model": EMBED_MODEL, "prompt": q}, timeout=60)
    r.raise_for_status()
    return r.json()["embedding"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ollama-url", default=os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434"))
    args = ap.parse_args()
    qs = yaml.safe_load(QUESTIONS.read_text())["questions"]

    base: list[tuple] = []
    prod: list[tuple] = []
    with httpx.Client() as client:
        # BASELINE — flag off + harness crutches
        os.environ["MIRA_EQUIPMENT_RERANK"] = "0"
        importlib.reload(nr)
        for q in qs:
            emb = embed(client, args.ollama_url, q["question"])
            recall = nr.recall_knowledge(emb, TID, RETRIEVAL_OVERFETCH, q["question"])
            sqlf = _equipment_sql_fetch(TID, q.get("equipment") or [], RETRIEVAL_OVERFETCH)
            raw = _dedup_chunks(list(recall) + list(sqlf))
            retr, _ = _rerank_for_equipment(raw, q.get("equipment") or [], RETRIEVAL_LIMIT)
            m = score_retrieval(retr, q.get("required_documents") or [])
            base.append((q["id"], m["relevance"], m["coverage"]))

        # PROD — flag on, pure production path
        os.environ["MIRA_EQUIPMENT_RERANK"] = "1"
        importlib.reload(nr)
        for q in qs:
            emb = embed(client, args.ollama_url, q["question"])
            recall = nr.recall_knowledge(emb, TID, RETRIEVAL_LIMIT, q["question"])
            m = score_retrieval(list(recall), q.get("required_documents") or [])
            prod.append((q["id"], m["relevance"], m["coverage"]))

    print(f"{'QID':6} {'base_rel':>8} {'prod_rel':>8}  {'base_cov':>8} {'prod_cov':>8}")
    regress = 0
    for (qid, br, bc), (_, pr, pc) in zip(base, prod):
        flag = ""
        if pr < br:
            flag = "  <-REL REGRESS"
            regress += 1
        print(f"{qid:6} {br:>8.3f} {pr:>8.3f}  {bc:>8.3f} {pc:>8.3f}{flag}")

    b_rel = statistics.mean(b[1] for b in base)
    p_rel = statistics.mean(p[1] for p in prod)
    b_cov = statistics.mean(b[2] for b in base)
    p_cov = statistics.mean(p[2] for p in prod)
    print(f"\navg relevance: baseline {b_rel:.3f}  prod {p_rel:.3f}  delta {p_rel - b_rel:+.3f}")
    print(f"avg coverage:  baseline {b_cov:.3f}  prod {p_cov:.3f}  delta {p_cov - b_cov:+.3f}")
    print(f"per-question relevance regressions: {regress}/{len(base)}")
    print("GATE:", "PASS" if (p_rel >= b_rel and regress == 0) else "REVIEW")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
