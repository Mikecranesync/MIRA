"""Thin NeonDB pgvector recall client for bot containers.

Primary function: recall_knowledge(embedding, tenant_id, limit, query_text).
All imports are lazy — returns [] gracefully if sqlalchemy is missing,
NEON_DATABASE_URL is unset, or the query fails.

Hybrid retrieval (Unit 6 of 90-day MVP):
  Stage 1: Dense cosine vector search (pgvector)
  Stage 2: Fault code — structured fault_codes table; ILIKE fallback
  Stage 3: Product-name search (vector-reranked within the product's manual)
  Stage 4: BM25 keyword match (tsvector + ts_rank_cd, GIN index)
Streams (1, 2-ILIKE, 3, 4) are fused via Reciprocal Rank Fusion (k=60).
Structured fault-code hits bypass RRF — they are deterministic and always
promoted to the top. Results below MIN_SIMILARITY are filtered from the
vector stream only; BM25 hits survive based on tsquery match.

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

# Hybrid retrieval (Unit 6) — kill switch. Set to "false" to disable the BM25
# stream and fall back to pre-Unit-6 vector+ILIKE+product behavior. RRF merge
# degrades gracefully to positional priority when BM25 is empty.
HYBRID_ENABLED = os.getenv("MIRA_RETRIEVAL_HYBRID_ENABLED", "true").lower() == "true"

# Reciprocal Rank Fusion constant (Cormack et al. 2009). 60 is the canonical
# default — small enough that top ranks dominate, large enough that mid-rank
# agreements across streams still contribute.
RRF_K = int(os.getenv("MIRA_RRF_K", "60"))


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
            source_url,
            source_page,
            metadata,
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
                    "  source_type, source_url, source_page, metadata, embedding "
                    "  FROM knowledge_entries "
                    "  WHERE (tenant_id = :tid OR tenant_id = :shared_tid) "
                    "  AND model_number ILIKE :pat "
                    "  AND model_number NOT ILIKE :exclude "
                    "  AND embedding IS NOT NULL"
                    ") "
                    "SELECT content, manufacturer, model_number, equipment_type, "
                    "source_type, source_url, source_page, metadata, "
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


def _recall_bm25(
    conn,
    text_fn,
    tenant_id: str,
    query_text: str,
    limit: int,
) -> list[dict]:
    """BM25 keyword stream via tsvector + ts_rank_cd.

    Uses the GIN index idx_knowledge_entries_content_tsv (migration 004).
    Returns rows with the same dict shape as the vector stream — `similarity`
    holds the raw ts_rank_cd score (typically 0.01–1.0, NOT comparable to the
    cosine similarity used elsewhere). BM25 scores feed RRF by rank, not by
    magnitude, so the scale mismatch is irrelevant to fusion.

    Returns [] if query_text is blank or the query fails — never raises.
    The `content_tsv @@ plainto_tsquery(...)` predicate acts as a hard gate:
    no match → no row, so MIN_SIMILARITY filtering is not applied here.
    Searches both the caller's tenant entries and the shared OEM pool.
    """
    if not query_text or not query_text.strip():
        return []
    try:
        rows = (
            conn.execute(
                text_fn(
                    "SELECT content, manufacturer, model_number, equipment_type, "
                    "source_type, source_url, source_page, metadata, "
                    "ts_rank_cd(content_tsv, plainto_tsquery('english', :q)) AS similarity "
                    "FROM knowledge_entries "
                    "WHERE (tenant_id = :tid OR tenant_id = :shared_tid) "
                    "  AND content_tsv @@ plainto_tsquery('english', :q) "
                    "ORDER BY similarity DESC "
                    "LIMIT :lim"
                ),
                {
                    "q": query_text,
                    "tid": tenant_id,
                    "shared_tid": SHARED_TENANT_ID,
                    "lim": limit,
                },
            )
            .mappings()
            .fetchall()
        )
        return [dict(r) for r in rows]
    except Exception as exc:
        # Most likely cause: migration 004 not yet applied → content_tsv missing.
        # Degrade silently; RRF merge still works with 3 streams.
        logger.warning("BM25 recall failed (migration 004 applied?): %s", exc)
        return []


def _merge_results(
    vector_results: list[dict],
    like_results: list[dict],
    product_results: list[dict],
    bm25_results: list[dict] | None = None,
    limit: int | None = None,
) -> tuple[list[dict], str]:
    """Fuse retrieval streams via Reciprocal Rank Fusion (RRF, k=RRF_K).

    Each stream contributes `1 / (k + rank_in_stream)` per document it returns
    (rank is 1-indexed after in-stream deduplication). A document's final
    score is the sum across the streams that found it — cross-stream
    agreement dominates, which is exactly what hybrid retrieval needs:
    fault-code chunks that rank well under BOTH vector and BM25 outscore
    chunks that shine in only one.

    Deduplication key: content[:100] (unchanged from prior merge).
    When bm25_results is None (feature flag off) or empty, behaves as a 3-way
    RRF over vector/like/product — no behavior regression.

    Each output row gains a `rrf_score` key for observability; `similarity`
    is preserved from the highest-ranked stream that found the row (vector
    wins ties, then product, then BM25, then like) so downstream consumers
    that reason about cosine similarity (MIN_SIMILARITY gates, KB coverage
    logs) keep working.

    Returns (merged_list[:limit if set else all], retrieval_path).
    """
    bm25_results = bm25_results or []

    if not like_results and not product_results and not bm25_results:
        return vector_results, "vector_only"

    # Stream priority for similarity-field tiebreak (higher = preferred source
    # for the displayed `similarity` value). Does NOT affect RRF scoring.
    _STREAM_PRIORITY = {"vector": 4, "product": 3, "bm25": 2, "like": 1}

    def _stream_dedup(rows: list[dict]) -> list[dict]:
        seen: set[str] = set()
        out: list[dict] = []
        for r in rows:
            key = r["content"][:100]
            if key not in seen:
                seen.add(key)
                out.append(r)
        return out

    streams: dict[str, list[dict]] = {
        "vector": _stream_dedup(vector_results),
        "product": _stream_dedup(product_results),
        "bm25": _stream_dedup(bm25_results),
        "like": _stream_dedup(like_results),
    }

    # Accumulate RRF scores keyed by content[:100]; track best-priority stream
    # for the similarity field.
    scores: dict[str, float] = {}
    best_row: dict[str, dict] = {}
    best_priority: dict[str, int] = {}

    for stream_name, rows in streams.items():
        prio = _STREAM_PRIORITY[stream_name]
        for rank, row in enumerate(rows, start=1):
            key = row["content"][:100]
            scores[key] = scores.get(key, 0.0) + 1.0 / (RRF_K + rank)
            if key not in best_row or prio > best_priority[key]:
                best_row[key] = row
                best_priority[key] = prio

    # Sort by RRF score desc; stable tiebreak by stream priority then vector rank.
    ordered_keys = sorted(
        scores.keys(),
        key=lambda k: (-scores[k], -best_priority[k]),
    )

    merged: list[dict] = []
    for key in ordered_keys:
        row = dict(best_row[key])
        row["rrf_score"] = round(scores[key], 6)
        merged.append(row)

    # Decide retrieval_path label — kept shape-compatible with prior callers
    # that log/group by it.
    has = {name: bool(rows) for name, rows in streams.items()}
    if has["bm25"] and (has["product"] or has["like"]):
        path = "rrf_hybrid_bm25+kw"
    elif has["bm25"]:
        path = "rrf_hybrid_bm25"
    elif has["product"] and has["like"]:
        path = "rrf_kw"
    elif has["product"]:
        path = "rrf_product"
    else:
        path = "rrf_like"

    if limit is not None:
        merged = merged[:limit]
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
                        source_url,
                        source_page,
                        metadata,
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
                                "source_url": None,
                                "source_page": None,
                                "metadata": {"section": "Fault Code Table"},
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

            # Stage 4: BM25 keyword stream (Unit 6). Pulled alongside vector
            # so RRF can fuse the ranks. Fetch 2x limit so the merge has
            # enough candidates for cross-stream agreement to surface.
            bm25_results: list[dict] = []
            if HYBRID_ENABLED:
                bm25_results = _recall_bm25(
                    conn, text, tenant_id, query_text, limit * 2 if limit else 6
                )

        # Merge via RRF; truncate to `limit` after fusion so cross-stream
        # agreement has a chance to surface lower-ranked chunks.
        results, retrieval_path = _merge_results(
            vector_results,
            like_results,
            product_results,
            bm25_results=bm25_results,
            limit=limit,
        )

        # Structured fault codes go at the very top (highest confidence,
        # deterministic — bypass RRF).
        if structured_fault_results:
            results = structured_fault_results + results
            retrieval_path = "structured_fault+" + retrieval_path

        top_vector_score = max((r.get("similarity", 0) for r in vector_results), default=0)
        logger.info(
            "NEON_RECALL tenant=%s hits=%d retrieval_path=%s "
            "fault_codes=%s products=%s top_vector_score=%.3f "
            "like_hits=%d product_hits=%d structured_faults=%d bm25_hits=%d",
            tenant_id,
            len(results),
            retrieval_path,
            fault_codes or [],
            product_names or [],
            top_vector_score,
            len(like_results),
            len(product_results),
            len(structured_fault_results),
            len(bm25_results),
        )
        return results
    except Exception as exc:
        logger.warning("NeonDB recall failed: %s", exc)
        return []


# ---------------------------------------------------------------------------
# KB coverage pre-check
# ---------------------------------------------------------------------------

# Minimum number of chunks that must exist for a vendor to be considered
# "covered" in the knowledge base.  Configurable so ops can tune without deploy.
KB_COVERAGE_MIN_CHUNKS = int(os.getenv("MIRA_KB_COVERAGE_MIN_CHUNKS", "3"))


def kb_has_coverage(vendor: str, model: str, tenant_id: str) -> tuple[bool, str]:
    """Return (True, reason) if the KB has ≥KB_COVERAGE_MIN_CHUNKS chunks for vendor.

    Uses a direct COUNT query against NeonDB — no embedding required.
    Checks both tenant-scoped entries and the shared OEM pool.

    Args:
        vendor: Manufacturer name (e.g. "AutomationDirect", "Yaskawa").
        model:  Model string — currently used only for logging (future: row filter).
        tenant_id: Active tenant for the conversation.

    Returns:
        (True,  "kb_N_chunks")         — KB has coverage, N ≥ KB_COVERAGE_MIN_CHUNKS
        (False, "kb_only_N_chunks")    — KB exists but below threshold
        (False, "no_vendor")           — vendor is blank / undetectable
        (False, "no_neon_url")         — NEON_DATABASE_URL not set
        (False, "error_<ExcType>")     — any DB failure
    Never raises.
    """
    vendor_clean = vendor.strip()
    if not vendor_clean:
        return False, "no_vendor"

    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        return False, "no_neon_url"

    try:
        from sqlalchemy import create_engine, text  # noqa: PLC0415
        from sqlalchemy.pool import NullPool  # noqa: PLC0415

        engine = create_engine(
            url,
            poolclass=NullPool,
            connect_args={"sslmode": "require"},
            pool_pre_ping=True,
        )
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT COUNT(*) AS cnt
                    FROM knowledge_entries
                    WHERE (tenant_id = :tid OR tenant_id = :shared_tid)
                      AND LOWER(manufacturer) LIKE LOWER(:vendor_pat)
                      AND embedding IS NOT NULL
                    """
                ),
                {
                    "tid": tenant_id,
                    "shared_tid": SHARED_TENANT_ID,
                    "vendor_pat": f"%{vendor_clean}%",
                },
            ).fetchone()
        count = int(row[0]) if row else 0
        if count >= KB_COVERAGE_MIN_CHUNKS:
            logger.info(
                "KB_PRE_CHECK_HIT vendor=%r model=%r count=%d threshold=%d",
                vendor_clean,
                model,
                count,
                KB_COVERAGE_MIN_CHUNKS,
            )
            return True, f"kb_{count}_chunks"
        logger.info(
            "KB_PRE_CHECK_MISS vendor=%r model=%r count=%d threshold=%d",
            vendor_clean,
            model,
            count,
            KB_COVERAGE_MIN_CHUNKS,
        )
        return False, f"kb_only_{count}_chunks"
    except Exception as exc:
        logger.warning("kb_has_coverage failed: %s", exc)
        return False, f"error_{type(exc).__name__}"
