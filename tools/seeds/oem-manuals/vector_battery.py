"""Phase 3 VECTOR retrieval battery — the honest test.

BM25 (retrieval_battery.py) needs lexical overlap and misses natural-language
queries whose words differ from the manual's ("overcurrent" vs "oc fault").
Production retrieval is hybrid (vector + BM25 + fault/product). This script tests
the VECTOR leg: embed each query via Ollama nomic-embed-text, cosine-search the
shared corpus, and show whether FULL-MANUAL (.pdf) chunks surface.

    NEON_DATABASE_URL=... python3 vector_battery.py [--ollama-url http://127.0.0.1:11434]
"""
from __future__ import annotations

import argparse
import os

import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

TID = "78917b56-f85f-43bb-9a08-1bb98a6cd6c3"
EMBED_MODEL = "nomic-embed-text"

QUERIES = [
    "GS10 drive will not start after power up",
    "GS10 overcurrent fault during acceleration",
    "how to set GS10 acceleration and deceleration time parameter",
    "GS10 keypad fault code reset procedure",
    "GS10 motor overload protection electronic thermal setting",
    "Micro820 controller not communicating over Modbus RTU",
    "Micro820 run mode LED off troubleshooting",
    "Micro820 high speed counter configuration",
    "RS-485 wiring termination between GS10 drive and Micro820 PLC",
]


def embed(client, base, q):
    r = client.post(f"{base}/api/embeddings", json={"model": EMBED_MODEL, "prompt": q}, timeout=60)
    r.raise_for_status()
    return r.json()["embedding"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ollama-url", default=os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434"))
    args = ap.parse_args()
    eng = create_engine(
        os.environ["NEON_DATABASE_URL"], poolclass=NullPool,
        connect_args={"sslmode": "require"},
    )
    full = 0
    with httpx.Client() as client, eng.connect() as c:
        for q in QUERIES:
            vec = embed(client, args.ollama_url, q)
            rows = c.execute(
                text(
                    "SELECT COALESCE(metadata->>'source_file','') sf, model_number, "
                    "1 - (embedding <=> cast(:v AS vector)) AS sim "
                    "FROM knowledge_entries "
                    "WHERE tenant_id=:t AND is_private=false AND embedding IS NOT NULL "
                    "ORDER BY embedding <=> cast(:v AS vector) LIMIT 3"
                ),
                {"t": TID, "v": str(vec)},
            ).fetchall()
            print(f"\nQ: {q}")
            for h in rows:
                is_full = h[0].lower().endswith(".pdf")
                if is_full:
                    full += 1
                tag = "FULL-PDF" if is_full else "other   "
                print(f"   sim={h[2]:.3f} [{tag}] {str(h[1])[:14]:14s} {h[0] or '-'}")
    print(f"\nfull-manual chunks in any vector top-3: {full}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
