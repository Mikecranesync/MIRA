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

# Fault code patterns: F002, F-201, CE2, OC1, EF, E014, A501, etc.
_FAULT_CODE_RE = re.compile(r"\b[A-Za-z]{1,3}[-]?\d{1,4}\b")

# VFD-specific alpha-only fault codes (Yaskawa, AutomationDirect, etc.)
# These don't have trailing digits so _FAULT_CODE_RE misses them.
# Only matched when near fault-context words to avoid false positives.
_VFD_ALPHA_CODES = frozenset(
    {
        "OC",
        "OCA",
        "OCD",
        "GF",
        "OV",
        "UV",
        "LF",
        "OH",
        "OL",
        "SC",
        "PF",
        "RR",
        "BB",
        "DEV",
        "OS",
        "PGO",
        "EF",
        "STP",
        "AUF",
        "OPL",
        "PHL",
    }
)
_FAULT_CONTEXT_RE = re.compile(
    r"\b(fault|error|alarm|trip|code|warning|drive|vfd|inverter)\b",
    re.IGNORECASE,
)

# Product name patterns in user queries — matches "PowerFlex 40", "Micro820",
# "GS20", "CompactLogix", "ControlLogix", etc.
_PRODUCT_NAME_RE = re.compile(
    r"\b("
    r"PowerFlex\s*\d{2,4}[A-Z]?"
    r"|Micro\s*8\d{2}"
    r"|CompactLogix"
    r"|ControlLogix"
    r"|PanelView"
    r"|GS\d{1,2}[A-Z]?[-]?\w*"
    r"|DURApulse"
    r"|SMC-?\d"
    r"|SINAMICS\s*\w+"
    r"|SIMATIC\s*\w+"
    r"|ACS\s*\d{3,4}"
    r"|VLT\s*FC\s*\d{3}"
    r"|A1000"
    r"|Yaskawa\s*A1000"
    r"|Danfoss\s*VLT"
    r")\b",
    re.IGNORECASE,
)

MIN_SIMILARITY = float(os.getenv("MIRA_MIN_SIMILARITY", "0.70"))

# Shared OEM knowledge pool — 61K entries ingested under the original tenant.
# All tenants search this pool in addition to their own entries so they have
# immediate access to OEM manual knowledge on first login.
SHARED_TENANT_ID = os.getenv("MIRA_SHARED_TENANT_ID", "78917b56-f85f-43bb-9a08-1bb98a6cd6c3")


def _extract_fault_codes(query_text: str) -> list[str]:
    """Extract fault code tokens from raw user query.

    Matches two patterns:
      1. Alphanumeric codes like F4, F012, OC1, A501 (via regex)
      2. VFD-specific alpha-only codes like OC, GF, OH (only when
         fault-context words appear in the same message)
    """
    if not query_text:
        return []
    codes: set[str] = {m.upper() for m in _FAULT_CODE_RE.findall(query_text)}

    # Check for alpha-only VFD codes when fault context is present
    if _FAULT_CONTEXT_RE.search(query_text):
        for word in query_text.upper().split():
            cleaned = word.strip(".,!?:;()\"'")
            if cleaned in _VFD_ALPHA_CODES:
                codes.add(cleaned)

    return list(codes)


def recall_fault_code(
    code: str,
    tenant_id: str,
    model: str | None = None,
) -> list[dict]:
    """Deterministic fault code lookup from structured fault_codes table.

    Returns list of matching fault code records (may match multiple equipment).
    Returns [] on any failure — never raises.
    """
    url = os.environ.get("NEON_DATABASE_URL")
    if not url or not code or not tenant_id:
        return []

    try:
        from sqlalchemy import create_engine, text  # noqa: PLC0415
        from sqlalchemy.pool import NullPool  # noqa: PLC0415
    except ImportError:
        return []

    try:
        engine = create_engine(
            url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )
        sql = (
            "SELECT code, description, cause, action, severity, "
            "equipment_model, manufacturer "
            "FROM fault_codes WHERE (tenant_id = :tid OR tenant_id = :shared_tid) AND code = :code"
        )
        params: dict = {"tid": tenant_id, "code": code.upper(), "shared_tid": SHARED_TENANT_ID}
        if model:
            sql += " AND equipment_model ILIKE :model"
            params["model"] = f"%{model}%"

        with engine.connect() as conn:
            rows = conn.execute(text(sql), params).mappings().fetchall()

        results = [dict(r) for r in rows]
        if results:
            logger.info(
                "FAULT_CODE_LOOKUP code=%s model=%s hits=%d",
                code,
                model or "*",
                len(results),
            )
        return results
    except Exception as exc:
        logger.warning("Fault code lookup failed: %s", exc)
        return []


