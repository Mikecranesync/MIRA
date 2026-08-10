"""Undo the unsafe PF525 dedup.

The manifest did not capture `embedding`, so a naive re-insert would restore
3,364 rows with NULL embeddings — invisible to the vector and product streams,
which is the exact NULL-embedding defect class the retrieval-diagnostics skill
exists to catch. A "rollback" that silently destroys retrievability is worse
than the mutation it undoes.

Recovery is possible without re-embedding because every deleted row was an
EXACT content duplicate of a surviving row (that is why it was deleted). So the
embedding is copied from the surviving twin, matched on md5(content). Identical
text under a deterministic embedder yields an identical vector, so this is a
true restore of that column rather than an approximation.

Not recovered: created_at / updated_at (never captured). Reported, not hidden.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

MANIFEST = Path(sys.argv[1])
APPLY = "--apply" in sys.argv

rows = [json.loads(x) for x in MANIFEST.read_text(encoding="utf-8").splitlines() if x.strip()]
print(f"manifest rows: {len(rows)}")

eng = create_engine(
    os.environ["NEON_DATABASE_URL"], poolclass=NullPool, connect_args={"sslmode": "require"}
)

INSERT = text("""
INSERT INTO knowledge_entries
  (id, tenant_id, source_type, equipment_type, manufacturer, model_number, content,
   is_private, verified, input_type, source_url, source_page, source_ref, metadata,
   chunk_type, isa95_path, equipment_id, data_type, embedding)
SELECT cast(:id AS uuid), cast(:tenant_id AS uuid), :source_type, :equipment_type, :manufacturer,
       :model_number, :content, :is_private, :verified, :input_type, :source_url,
       :source_page, :source_ref, cast(:metadata AS jsonb), :chunk_type, :isa95_path,
       :equipment_id, :data_type,
       (SELECT k.embedding FROM knowledge_entries k
         WHERE md5(k.content) = md5(cast(:content AS text)) AND k.embedding IS NOT NULL
         LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM knowledge_entries e WHERE e.id = cast(:id AS uuid))
""")

with eng.connect() as c:
    present = c.execute(
        text("SELECT count(*) FROM knowledge_entries WHERE id = ANY(cast(:ids AS uuid[]))"),
        {"ids": [r["id"] for r in rows]},
    ).scalar()
    print(f"already present: {present} / {len(rows)}")

    if not APPLY:
        print("DRY RUN — pass --apply to restore.")
        sys.exit(0)

    inserted = no_emb = 0
    for r in rows:
        p = {
            k: r.get(k)
            for k in (
                "id",
                "tenant_id",
                "source_type",
                "equipment_type",
                "manufacturer",
                "model_number",
                "content",
                "is_private",
                "verified",
                "input_type",
                "source_url",
                "source_page",
                "source_ref",
                "chunk_type",
                "isa95_path",
                "equipment_id",
                "data_type",
            )
        }
        md = r.get("metadata")
        p["metadata"] = json.dumps(md) if isinstance(md, (dict, list)) else (md or "{}")
        res = c.execute(INSERT, p)
        inserted += res.rowcount or 0
    c.commit()

    total = c.execute(
        text(
            "SELECT count(*) FROM knowledge_entries WHERE is_private=false AND model_number ILIKE '%525%'"
        )
    ).scalar()
    no_emb = c.execute(
        text(
            "SELECT count(*) FROM knowledge_entries WHERE is_private=false "
            "AND model_number ILIKE '%525%' AND embedding IS NULL"
        )
    ).scalar()
    print(f"inserted: {inserted}")
    print(f"PF525 rows now: {total}   NULL-embedding rows: {no_emb}")
