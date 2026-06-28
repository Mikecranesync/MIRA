"""NULL-embedding canary — lock in the 2026-06-17 retrieval-coverage fix.

SQL seeds insert text-only rows (`tools/seeds/*.sql` have no `embedding` column),
so seeded chunks land with `embedding = NULL` and are invisible to the vector +
product-name retrieval streams (`mira-bots/shared/neon_recall.py`). On 2026-06-17
that left 100% of the hand-authored `field-guide` / `integration_guide` /
`component_template` content dark — exactly the chunks that answer asset-specific
questions — so MIRA refused answers it should have grounded. Backfilled via
`tools/backfill_knowledge_embeddings.py`.

This canary fails loud if those curated, retrieval-bearing source types ever carry
NULL embeddings again (e.g. a new seed lands without the backfill). It is the
"build a canary, not just a one-time fix" lock-in for this bug class (cf. #1385).

Env-driven, like the beta gate: SKIPS without `NEON_DATABASE_URL` (a plain unit
run stays green); ASSERTS when pointed at a dev/staging branch. NEVER point at
prod from a code session — use a dev/staging connection string.

    NEON_DATABASE_URL=postgresql://…stg… pytest tests/test_embedding_coverage_canary.py -v
"""

from __future__ import annotations

import os

import pytest

# Source types that are retrieval content AND authored via SQL seeds — these must
# always be embedded or they fall out of the vector/product streams. Deliberately
# excludes `relationship_proposal` / `node_attachment` (not seeded manual content).
CURATED_RETRIEVAL_TYPES = ("field-guide", "integration_guide", "component_template")


def test_curated_chunks_are_embedded():
    url = os.getenv("NEON_DATABASE_URL", "").strip()
    if not url:
        pytest.skip(
            "NEON_DATABASE_URL not set — canary needs a dev/staging branch "
            "(never prod). Set it to assert embedding coverage for real."
        )

    from sqlalchemy import create_engine, text
    from sqlalchemy.pool import NullPool

    engine = create_engine(url, poolclass=NullPool, connect_args={"sslmode": "require"})
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT source_type, count(*) AS n FROM knowledge_entries "
                "WHERE embedding IS NULL AND source_type = ANY(:types) "
                "GROUP BY source_type ORDER BY n DESC"
            ),
            {"types": list(CURATED_RETRIEVAL_TYPES)},
        ).fetchall()

    offenders = {st: n for st, n in rows}
    assert not offenders, (
        "NULL-embedding regression in curated retrieval content — these chunks are "
        "invisible to the vector + product-name streams (the 2026-06-17 bug). Run "
        f"tools/backfill_knowledge_embeddings.py. Offending source_types: {offenders}"
    )
