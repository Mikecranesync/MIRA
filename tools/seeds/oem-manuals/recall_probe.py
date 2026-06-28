"""Run the PRODUCTION retrieval path (recall_knowledge) raw against a target DB.

Per the retrieval-diagnostics skill: diagnose on the real function, not a proxy.
Embeds each query via Ollama nomic-embed-text and calls
mira-bots/shared/neon_recall.recall_knowledge(embedding, tenant, query_text) —
the 4-stream (vector + fault + product + BM25, RRF-merged) prod retriever.

    NEON_DATABASE_URL=... python3 recall_probe.py [--ollama-url http://127.0.0.1:11434]
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "mira-bots"))
from shared.neon_recall import recall_knowledge  # noqa: E402

TID = "78917b56-f85f-43bb-9a08-1bb98a6cd6c3"
EMBED_MODEL = "nomic-embed-text"

QUERIES = [
    "GS10 overcurrent fault during acceleration",          # vendor-confusion probe
    "How do I read a parameter from a GS11 drive using a Micro820 over Modbus RTU?",  # Q01 0.4
    "How do I wire RS-485 between a Micro820 and a GS10 VFD?",  # Q04 0.2
    "How do I configure Modbus communication on the Micro820 in CCW?",  # Q06 0.0
    "What safety precautions should I take before wiring a VFD to a PLC?",  # Q07 0.0
]


def embed(client, base, q):
    r = client.post(f"{base}/api/embeddings", json={"model": EMBED_MODEL, "prompt": q}, timeout=60)
    r.raise_for_status()
    return r.json()["embedding"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ollama-url", default=os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434"))
    ap.add_argument("--limit", type=int, default=5)
    args = ap.parse_args()
    with httpx.Client() as client:
        for q in QUERIES:
            emb = embed(client, args.ollama_url, q)
            res = recall_knowledge(emb, TID, limit=args.limit, query_text=q)
            print(f"\nQ: {q}")
            if not res:
                print("   (recall returned 0 chunks)")
                continue
            for r in res:
                sim = r.get("similarity")
                sim_s = f"{sim:.3f}" if isinstance(sim, (int, float)) else str(sim)
                print(f"   sim={sim_s} {str(r.get('manufacturer'))[:18]:18s} "
                      f"{str(r.get('model_number'))[:12]:12s} {str(r.get('source_type'))[:16]:16s} "
                      f"| {str(r.get('content',''))[:70]!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