def _extract_product_names(query_text: str) -> list[str]:
    """Extract product/equipment names from raw user query."""
    if not query_text:
        return []
    return list({m.strip() for m in _PRODUCT_NAME_RE.findall(query_text)})


def _like_search(conn, text_fn, tenant_id: str, codes: list[str], limit: int) -> list[dict]:
    """Run ILIKE keyword search for fault codes against content column.

    Searches both the caller's tenant entries and the shared OEM knowledge pool.
    """
    if not codes:
        return []
    conditions = []
    params: dict = {"tid": tenant_id, "shared_tid": SHARED_TENANT_ID, "lim": limit}
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
        WHERE (tenant_id = :tid OR tenant_id = :shared_tid)
          AND ({where_clause})
        LIMIT :lim
    """)
    rows = conn.execute(sql, params).mappings().fetchall()
    return [dict(r) for r in rows]


def _product_search(
    conn,
    text_fn,
    tenant_id: str,
    products: list[str],
    embedding: list[float],
    limit: int,
) -> list[dict]:
    """Search by product name, reranked by vector similarity to the query.

    Filters to chunks from the product's manual (model_number match), then
    orders by cosine similarity to the user's query embedding. This surfaces
    the most RELEVANT chunks from the right manual — not just arbitrary rows.

    Searches both the caller's tenant entries and the shared OEM knowledge pool.
    """
    if not products:
        return []
    results: list[dict] = []
    seen: set[str] = set()

    for name in products[:3]:
        # Use word-boundary-safe pattern: "PowerFlex 40" must not match "PowerFlex 400"
        exact_pat = f"%{name}%"
        exclude_pat = f"%{name}0%"

        # CTE forces Postgres to materialize the filtered set BEFORE vector sort.
        # Without this, pgvector's IVFFlat index scans cells and filters post-scan,
        # returning far fewer results than LIMIT when matching rows are sparse
        # across index cells (e.g., 2 of 278 PF40 chunks).
        rows = (
            conn.execute(
                text_fn(
                    "WITH product_chunks AS ("
                    "  SELECT content, manufacturer, model_number, equipment_type, "
                    "  source_type, embedding "
                    "  FROM knowledge_entries "
                    "  WHERE (tenant_id = :tid OR tenant_id = :shared_tid) "
                    "  AND model_number ILIKE :pat "
                    "  AND model_number NOT ILIKE :exclude "
                    "  AND embedding IS NOT NULL"
                    ") "
                    "SELECT content, manufacturer, model_number, equipment_type, "
                    "source_type, "
                    "1 - (embedding <=> cast(:emb AS vector)) AS similarity "
                    "FROM product_chunks "
                    "ORDER BY embedding <=> cast(:emb AS vector) "
                    "LIMIT :lim"
                ),
                {
                    "tid": tenant_id,
                    "shared_tid": SHARED_TENANT_ID,
                    "pat": exact_pat,
                    "exclude": exclude_pat,
                    "emb": str(embedding),
                    "lim": limit,
                },
            )
            .mappings()
            .fetchall()
        )

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
    limit: int = 3,
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
            # Stage 1: Dense vector search — searches tenant entries + shared OEM pool
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
                    WHERE (tenant_id = :tid OR tenant_id = :shared_tid)
                      AND embedding IS NOT NULL
                    ORDER BY embedding <=> cast(:emb AS vector)
                    LIMIT :lim
                """),
                    {
                        "emb": str(embedding),
                        "tid": tenant_id,
                        "shared_tid": SHARED_TENANT_ID,
                        "lim": limit,
                    },
                )
                .mappings()
                .fetchall()
            )
            vector_results = [dict(r) for r in vector_rows if r["similarity"] >= MIN_SIMILARITY]

            # Stage 2: Fault code — structured lookup first, ILIKE fallback
            fault_codes = _extract_fault_codes(query_text)
            like_results: list[dict] = []
            structured_fault_results: list[dict] = []
            if fault_codes:
                # Try structured fault_codes table first (deterministic, fast)
                for fc in fault_codes[:3]:
                    fc_rows = recall_fault_code(fc, tenant_id)
                    for row in fc_rows:
                        # Format structured data as a pseudo-chunk for prompt injection
                        content = (
                            f"FAULT CODE {row['code']} — {row['description']}\n"
                            f"Equipment: {row.get('manufacturer', '')} {row.get('equipment_model', '')}\n"
                            f"Cause: {row.get('cause', 'Not specified')}\n"
                            f"Action: {row.get('action', 'Not specified')}\n"
                            f"Severity: {row.get('severity', 'Not specified')}"
                        )
                        structured_fault_results.append(
                            {
                                "content": content,
                                "manufacturer": row.get("manufacturer", ""),
                                "model_number": row.get("equipment_model", ""),
                                "equipment_type": "",
                                "source_type": "fault_code_table",
                                "similarity": 0.95,  # high confidence — deterministic match
                            }
                        )
                # ILIKE fallback for codes not in structured table
                if not structured_fault_results:
                    like_results = _like_search(conn, text, tenant_id, fault_codes, limit)

            # Stage 3: Product name search (vector-reranked within product's manual)
            product_names = _extract_product_names(query_text)
            product_results: list[dict] = []
            if product_names:
                product_results = _product_search(
                    conn, text, tenant_id, product_names, embedding, limit
                )

        # Merge and determine retrieval path
        results, retrieval_path = _merge_results(vector_results, like_results, product_results)

        # Structured fault codes go at the very top (highest confidence)
        if structured_fault_results:
            results = structured_fault_results + results
            retrieval_path = "structured_fault+" + retrieval_path

        top_vector_score = max((r.get("similarity", 0) for r in vector_results), default=0)
        logger.info(
            "NEON_RECALL tenant=%s hits=%d retrieval_path=%s "
            "fault_codes=%s products=%s top_vector_score=%.3f "
            "like_hits=%d product_hits=%d structured_faults=%d",
            tenant_id,
            len(results),
            retrieval_path,
            fault_codes or [],
            product_names or [],
            top_vector_score,
            len(like_results),
            len(product_results),
            len(structured_fault_results),
        )
        return results
    except Exception as exc:
        logger.warning("NeonDB recall failed: %s", exc)
        return []


