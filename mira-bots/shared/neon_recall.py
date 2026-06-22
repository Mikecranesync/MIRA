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

from __future__ import annotations

import logging
import os
import re

logger = logging.getLogger("mira-gsd")

# Fault code patterns: F002, F-201, CE2, OC1, EF, E014, A501, etc.
_FAULT_CODE_RE = re.compile(r"\b[A-Za-z]{1,3}[-]?\d{1,4}\b")

# Compound alpha-alpha fault codes: E-OC, E-OV, E-UV, GF-A, etc.
# Matches LETTER(1-2) DASH LETTER(1-3) — missed by _FAULT_CODE_RE (no digits).
_COMPOUND_ALPHA_RE = re.compile(r"\b([A-Za-z]{1,2})-([A-Za-z]{1,3})\b")

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
        # Compound codes normalised to no-dash form for DB lookup
        "EOC",
        "EOV",
        "EUV",
        "ELF",
        "EOF",
        "EGF",
    }
)
_FAULT_CONTEXT_RE = re.compile(
    r"\b(fault|error|alarm|trip|code|warning|drive|vfd|inverter|showing|display|flashing|reading)\b",
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

# Equipment-aware reranking (page-picking fix, 2026-06-22). RRF is vendor-blind:
# "GS10 overcurrent" can rank a Yaskawa V1000 chunk above the GS10 one because
# both match the topic. When enabled, after RRF we overfetch candidates and float
# chunks whose manufacturer/model matches the query's extracted equipment to the
# top (positive boost only — no vendor denylist, so a real V1000 question still
# returns V1000). No equipment in the query => no-op. Plan:
# docs/plans/2026-06-22-retrieval-page-picking-equipment-rerank.md
EQUIPMENT_RERANK_ENABLED = os.getenv("MIRA_EQUIPMENT_RERANK", "0") == "1"
EQUIPMENT_RERANK_OVERFETCH = int(os.getenv("MIRA_EQUIPMENT_RERANK_OVERFETCH", "4"))

# Alias map so query tokens match how chunks spell the equipment (GS10 / GS-10 /
# GS 10; Micro820 / 2080-LC*). Extend as new families are served.
_EQUIPMENT_ALIASES: dict[str, set[str]] = {
    "gs11": {"gs11", "gs-11", "gs 11"},
    "gs10": {"gs10", "gs-10", "gs 10"},
    "gs20": {"gs20", "gs-20", "gs 20"},
    "gs30": {"gs30", "gs-30", "gs 30"},
    "micro820": {"micro820", "micro 820", "micro-820", "2080-lc20", "2080-lc30", "2080-lc"},
    "micro850": {"micro850", "micro 850", "2080-lc50"},
    "powerflex": {"powerflex", "power flex"},
    "compactlogix": {"compactlogix", "compact logix"},
    "controllogix": {"controllogix", "control logix"},
    "v1000": {"v1000", "v-1000"},
    "a1000": {"a1000", "a-1000"},
}

# Max distinct OR-terms in a BM25 tsquery. Direct-connection surfaces (the
# Ignition /ask kiosk) prepend a ~440-token MACHINE_CONTEXT block to every
# question, so an unbounded OR-fanout unions hundreds of GIN posting lists and
# ts_rank_cd scores most of the 83K-row table (31-45s observed, #1766). Capping
# the term count keeps the lexical safety net while collapsing latency. 32 is
# wide enough that an ordinary maintenance question loses nothing.
BM25_MAX_TERMS = int(os.getenv("MIRA_BM25_MAX_TERMS", "32"))


_COMMON_WORDS = frozenset(
    {
        "the",
        "and",
        "for",
        "with",
        "my",
        "your",
        "its",
        "has",
        "was",
        "are",
        "can",
        "not",
        "but",
        "that",
        "this",
        "what",
        "from",
        "how",
        "why",
        "when",
        "does",
        "did",
        "any",
        "all",
        "also",
        "just",
        "like",
        "get",
        "got",
        "see",
        "saw",
        "too",
        "our",
        "now",
        "try",
        "fix",
        "on",
        "in",
        "it",
        "is",
        "an",
        "to",
        "do",
        "so",
        "if",
        "of",
        "at",
        "by",
        "up",
        "we",
        "be",
        "or",
        "no",
        "ok",
        "as",
        "he",
        "she",
        "they",
        "them",
        "his",
        "her",
        "its",
        "out",
        "off",
        "had",
        "may",
        "will",
        "let",
        "run",
        "set",
        "use",
    }
)


def _normalise_fault_query(query_text: str) -> str:
    """Normalise user input before fault code extraction.

    Targeted normalizations only — avoids converting normal English word pairs:
      "E OC"  → "E-OC"  (single uppercase letter + space + alpha token)
      "F 02"  → "F-02"  (letter + space + digit sequence)
    """
    # Letter + space + digits: "F 02" → "F-02", "E 014" → "E-014"
    normalised = re.sub(r"\b([A-Za-z]{1,3})\s+(\d{1,4})\b", r"\1-\2", query_text)

    # Single/double uppercase letter + space + uppercase alpha token: "E OC" → "E-OC"
    # Only when left token is 1-2 chars and looks like a prefix (not a common word)
    def _maybe_join(m: re.Match) -> str:
        left, right = m.group(1), m.group(2)
        if left.lower() in _COMMON_WORDS or right.lower() in _COMMON_WORDS:
            return m.group(0)
        if len(left) <= 2:
            return f"{left}-{right}"
        return m.group(0)

    normalised = re.sub(r"\b([A-Za-z]{1,2})\s+([A-Za-z]{2,4})\b", _maybe_join, normalised)
    return normalised


def _extract_fault_codes(query_text: str) -> list[str]:
    """Extract fault code tokens from raw user query.

    Permissive — accepts common syntax errors and spacing variations:
      1. Alphanumeric codes: F4, F-012, OC1, A501, E014
      2. Compound alpha codes: E-OC, E-OV, GF-A (letter-dash-letter)
      3. Alpha-only VFD codes: OC, GF, OH — with or without fault-context words
      4. No-dash variants tried alongside dashed form for all of the above
    """
    if not query_text:
        return []

    normalised = _normalise_fault_query(query_text)
    codes: set[str] = set()

    # Pattern 1: alphanumeric codes (original)
    for m in _FAULT_CODE_RE.findall(normalised):
        codes.add(m.upper())

    # Pattern 2: compound alpha-alpha codes like E-OC, E-OV
    for m in _COMPOUND_ALPHA_RE.finditer(normalised):
        dashed = m.group(0).upper()  # "E-OC"
        nodash = (m.group(1) + m.group(2)).upper()  # "EOC"
        codes.add(dashed)
        codes.add(nodash)

    # Pattern 3: alpha-only VFD codes — check with and without fault context
    has_fault_context = bool(_FAULT_CONTEXT_RE.search(query_text))
    for word in normalised.upper().split():
        cleaned = word.strip(".,!?:;()\"'-")
        if cleaned in _VFD_ALPHA_CODES:
            codes.add(cleaned)
        # Also try stripping a leading "E-" prefix (Yaskawa E-series style)
        if cleaned.startswith("E-") and cleaned[2:] in _VFD_ALPHA_CODES:
            codes.add(cleaned)  # keep full "E-OC"
            codes.add(cleaned[2:])  # also try bare "OC"

    # Fallback: if still empty and fault context present, scan original text too
    if not codes and has_fault_context:
        for word in query_text.upper().split():
            cleaned = word.strip(".,!?:;()\"'-")
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

    Query construction: OR-fanout via `to_tsquery('english', 't1 | t2 | …')`.
    plainto_tsquery ANDs every term — fatal for maintenance queries like
    "modbus parameters word write GS11 drive" where no single doc contains
    all six. OR-joining means a doc matches if ANY token hits; ts_rank_cd
    still rewards docs that match MORE tokens, so multi-term matches rank
    higher than single-term ones. Tokens are stripped to `\\w+` to keep the
    tsquery parser-safe (no need to escape `&|!():*`).

    Term bounding (#1766): the query is built from at most BM25_MAX_TERMS
    distinct tokens, dropping pure-digit and ≤2-char tokens (IP/port/register
    fragments like "192", "502", "1" have huge GIN posting lists that match
    most of the table) and the local stopword list. Postgres' 'english' config
    already strips English stopwords inside to_tsquery, so dedupe + drop-noise
    + cap are the levers that matter. Without this, the /ask kiosk's ~440-token
    MACHINE_CONTEXT prefix produced a ~438-term OR-fanout → 31-45s. Selective
    technical terms (gs10, ce10, modbus, undervoltage) survive, so the lexical
    safety net — and embed-down grounding — is preserved.

    Returns [] if query_text is blank, has no usable tokens, or the query
    fails — never raises. The tsquery `@@` predicate is a hard gate, so
    MIN_SIMILARITY filtering is not applied here. Searches both the caller's
    tenant entries and the shared OEM pool.
    """
    if not query_text or not query_text.strip():
        return []
    raw_tokens = re.findall(r"\w+", query_text.lower())
    if not raw_tokens:
        return []
    seen_tok: set[str] = set()
    tokens: list[str] = []
    for tok in raw_tokens:
        if tok in seen_tok:
            continue
        seen_tok.add(tok)
        if len(tok) <= 2 or tok.isdigit() or tok in _COMMON_WORDS:
            continue
        tokens.append(tok)
        if len(tokens) >= BM25_MAX_TERMS:
            break
    # Never-empty fallback: a terse query ("OC", "F4", "oC1") can have every
    # token filtered out. Fall back to the deduped raw tokens (capped) so the
    # lexical stream still runs rather than silently returning [].
    if not tokens:
        tokens = list(dict.fromkeys(raw_tokens))[:BM25_MAX_TERMS]
    ts_query = " | ".join(tokens)
    try:
        rows = (
            conn.execute(
                text_fn(
                    "SELECT content, manufacturer, model_number, equipment_type, "
                    "source_type, source_url, source_page, metadata, "
                    "ts_rank_cd(content_tsv, to_tsquery('english', :tsq)) AS similarity "
                    "FROM knowledge_entries "
                    "WHERE (tenant_id = :tid OR tenant_id = :shared_tid) "
                    "  AND content_tsv @@ to_tsquery('english', :tsq) "
                    "ORDER BY similarity DESC "
                    "LIMIT :lim"
                ),
                {
                    "tsq": ts_query,
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
        # Tag vector-only output so the rag_worker quality gate can apply
        # the cosine threshold without conflating non-vector scores.
        tagged = [dict(r, retrieval_streams=["vector"]) for r in vector_results]
        return tagged, "vector_only"

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
    # for the similarity field, and which streams contributed for each row so
    # the rag_worker quality gate can apply the cosine threshold ONLY to
    # vector-originated chunks (BM25 ts_rank_cd and ILIKE hardcoded 0.5 are
    # not cosine-comparable).
    scores: dict[str, float] = {}
    best_row: dict[str, dict] = {}
    best_priority: dict[str, int] = {}
    stream_membership: dict[str, set[str]] = {}

    for stream_name, rows in streams.items():
        prio = _STREAM_PRIORITY[stream_name]
        for rank, row in enumerate(rows, start=1):
            key = row["content"][:100]
            scores[key] = scores.get(key, 0.0) + 1.0 / (RRF_K + rank)
            stream_membership.setdefault(key, set()).add(stream_name)
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
        row["retrieval_streams"] = sorted(stream_membership.get(key, set()))
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


def _equipment_tokens(equipment_list: list[str]) -> set[str]:
    """Map extracted equipment names to the substring set chunks may use."""
    tokens: set[str] = set()
    for tag in equipment_list:
        key = tag.lower().strip()
        tokens |= _EQUIPMENT_ALIASES.get(key, {key})
    return tokens


def _rerank_for_equipment(rows: list[dict], query_text: str) -> list[dict]:
    """Float chunks matching the query's equipment to the top (stable).

    Positive boost only: +5 per equipment token in manufacturer/model, +1 per
    token in content-only. Non-matching chunks keep their RRF order below the
    matches (tie-break by original index). No vendor denylist — a question about
    a V1000 still returns V1000. No equipment extracted => unchanged order.

    Ported to production from the bench harness (`tests/mira_bench.py
    _rerank_for_equipment`), which was the ONLY place this ran — so live surfaces
    shipped vendor-blind retrieval (e.g. "GS10 overcurrent" -> Yaskawa V1000 #1).
    """
    equipment = _extract_product_names(query_text)
    if not equipment:
        return rows
    tokens = _equipment_tokens(equipment)
    scored: list[tuple[int, int, dict]] = []
    for idx, ch in enumerate(rows):
        meta_blob = " ".join(
            [str(ch.get("manufacturer") or ""), str(ch.get("model_number") or "")]
        ).lower()
        content_blob = str(ch.get("content") or "").lower()
        meta_pos = sum(1 for tok in tokens if tok in meta_blob)
        content_pos = sum(1 for tok in tokens if tok in content_blob and tok not in meta_blob)
        score = 5 * meta_pos + 1 * content_pos
        scored.append((-score, idx, ch))
    scored.sort(key=lambda t: (t[0], t[1]))
    return [t[2] for t in scored]


def recall_knowledge(
    embedding: list[float] | None,
    tenant_id: str,
    limit: int = 3,
    query_text: str = "",
) -> list[dict]:
    """Hybrid retrieval: vector + fault code + product name + BM25.

    When `embedding` is None or empty (e.g. Ollama embed sidecar unreachable),
    vector and product-name stages are skipped but BM25, structured fault, and
    ILIKE-fault stages still run. Pre-fix the function early-returned []
    whenever the embedding was missing, which short-circuited BM25 even
    though it doesn't need an embedding — the GS11 demo regression.

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
    if not tenant_id:
        return []
    has_embedding: bool = bool(embedding)
    if not has_embedding:
        logger.info(
            "NEON_RECALL_NO_EMBEDDING tenant=%s — vector + product stages skipped, "
            "lexical streams (BM25/fault/structured) still run",
            tenant_id,
        )

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
            # Overfetch candidates when equipment rerank is on, so a right-vendor
            # chunk ranked just outside `limit` can be floated to the top before
            # truncation. Disabled => eff_limit == limit (no behavior change).
            eff_limit = (
                limit * EQUIPMENT_RERANK_OVERFETCH
                if (EQUIPMENT_RERANK_ENABLED and limit)
                else limit
            )

            # Stage 1: Dense vector search — searches tenant entries + shared OEM pool.
            # Skipped when the embedding sidecar was unreachable (has_embedding=False);
            # BM25 + structured-fault stages below carry the load in that case.
            vector_results: list[dict] = []
            if has_embedding:
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
                            "lim": eff_limit,
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
                                "retrieval_streams": ["structured_fault"],
                            }
                        )
                # ILIKE fallback for codes not in structured table
                if not structured_fault_results:
                    like_results = _like_search(conn, text, tenant_id, fault_codes, limit)

            # Stage 3: Product name search (vector-reranked within product's manual).
            # Vector-rerank requires an embedding; if none, skip — BM25 still
            # surfaces product-matching chunks via lexical match below.
            product_names = _extract_product_names(query_text)
            product_results: list[dict] = []
            if product_names and has_embedding:
                product_results = _product_search(
                    conn, text, tenant_id, product_names, embedding, eff_limit
                )

            # Stage 4: BM25 keyword stream (Unit 6). Pulled alongside vector
            # so RRF can fuse the ranks. Fetch 2x limit so the merge has
            # enough candidates for cross-stream agreement to surface.
            bm25_results: list[dict] = []
            if HYBRID_ENABLED:
                bm25_results = _recall_bm25(
                    conn, text, tenant_id, query_text, eff_limit * 2 if eff_limit else 6
                )

        # Merge via RRF; truncate to `limit` after fusion so cross-stream
        # agreement has a chance to surface lower-ranked chunks.
        results, retrieval_path = _merge_results(
            vector_results,
            like_results,
            product_results,
            bm25_results=bm25_results,
            limit=eff_limit,
        )

        # Equipment-aware rerank (vendor-blind RRF fix). Floats query-equipment
        # chunks to the top of the overfetched pool, then truncate to `limit`.
        # Disabled => no-op (eff_limit == limit, slice is a no-op).
        if EQUIPMENT_RERANK_ENABLED and results:
            reranked = _rerank_for_equipment(results, query_text)
            if reranked is not results:  # equipment extracted from the query
                results = reranked
                retrieval_path = "eqrerank+" + retrieval_path
        if limit:
            results = results[:limit]

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
            # Drop the embedding-not-null filter — a row reachable only via
            # BM25 (content_tsv) is still KB coverage, and the pre-check
            # otherwise misses freshly-seeded rows whose embeddings haven't
            # been backfilled yet (the #1308 demo blocker — seeded
            # gs10/gs11 rows had NULL embeddings and were invisible to
            # this pre-check, so the engine routed every Modbus question
            # to the LLM hallucination fallback).
            row = conn.execute(
                text(
                    """
                    SELECT COUNT(*) AS cnt
                    FROM knowledge_entries
                    WHERE (tenant_id = :tid OR tenant_id = :shared_tid)
                      AND LOWER(manufacturer) LIKE LOWER(:vendor_pat)
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


KB_PAIR_COVERAGE_MIN_CHUNKS = int(os.getenv("MIRA_KB_PAIR_COVERAGE_MIN_CHUNKS", "1"))


def kb_has_pair_coverage(vendor: str, model: str, tenant_id: str) -> tuple[bool, int]:
    """Strict-pair coverage probe — does the KB have chunks tagged with BOTH
    this vendor AND this model?

    Distinct from ``kb_has_coverage`` (vendor-only). Used to catch chimeric
    pairings like ("AutomationDirect", "820") — the resolver can name them,
    but no row in ``knowledge_entries`` has them together, so the count is
    zero and the caller drops the candidate before speaking it.

    Returns (covered, count). ``covered`` is True when count ≥
    ``KB_PAIR_COVERAGE_MIN_CHUNKS`` (default 1 — any chunk counts as proof
    the pair exists). Tunable via ``MIRA_KB_PAIR_COVERAGE_MIN_CHUNKS``.

    Never raises. Blank vendor or model returns (False, 0). Missing
    NEON_DATABASE_URL returns (False, 0). Any DB error returns (False, -1)
    so callers can distinguish "no rows" from "couldn't check" if they
    want to fail open in failure scenarios.
    """
    vendor_clean = vendor.strip()
    model_clean = model.strip()
    if not vendor_clean or not model_clean:
        return False, 0

    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        return False, 0

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
                      AND LOWER(model_number) LIKE LOWER(:model_pat)
                      AND embedding IS NOT NULL
                    """
                ),
                {
                    "tid": tenant_id,
                    "shared_tid": SHARED_TENANT_ID,
                    "vendor_pat": f"%{vendor_clean}%",
                    "model_pat": f"%{model_clean}%",
                },
            ).fetchone()
        count = int(row[0]) if row else 0
        covered = count >= KB_PAIR_COVERAGE_MIN_CHUNKS
        if covered:
            logger.info(
                "KB_PAIR_COVERAGE_HIT vendor=%r model=%r count=%d threshold=%d",
                vendor_clean,
                model_clean,
                count,
                KB_PAIR_COVERAGE_MIN_CHUNKS,
            )
        else:
            logger.info(
                "KB_PAIR_COVERAGE_MISS vendor=%r model=%r count=%d threshold=%d",
                vendor_clean,
                model_clean,
                count,
                KB_PAIR_COVERAGE_MIN_CHUNKS,
            )
        return covered, count
    except Exception as exc:
        logger.warning("kb_has_pair_coverage failed: %s", exc)
        return False, -1
