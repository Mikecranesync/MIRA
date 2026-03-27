"""Thin NeonDB pgvector recall client for bot containers.

Primary function: recall_knowledge(embedding, tenant_id, limit, query_text).
All imports are lazy — returns [] gracefully if sqlalchemy is missing,
NEON_DATABASE_URL is unset, or the query fails.

Three-stage retrieval:
  Stage 1: Dense cosine vector search (pgvector)
  Stage 2: Fault code ILIKE fallback (F002, OC1, etc.)
  Stage 3: Product-name ILIKE search (PowerFlex 40, Micro820, etc.)
Results are merged, deduplicated, and filtered by minimum similarity threshold.

This is the read-only recall path. The write path (ingest) lives in
mira-core/mira-ingest/db/neon.py and is never called from bots.
"""

import logging
import os
import re

logger = logging.getLogger("mira-gsd")

# Fault code patterns: F002, F-201, CE2, OC1, EF, E014, etc.
_FAULT_CODE_RE = re.compile(r"\b[A-Za-z]{1,3}[-]?\d{1,4}\b")

# Product name patterns in user queries — matches "PowerFlex 40", "Micro820",
# "GS20", "CompactLogix", "ControlLogix", etc.
_PRODUCT_NAME_RE = re.compile(
    r"\b("
    r"PowerFlex\s*\d{2,4}[A-Z]?"
    r"|Micro\s*8\d{2}"
    r"|CompactLogix"
    r"|ControlLogix"
    r"|PanelView"
    r"|GS[12]\d"
    r"|DURApulse"
    r"|SMC-?\d"
    r"|SINAMICS\s*\w+"
    r"|SIMATIC\s*\w+"
    r"|ACS\s*\d{3,4}"
    r")\b",
    re.IGNORECASE,
)

MIN_SIMILARITY = 0.45


def _extract_fault_codes(query_text: str) -> list[str]:
    """Extract fault code tokens from raw user query."""
    if not query_text:
        return []
    return list({m.upper() for m in _FAULT_CODE_RE.findall(query_text)})


def _extract_product_names(query_text: str) -> list[str]:
    """Extract product/equipment names from raw user query."""
    if not query_text:
        return []
    return list({m.strip() for m in _PRODUCT_NAME_RE.findall(query_text)})


def _like_search(conn, text_fn, tenant_id: str, codes: list[str], limit: int) -> list[dict]:
    """Run ILIKE keyword search for fault codes against content column."""
    if not codes:
        return []
    conditions = []
    params: dict = {"tid": tenant_id, "lim": limit}
    for i, code in enumerate(codes[:5]):
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


def _product_search(conn, text_fn, tenant_id: str, products: list[str], limit: int) -> list[dict]:
    """Search by product name against model_number and content columns."""
    if not products:
        return []
    conditions = []
    params: dict = {"tid": tenant_id, "lim": limit}
    for i, name in enumerate(products[:3]):
        mk = f"mod{i}"
        ck = f"con{i}"
        conditions.append(f"(model_number ILIKE :{mk} OR content ILIKE :{ck})")
        params[mk] = f"%{name}%"
        params[ck] = f"%{name}%"

    where_clause = " OR ".join(conditions)
    sql = text_fn(f"""
        SELECT
            content,
            manufacturer,
            model_number,
            equipment_type,
            source_type,
            0.6 AS similarity
        FROM knowledge_entries
        WHERE tenant_id = :tid
          AND ({where_clause})
        LIMIT :lim
    """)
    rows = conn.execute(sql, params).mappings().fetchall()
    return [dict(r) for r in rows]


def _merge_results(
    vector_results: list[dict],
    like_results: list[dict],
    product_results: list[dict],
) -> tuple[list[dict], str]:
    """Merge vector, fault-code ILIKE, and product-name ILIKE results.

    Returns (merged_list, retrieval_path).
    """
    all_keyword = like_results + product_results
    if not all_keyword:
        return vector_results, "vector_only"

    # Deduplicate by first 100 chars of content
    seen = {r["content"][:100] for r in vector_results}
    unique_kw = [r for r in all_keyword if r["content"][:100] not in seen]

    top_vector_score = max((r.get("similarity", 0) for r in vector_results), default=0)

    path = "like_augmented" if like_results else "product_augmented"
    if like_results and product_results:
        path = "hybrid_augmented"

    if top_vector_score >= 0.75:
        return vector_results + unique_kw, path
    else:
        return unique_kw + vector_results, path.replace("augmented", "forced")


def recall_knowledge(
    embedding: list[float],
    tenant_id: str,
    limit: int = 5,
    query_text: str = "",
) -> list[dict]:
    """Three-stage retrieval: vector + fault code ILIKE + product name ILIKE.

    Returns a list of dicts with keys:
        content, manufacturer, model_number, equipment_type, source_type, similarity

    Results below MIN_SIMILARITY are filtered out.
    Returns [] on any failure — never raises.
    """
    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        if not getattr(recall_knowledge, "_warned_url", False):
            logger.warning(
                "NEON_DATABASE_URL not set — NeonDB recall disabled, using Open WebUI only"
            )
            recall_knowledge._warned_url = True
        return []
    if not embedding or not tenant_id:
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
            # Stage 1: Dense vector search
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
            vector_results = [
                dict(r) for r in vector_rows if r["similarity"] >= MIN_SIMILARITY
            ]

            # Stage 2: Fault code keyword fallback
            fault_codes = _extract_fault_codes(query_text)
            like_results: list[dict] = []
            if fault_codes:
                like_results = _like_search(conn, text, tenant_id, fault_codes, limit)

            # Stage 3: Product name keyword search
            product_names = _extract_product_names(query_text)
            product_results: list[dict] = []
            if product_names:
                product_results = _product_search(
                    conn, text, tenant_id, product_names, limit
                )

        # Merge and determine retrieval path
        results, retrieval_path = _merge_results(
            vector_results, like_results, product_results
        )

        top_vector_score = max(
            (r.get("similarity", 0) for r in vector_results), default=0
        )
        logger.info(
            "NEON_RECALL tenant=%s hits=%d retrieval_path=%s "
            "fault_codes=%s products=%s top_vector_score=%.3f "
            "like_hits=%d product_hits=%d",
            tenant_id,
            len(results),
            retrieval_path,
            fault_codes or [],
            product_names or [],
            top_vector_score,
            len(like_results),
            len(product_results),
        )
        return results
    except Exception as exc:
        logger.warning("NeonDB recall failed: %s", exc)
        return []