def kb_has_coverage(
    vendor: str,
    query: str,
    tenant_id: str,
    min_chunks: int = 3,
) -> tuple[bool, list[dict]]:
    """Check if NeonDB has sufficient documentation chunks for vendor + optional model.

    vendor: manufacturer name (e.g. "AutomationDirect", "Pilz")
    query: raw user query — product names are extracted for model-scoped check
    tenant_id: caller's tenant (also searches shared OEM pool)
    min_chunks: minimum chunks required to consider KB covered (default 3)

    Returns (True, chunks) if covered — chunks are up to min_chunks sample rows.
    Returns (False, []) if not covered or on any error. Never raises.
    """
    url = os.environ.get("NEON_DATABASE_URL")
    if not url or not vendor or not tenant_id:
        return False, []

    try:
        from sqlalchemy import create_engine, text  # noqa: PLC0415
        from sqlalchemy.pool import NullPool  # noqa: PLC0415
    except ImportError:
        return False, []

    try:
        engine = create_engine(
            url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )
        vendor_pat = f"%{vendor}%"
        fetch_limit = min_chunks + 2

        with engine.connect() as conn:
            # Model-scoped check first — user named a specific model
            model_hints = _extract_product_names(query)
            if model_hints:
                model_pat = f"%{model_hints[0]}%"
                rows = conn.execute(
                    text("""
                        SELECT content, manufacturer, model_number
                        FROM knowledge_entries
                        WHERE (tenant_id = :tid OR tenant_id = :shared_tid)
                          AND manufacturer ILIKE :vendor
                          AND model_number ILIKE :model
                        ORDER BY id DESC
                        LIMIT :lim
                    """),
                    {
                        "tid": tenant_id,
                        "shared_tid": SHARED_TENANT_ID,
                        "vendor": vendor_pat,
                        "model": model_pat,
                        "lim": fetch_limit,
                    },
                ).mappings().fetchall()
                chunks = [dict(r) for r in rows]
                if len(chunks) >= min_chunks:
                    logger.info(
                        "KB_PRE_CHECK_HIT vendor=%r model=%r chunks=%d",
                        vendor,
                        model_hints[0],
                        len(chunks),
                    )
                    return True, chunks[:min_chunks]

            # Manufacturer-only check — any docs for this vendor?
            rows = conn.execute(
                text("""
                    SELECT content, manufacturer, model_number
                    FROM knowledge_entries
                    WHERE (tenant_id = :tid OR tenant_id = :shared_tid)
                      AND manufacturer ILIKE :vendor
                    ORDER BY id DESC
                    LIMIT :lim
                """),
                {
                    "tid": tenant_id,
                    "shared_tid": SHARED_TENANT_ID,
                    "vendor": vendor_pat,
                    "lim": fetch_limit,
                },
            ).mappings().fetchall()
            chunks = [dict(r) for r in rows]
            if len(chunks) >= min_chunks:
                logger.info(
                    "KB_PRE_CHECK_HIT vendor=%r model=* chunks=%d",
                    vendor,
                    len(chunks),
                )
                return True, chunks[:min_chunks]

            logger.info(
                "KB_PRE_CHECK_MISS vendor=%r query_models=%s chunks_found=%d",
                vendor,
                model_hints or [],
                len(chunks),
            )
            return False, []
    except Exception as exc:
        logger.warning("kb_has_coverage failed: %s", exc)
        return False, []
