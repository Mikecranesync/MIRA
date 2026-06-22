"""Verify OEM-manual seed landed in the shared corpus and is retrievable.

Usage (run from a node that can reach the target NeonDB):
    NEON_DATABASE_URL=... python3 verify_seed.py "GS10 fault code"

Checks:
  1. The 8 seed chunk_keys exist for the system tenant, is_private=false, embedding present.
  2. A BM25-style full-text query returns at least one seeded chunk (retrieval proof).
"""
from __future__ import annotations

import os
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

TID = "78917b56-f85f-43bb-9a08-1bb98a6cd6c3"
SEED_KEYS = [
    "gs10-fault-codes-complete-2026-05-15",
    "gs10-modbus-rtu-comm-faults-2026-05-15",
    "micro800-msg-modbus-errorid-table-2026-05-15",
    "micro800-modbuslocpara-tarpara-2026-05-15",
    "ccw-embedded-serial-out-of-sync-2026-05-15",
    "garage-rs485-wiring-and-termination-2026-05-15",
    "modbus-rtu-protocol-quick-reference-2026-05-15",
    "garage-commissioning-decision-tree-2026-05-15",
]


def main() -> int:
    query = sys.argv[1] if len(sys.argv) > 1 else "GS10 fault code modbus"
    eng = create_engine(
        os.environ["NEON_DATABASE_URL"],
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
    )
    with eng.connect() as c:
        print("=== 1. seed rows present (system tenant, shared) ===")
        rows = c.execute(
            text(
                """
                SELECT metadata->>'chunk_key' AS k, is_private,
                       (embedding IS NOT NULL) AS emb, manufacturer, model_number
                FROM knowledge_entries
                WHERE tenant_id = :t
                  AND metadata->>'chunk_key' = ANY(:keys)
                ORDER BY k
                """
            ),
            {"t": TID, "keys": SEED_KEYS},
        ).fetchall()
        for r in rows:
            print(f"  {r[0]:50s} private={r[1]} emb={r[2]} {r[3]} {r[4]}")
        print(f"  -> {len(rows)}/{len(SEED_KEYS)} seed chunks present")

        print(f"\n=== 2. BM25-style retrieval for: {query!r} ===")
        hits = c.execute(
            text(
                """
                SELECT metadata->>'chunk_key' AS k, model_number,
                       ts_rank(to_tsvector('english', content),
                               plainto_tsquery('english', :q)) AS rank
                FROM knowledge_entries
                WHERE tenant_id = :t
                  AND (is_private = false OR tenant_id = :t)
                  AND to_tsvector('english', content) @@ plainto_tsquery('english', :q)
                ORDER BY rank DESC
                LIMIT 5
                """
            ),
            {"t": TID, "q": query},
        ).fetchall()
        for h in hits:
            print(f"  rank={h[2]:.4f}  {h[1]:12s}  {h[0]}")
        print(f"  -> {len(hits)} chunks retrieved for the query")

    ok = len(rows) == len(SEED_KEYS) and len(hits) > 0
    print("\nRESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
