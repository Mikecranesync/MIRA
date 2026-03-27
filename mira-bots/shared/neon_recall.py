"""Thin NeonDB pgvector recall client for bot containers.

Primary function: recall_knowledge(embedding, tenant_id, limit, query_text).
All imports are lazy — returns [] gracefully if sqlalchemy is missing,
NEON_DATABASE_URL is unset, or the query fails.

Phase 1 RAG upgrade: when fault codes are detected in query_text, a secondary
ILIKE query runs alongside vector search. Results are merged and deduplicated.

This is the read-only recall path. The write path (ingest) lives in
mira-core/mira-ingest/db/neon.py and is never called from bots.
"""

import logging
import os
import re

logger = logging.getLogger("mira-gsd")

# Fault code patterns: F002, F-201, CE2, OC1, EF, E014, etc.
_FAULT_CODE_RE = re.compile(r"\b[A-Za-z]{1,3}[-]?\d{1,4}\b")


def _extract_fault_codes(query_text: str) -> list[str]:
    """Extract fault code tokens from raw user query."""
    if not query_text:
        return []
    return list({m.upper() for m in _FAULT_CODE_RE.findall(query_text)})


def _like_search(conn, text_fn, tenant_id: str, codes: list[str], limit: int) -> list[dict]:
    """Run ILIKE keyword search for fault codes against content column."""
    if not codes:
        return []
    # Build OR conditions for each code
    conditions = []
    params: dict = {"tid": tenant_id, "lim": limit}
    for i, code in enumerate(codes[:5]):  # cap at 5 codes
        key = f"pat{i}"
        conditions.append(f"content ILIKE :{key}")
        params[key] = f"%{code}%"

    where_clause = " OR ".join(conditions)
    sql = text_fn(f"""
        SELECT
            content,
            manufacturer,
            model_number,
            equipment_type,
            source_type,
            0.5 AS similarity
        FROM knowledge_entries
        WHERE tenant_id = :tid
          AND ({where_clause})
        LIMIT :lim
    """)
    rows = conn.execute(sql, params).mappings().fetchall()
    return [dict(r) for r in rows]


def _merge_results(vector_results: list[dict], like_results: list[dict]) -> tuple[list[dict], str]:
    """Merge vector and ILIKE results, deduplicate, determine ordering.

    Returns (merged_list, retrieval_path).
    retrieval_path: 'vector_only' | 'like_augmented' | 'like_forced'
    """
    if not like_results:
        return vector_results, "vector_only"

    # Deduplicate by first 100 chars of content
    seen = {r["content"][:100] for r in vector_results}
    unique_like = [r for r in like_results if r["content"][:100] not in seen]

    top_vector_score = max((r.get("similarity", 0) for r in vector_results), default=0)

    if top_vector_score >= 0.75:
        # Vector results are strong — append LIKE hits at end
        return vector_results + unique_like, "like_augmented"
    else:
        # Vector results are weak — promote LIKE hits to top
        return unique_like + vector_results, "like_forced"


def recall_knowledge(
    embedding: list[float],
    tenant_id: str,
    limit: int = 5,
    query_text: str = "",
) -> list[dict]:
    """pgvector cosine similarity search over knowledge_entries.

    When query_text contains fault code patterns (F002, OC1, etc.), a secondary
    ILIKE search runs and results are merged with vector hits.

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
            # Stage 1: Dense vector search (existing path)
            vector_rows = (
                conn.execute(
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
                )
                .mappings()
                .fetchall()
            )
            vector_results = [dict(r) for r in vector_rows]

            # Stage 2: Fault code keyword fallback
            fault_codes = _extract_fault_codes(query_text)
            like_results: list[dict] = []
            if fault_codes:
                like_results = _like_search(conn, text, tenant_id, fault_codes, limit)

        # Merge and determine retrieval path
        results, retrieval_path = _merge_results(vector_results, like_results)

        top_vector_score = max((r.get("similarity", 0) for r in vector_results), default=0)
        logger.info(
            "NEON_RECALL tenant=%s hits=%d retrieval_path=%s "
            "fault_codes=%s top_vector_score=%.3f like_hits=%d",
            tenant_id,
            len(results),
            retrieval_path,
            fault_codes or [],
            top_vector_score,
            len(like_results),
        )
        return results
    except Exception as exc:
        logger.warning("NeonDB recall failed: %s", exc)
        return []
