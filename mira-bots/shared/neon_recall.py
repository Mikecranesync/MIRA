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


def _product_search(
    conn, text_fn, tenant_id: str, products: list[str],
    embedding: list[float], limit: int,
) -> list[dict]:
    """Search by product name, reranked by vector similarity to the query.

    Filters to chunks from the product's manual (model_number match), then
    orders by cosine similarity to the user's query embedding. This surfaces
    the most RELEVANT chunks from the right manual — not just arbitrary rows.
    """
    if not products:
        return []
    results: list[dict] = []
    seen: set[str] = set()

    for name in products[:3]:
        # Use word-boundary-safe pattern: "PowerFlex 40" must not match "PowerFlex 400"
        # Append a non-digit boundary: match "PowerFlex 40" or "PowerFlex 40 " but not "PowerFlex 400"
        exact_pat = f"%{name}%"
        exclude_pat = f"%{name}0%"  # crude but effective for model numbers

        rows = conn.execute(text_fn(
            "SELECT content, manufacturer, model_number, equipment_type, "
            "source_type, "
            "1 - (embedding <=> cast(:emb AS vector)) AS similarity "
            "FROM knowledge_entries "
            "WHERE tenant_id = :tid "
            "AND model_number ILIKE :pat "
            "AND model_number NOT ILIKE :exclude "
            "AND embedding IS NOT NULL "
            "ORDER BY embedding <=> cast(:emb AS vector) "
            "LIMIT :lim"
        ), {
            "tid": tenant_id, "pat": exact_pat, "exclude": exclude_pat,
            "emb": str(embedding), "lim": limit,
        }).mappings().fetchall()

        for r in rows:
            key = r["content"][:100]
            if key not in seen:
                results.append(dict(r))
                seen.add(key)

    return results


def _merge_results(
    vector_results: list[dict],
    like_results: list[dict],
    product_results: list[dict],
) -> tuple[list[dict], str]:
    """Merge vector, fault-code ILIKE, and product-name ILIKE results.

    Product-name results are ALWAYS promoted to the top — when the user names
    a specific product, chunks from that product must be the first thing the
    LLM sees, regardless of vector similarity to other products.

    Fault-code results follow the original logic (augment or force based on
    vector score threshold).

    Returns (merged_list, retrieval_path).
    """
    if not like_results and not product_results:
        return vector_results, "vector_only"

    seen: set[str] = set()

    # Product results go first — user explicitly named the product
    merged: list[dict] = []
    for r in product_results:
        key = r["content"][:100]
        if key not in seen:
            merged.append(r)
            seen.add(key)

    # Then vector results
    for r in vector_results:
        key = r["content"][:100]
        if key not in seen:
            merged.append(r)
            seen.add(key)

    # Then fault-code LIKE results
    for r in like_results:
        key = r["content"][:100]
        if key not in seen:
            merged.append(r)
            seen.add(key)

    if product_results and like_results:
        path = "hybrid_promoted"
    elif product_results:
        path = "product_promoted"
    else:
        path = "like_augmented"

    return merged, path


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

            # Stage 3: Product name search (vector-reranked within product's manual)
            product_names = _extract_product_names(query_text)
            product_results: list[dict] = []
            if product_names:
                product_results = _product_search(
                    conn, text, tenant_id, product_names, embedding, limit
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
