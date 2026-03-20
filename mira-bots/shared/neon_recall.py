"""Thin NeonDB pgvector recall client for bot containers.

Single function: recall_knowledge(embedding, tenant_id, limit).
All imports are lazy — returns [] gracefully if sqlalchemy is missing,
NEON_DATABASE_URL is unset, or the query fails.

This is the read-only recall path. The write path (ingest) lives in
mira-core/mira-ingest/db/neon.py and is never called from bots.
"""

import logging
import os

logger = logging.getLogger("mira-gsd")


def recall_knowledge(embedding: list[float], tenant_id: str, limit: int = 5) -> list[dict]:
    """pgvector cosine similarity search over knowledge_entries.

    Returns a list of dicts with keys:
        content, manufacturer, model_number, equipment_type, source_type, similarity

    Returns [] on any failure — never raises.
    """
    url = os.environ.get("NEON_DATABASE_URL")
    if not url or not embedding or not tenant_id:
        return []

    try:
        from sqlalchemy import create_engine, text  # noqa: PLC0415
        from sqlalchemy.pool import NullPool  # noqa: PLC0415
    except ImportError:
        logger.warning("sqlalchemy not installed — NeonDB recall disabled")
        return []

    try:
        engine = create_engine(
            url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )
        with engine.connect() as conn:
            rows = conn.execute(
                text("""
                    SELECT
                        content,
                        manufacturer,
                        model_number,
                        equipment_type,
                        source_type,
                        1 - (embedding <=> cast(:emb AS vector)) AS similarity
                    FROM knowledge_entries
                    WHERE tenant_id = :tid
                      AND embedding IS NOT NULL
                    ORDER BY embedding <=> cast(:emb AS vector)
                    LIMIT :lim
                """),
                {"emb": str(embedding), "tid": tenant_id, "lim": limit},
            ).mappings().fetchall()
        results = [dict(r) for r in rows]
        logger.info("NEON_RECALL tenant=%s hits=%d", tenant_id, len(results))
        return results
    except Exception as exc:
        logger.warning("NeonDB recall failed: %s", exc)
        return []
