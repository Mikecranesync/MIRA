"""Quick BM25 retrieval check against the shared KB corpus.

Usage:
    NEON_DATABASE_URL=... python3 retrieval_check.py "GS10 overload fault trip" [model_substr]

Prints the top BM25 hits (system-tenant shared corpus) for the query, and an
optional count of chunks whose model_number matches a substring. Avoids inline
SQL-quote mangling that breaks heredocs over SSH.
"""
from __future__ import annotations

import os
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

TID = "78917b56-f85f-43bb-9a08-1bb98a6cd6c3"


def main() -> int:
    query = sys.argv[1] if len(sys.argv) > 1 else "GS10 fault"
    model = sys.argv[2] if len(sys.argv) > 2 else None
    eng = create_engine(
        os.environ["NEON_DATABASE_URL"], poolclass=NullPool,
        connect_args={"sslmode": "require"},
    )
    with eng.connect() as c:
        if model:
            n = c.execute(
                text(
                    "SELECT count(*) FROM knowledge_entries "
                    "WHERE tenant_id=:t AND is_private=false AND model_number ILIKE :m"
                ),
                {"t": TID, "m": f"%{model}%"},
            ).scalar()
            print(f"shared chunks model~{model!r}: {n}")
        hits = c.execute(
            text(
                "SELECT model_number, "
                "ts_rank(to_tsvector('english', content), plainto_tsquery('english', :q)) AS r, "
                "(embedding IS NOT NULL) AS emb, left(content, 80) AS pv "
                "FROM knowledge_entries "
                "WHERE tenant_id=:t AND is_private=false "
                "AND to_tsvector('english', content) @@ plainto_tsquery('english', :q) "
                "ORDER BY r DESC LIMIT 5"
            ),
            {"t": TID, "q": query},
        ).fetchall()
        print(f"BM25 hits for {query!r}: {len(hits)}")
        for h in hits:
            print(f"  r={h[1]:.3f} emb={h[2]} {str(h[0])[:16]:16s} {h[3]!r}")
    return 0 if hits else 1


if __name__ == "__main__":
    sys.exit(main())
