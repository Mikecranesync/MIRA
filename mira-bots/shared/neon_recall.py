"""Thin NeonDB pgvector recall client for bot containers.

Single function: recall_knowledge(embedding, tenant_id, limit, query_text).
All imports are lazy — returns [] gracefully if sqlalchemy is missing,
NEON_DATABASE_URL is unset, or the query fails.

This is the read-only recall path. The write path (ingest) lives in
mira-core/mira-ingest/db/neon.py and is never called from bots.
"""

import logging
import os
import re

logger = logging.getLogger("mira-gsd")

# Matches fault codes like F002, E014, Err 23, A107 — alphanumeric codes
# that dense vector search handles poorly.
_FAULT_CODE_RE = re.compile(r"\b([A-Z]\d{2,4}|Err\s*\d+)\b", re.IGNORECASE)


def recall_knowledge(
    embedding: list[float],
    tenant_id: str,
    limit: int = 5,
    query_text: str = "",
) -> list[dict]:
    """pgvector cosine similarity search over knowledge_entries.

    When query_text contains alphanumeric fault codes (e.g. F002, E014),
    also runs a keyword ILIKE search and merges results so exact code
    matches surface even when cosine similarity ranks them low.

    Returns a list of dicts with keys:
        content, manufacturer, model_number, equipment_type, source_type, similarity

    Returns [] on any failure — never raises.
    """
    url = os.environ.get("NEON_DATABASE_URL")
    if not url or not tenant_id:
        return []
    if not embedding and not query_text:
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
            results: list[dict] = []

            # --- Vector path (when embedding is available) ---
            if embedding:
                rows = (
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
                results = [dict(r) for r in rows]

            # --- Keyword fallback for fault codes ---
            codes = _FAULT_CODE_RE.findall(query_text) if query_text else []
            if codes:
                seen = {r["content"] for r in results}
                for code in codes[:3]:  # cap at 3 codes per query
                    if embedding:
                        # Order by cosine similarity among keyword-matching rows
                        kw_rows = (
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
                                  AND content ILIKE :pat
                                ORDER BY embedding <=> cast(:emb AS vector)
                                LIMIT :lim
                            """),
                                {
                                    "emb": str(embedding),
                                    "tid": tenant_id,
                                    "pat": f"%{code}%",
                                    "lim": limit,
                                },
                            )
                            .mappings()
                            .fetchall()
                        )
                    else:
                        # No embedding — pure keyword search ordered by content length
                        kw_rows = (
                            conn.execute(
                                text("""
                                SELECT
                                    content,
                                    manufacturer,
                                    model_number,
                                    equipment_type,
                                    source_type,
                                    1.0 AS similarity
                                FROM knowledge_entries
                                WHERE tenant_id = :tid
                                  AND content ILIKE :pat
                                ORDER BY char_length(content)
                                LIMIT :lim
                            """),
                                {"tid": tenant_id, "pat": f"%{code}%", "lim": limit},
                            )
                            .mappings()
                            .fetchall()
                        )

                    for row in kw_rows:
                        if row["content"] not in seen:
                            results.append(dict(row))
                            seen.add(row["content"])

            results.sort(key=lambda r: r.get("similarity") or 0.0, reverse=True)
            # Return up to 2x limit when hybrid kicked in, otherwise normal limit
            final = results[: limit * 2 if codes else limit]
            logger.info(
                "NEON_RECALL tenant=%s hits=%d codes=%s",
                tenant_id,
                len(final),
                codes or "none",
            )
            return final

    except Exception as exc:
        logger.warning("NeonDB recall failed: %s", exc)
        return []
