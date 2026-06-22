"""Phase 3 decisive test — VECTOR retrieval SCOPED by model/vendor.

The raw vector battery returned cross-vendor noise (GS10 query -> V1000/SINAMICS)
because it had no product filter. Prod's 4-stage hybrid extracts the model/vendor
and scopes by it. This restores that one missing variable: cosine search WITHIN
the queried model's chunks. Simulates "what the retriever sees once it knows the
vendor" without standing up the engine.

    NEON_DATABASE_URL=... python3 vector_battery_scoped.py [--ollama-url ...]
"""

from __future__ import annotations

import argparse
import os

import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

TID = "78917b56-f85f-43bb-9a08-1bb98a6cd6c3"
EMBED_MODEL = "nomic-embed-text"

GS10 = "(model_number ILIKE '%GS10%' OR manufacturer ILIKE '%automationdirect%' OR manufacturer ILIKE '%automation direct%')"
M820 = "(model_number ILIKE '%Micro8%' OR manufacturer ILIKE '%rockwell%' OR manufacturer ILIKE '%allen%')"

QUERIES = [
    ("GS10 drive will not start after power up", GS10),
    ("GS10 overcurrent fault during acceleration", GS10),
    ("how to set GS10 acceleration and deceleration time parameter", GS10),
    ("GS10 keypad fault code reset procedure", GS10),
    ("GS10 motor overload protection electronic thermal setting", GS10),
    ("Micro820 controller not communicating over Modbus RTU", M820),
    ("Micro820 run mode LED off troubleshooting", M820),
    ("Micro820 high speed counter configuration", M820),
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
        os.environ["NEON_DATABASE_URL"],
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
    )
    full = 0
    with httpx.Client() as client, eng.connect() as c:
        for q, scope in QUERIES:
            vec = embed(client, args.ollama_url, q)
            sql = (
                "SELECT COALESCE(metadata->>'source_file','') sf, model_number, "
                "1 - (embedding <=> cast(:v AS vector)) AS sim "
                "FROM knowledge_entries "
                "WHERE tenant_id=:t AND is_private=false AND embedding IS NOT NULL "
                f"AND {scope} "
                "ORDER BY embedding <=> cast(:v AS vector) LIMIT 3"
            )
            rows = c.execute(text(sql), {"t": TID, "v": str(vec)}).fetchall()
            print(f"\nQ: {q}")
            if not rows:
                print("   (no in-scope hits)")
                continue
            for h in rows:
                is_full = h[0].lower().endswith(".pdf")
                if is_full:
                    full += 1
                tag = "FULL-PDF" if is_full else "other   "
                print(f"   sim={h[2]:.3f} [{tag}] {str(h[1])[:14]:14s} {h[0] or '-'}")
    print(f"\nfull-manual chunks in scoped vector top-3: {full}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
