"""Phase 3 retrieval battery — does full-PDF content surface for natural queries?

Runs a fixed set of natural troubleshooting queries against the shared corpus
(BM25, system tenant, is_private=false) and, for each, shows the top hits with
their source_file so you can see whether FULL-MANUAL chunks (source_file ends
.pdf) surface, or only the curated chunks.jsonl gap-fills.

    NEON_DATABASE_URL=... python3 retrieval_battery.py

Gate for Phase 3: full-manual chunks should appear for queries the curated set
doesn't cover, AND the curated chunks must still rank for their own queries.
"""
from __future__ import annotations

import os

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

TID = "78917b56-f85f-43bb-9a08-1bb98a6cd6c3"

QUERIES = [
    "GS10 drive will not start after power up",
    "GS10 overcurrent fault during acceleration",
    "how to set GS10 acceleration and deceleration time parameter",
    "GS10 keypad fault code reset procedure",
    "GS10 motor overload protection electronic thermal setting",
    "Micro820 controller not communicating over Modbus RTU",
    "Micro820 run mode LED off troubleshooting",
    "RS-485 wiring termination between GS10 drive and Micro820 PLC",
]


def main() -> int:
    eng = create_engine(
        os.environ["NEON_DATABASE_URL"], poolclass=NullPool,
        connect_args={"sslmode": "require"},
    )
    full_hits = 0
    with eng.connect() as c:
        for q in QUERIES:
            rows = c.execute(
                text(
                    "SELECT model_number, "
                    "COALESCE(metadata->>'source_file','') AS sf, "
                    "ts_rank(to_tsvector('english', content), plainto_tsquery('english', :q)) AS r "
                    "FROM knowledge_entries "
                    "WHERE tenant_id=:t AND is_private=false "
                    "AND to_tsvector('english', content) @@ plainto_tsquery('english', :q) "
                    "ORDER BY r DESC LIMIT 3"
                ),
                {"t": TID, "q": q},
            ).fetchall()
            print(f"\nQ: {q}")
            if not rows:
                print("   (no hits)")
                continue
            for h in rows:
                is_full = h[1].lower().endswith(".pdf")
                if is_full:
                    full_hits += 1
                tag = "FULL-PDF" if is_full else "curated "
                print(f"   r={h[2]:.3f} [{tag}] {str(h[0])[:14]:14s} {h[1] or '-'}")
    print(f"\nfull-manual chunks appearing in any top-3: {full_hits}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
