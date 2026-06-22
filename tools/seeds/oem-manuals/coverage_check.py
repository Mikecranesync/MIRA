"""Show existing shared-corpus coverage for a model, grouped by source_file.

    NEON_DATABASE_URL=... python3 coverage_check.py GS10
    NEON_DATABASE_URL=... python3 coverage_check.py Micro8

Helps decide whether a full-PDF load adds coverage or duplicates an existing
chapter-by-chapter ingest.
"""

from __future__ import annotations

import os
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

TID = "78917b56-f85f-43bb-9a08-1bb98a6cd6c3"


def main() -> int:
    patt = f"%{sys.argv[1] if len(sys.argv) > 1 else 'GS10'}%"
    eng = create_engine(
        os.environ["NEON_DATABASE_URL"],
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
    )
    with eng.connect() as c:
        rows = c.execute(
            text(
                "SELECT COALESCE(NULLIF(metadata->>'source_file',''), source_type, '?') AS sf, "
                "count(*) AS n "
                "FROM knowledge_entries "
                "WHERE tenant_id=:t AND is_private=false AND model_number ILIKE :p "
                "GROUP BY sf ORDER BY n DESC LIMIT 15"
            ),
            {"t": TID, "p": patt},
        ).fetchall()
        tot = c.execute(
            text(
                "SELECT count(*) FROM knowledge_entries "
                "WHERE tenant_id=:t AND is_private=false AND model_number ILIKE :p"
            ),
            {"t": TID, "p": patt},
        ).scalar()
        print(f"=== shared chunks model~{patt} ===")
        for r in rows:
            print(f"  {r[1]:4d}  {r[0]}")
        print(f"  TOTAL: {tot}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
