"""3-stage quality gate for KB chunk insertion.

Runs before every INSERT to filter low-quality, irrelevant, or duplicate chunks.
All stages use Ollama embeddings only — zero cloud API cost.

Stages (fail-fast, in order):
  1. Content filter  — heuristics, no LLM
  2. Relevance score — cosine sim vs 10 industrial-maintenance anchor texts
  3. Semantic dedup  — pgvector nearest-neighbor against existing KB

Always fails open: if any stage raises an unexpected exception the gate
returns (True, "error_fail_open") so ingest is never blocked by gate failures.
"""

from __future__ import annotations

import json
import logging
import math
import os
from pathlib import Path

logger = logging.getLogger("mira-crawler.quality")

# ---------------------------------------------------------------------------
# Configurable thresholds
# ---------------------------------------------------------------------------
_RELEVANCE_THRESHOLD = float(os.getenv("QUALITY_RELEVANCE_THRESHOLD", "0.35"))
_DEDUP_THRESHOLD = float(os.getenv("QUALITY_DEDUP_THRESHOLD", "0.95"))

# ---------------------------------------------------------------------------
# Anchor state (module-level cache, populated on first call)
# ---------------------------------------------------------------------------
_ANCHORS_PATH = Path(__file__).parent / "anchors.json"
_anchor_embeddings: list[list[float]] | None = None


# ---------------------------------------------------------------------------
# Pure-Python helpers
# ---------------------------------------------------------------------------

def _cosine_sim(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two equal-length vectors.  Returns 0.0 on error."""
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0.0 or mag_b == 0.0:
        return 0.0
    return dot / (mag_a * mag_b)


# ---------------------------------------------------------------------------
# Anchor loading & caching
# ---------------------------------------------------------------------------

def _load_anchors() -> list[list[float]]:
    """Return cached anchor embeddings, generating them on first call.

    Embeddings are persisted to anchors.json so Ollama is only called once
    per deploy.  On any error, returns an empty list (gate will skip stage 2).
    """
    global _anchor_embeddings  # noqa: PLW0603

    if _anchor_embeddings is not None:
        return _anchor_embeddings

    try:
        with open(_ANCHORS_PATH) as fh:
            data = json.load(fh)
    except Exception as exc:
        logger.warning("Cannot read anchors.json: %s — relevance stage disabled", exc)
        _anchor_embeddings = []
        return _anchor_embeddings

    cached = data.get("anchor_embeddings", [])
    anchors = data.get("anchors", [])

    # Validate that every cached vector is non-empty before trusting the cache.
    # An empty vector signals a previous run where Ollama was down; we must
    # regenerate rather than silently poisoning every relevance score with 0.0.
    if cached and len(cached) == len(anchors) and all(v for v in cached):
        _anchor_embeddings = cached
        return _anchor_embeddings

    if cached and not all(v for v in cached):
        logger.warning(
            "anchors.json contains empty vectors — cache invalid, regenerating embeddings"
        )

    # Generate embeddings for any anchors that don't have one yet
    logger.info("Generating %d anchor embeddings (one-time setup)...", len(anchors))
    try:
        from ingest.embedder import embed_text
    except ImportError:
        logger.warning("Cannot import embed_text — relevance stage disabled")
        _anchor_embeddings = []
        return _anchor_embeddings

    embeddings: list[list[float]] = []
    failed = 0
    for i, text in enumerate(anchors):
        vec = embed_text(text)
        if vec:
            embeddings.append(vec)
        else:
            logger.warning("Anchor embedding failed for: %s...", text[:60])
            failed += 1
            # Keep a placeholder so indices stay aligned for in-memory use,
            # but this run's embeddings will NOT be persisted (see below).
            embeddings.append([])

    # Always update the in-memory cache so this run can use whatever succeeded.
    _anchor_embeddings = embeddings

    if failed:
        # Partial failure: do NOT write to disk.  Next run will retry.
        logger.warning(
            "Ollama embedding failed for %d/%d anchors — cache not persisted, will retry next run",
            failed,
            len(anchors),
        )
    else:
        # All embeddings succeeded — safe to persist.
        try:
            data["anchor_embeddings"] = embeddings
            with open(_ANCHORS_PATH, "w") as fh:
                json.dump(data, fh, indent=2)
            logger.info("Anchor embeddings saved to anchors.json")
        except Exception as exc:
            logger.warning("Could not persist anchor embeddings: %s", exc)

    return _anchor_embeddings


# ---------------------------------------------------------------------------
# Stage helpers
# ---------------------------------------------------------------------------

def _relevance_score(embedding: list[float]) -> float:
    """Max cosine similarity of *embedding* against all anchor embeddings."""
    anchors = _load_anchors()
    if not anchors:
        return 1.0  # No anchors available — pass stage by default

    best = 0.0
    for anchor_vec in anchors:
        if not anchor_vec:
            continue
        sim = _cosine_sim(embedding, anchor_vec)
        if sim > best:
            best = sim
    return best


def _semantic_dedup_score(
    embedding: list[float],
    tenant_id: str,
    conn=None,
) -> float:
    """Return cosine similarity to the nearest existing chunk in NeonDB.

    Uses pgvector <=> operator (cosine distance).  Returns 0.0 on any error
    so the gate fails open rather than blocking ingest.

    Args:
        embedding: Query vector.
        tenant_id: Tenant scope for the query.
        conn: Optional SQLAlchemy connection. When provided, the caller owns
              the connection (one TLS handshake shared across many chunks).
              When None, we open and close a one-shot connection per call.
    """
    try:
        from sqlalchemy import text

        vec_str = str(embedding)
        sql = text("""
            SELECT 1 - (embedding <=> cast(:vec AS vector)) AS similarity
            FROM knowledge_entries
            WHERE tenant_id = :tid
            ORDER BY embedding <=> cast(:vec AS vector)
            LIMIT 1
        """)
        params = {"vec": vec_str, "tid": tenant_id}

        if conn is not None:
            row = conn.execute(sql, params).fetchone()
        else:
            from ingest.store import _engine

            with _engine().connect() as own_conn:
                row = own_conn.execute(sql, params).fetchone()

        if row is None:
            return 0.0
        return float(row[0])
    except Exception as exc:
        logger.debug("Semantic dedup query failed (fail open): %s", exc)
        return 0.0


# ---------------------------------------------------------------------------
# Main gate
# ---------------------------------------------------------------------------

def quality_gate(
    chunk: dict,
    embedding: list[float],
    tenant_id: str,
    conn=None,
) -> tuple[bool, str]:
    """Run 3-stage quality gate on a chunk before DB insertion.

    Args:
        chunk:     Chunk dict with at least a 'text' key.
        embedding: Pre-computed Ollama embedding for the chunk text.
        tenant_id: Tenant scope for semantic dedup query.
        conn: Optional SQLAlchemy connection for the dedup query. When a
              caller ingests many chunks from the same document, passing a
              shared connection avoids a TLS handshake per chunk (#112).

    Returns:
        (True, "")                         — chunk passes all stages
        (False, reason_str)                — chunk rejected; reason encodes which stage failed
        (True, "error_fail_open:{exc_type}") — unexpected exception; ingest is never blocked

    Always fails open: if any stage raises an unexpected exception the gate
    returns (True, "error_fail_open:{exc_type}") so ingest is never blocked by
    gate failures.  Defence-in-depth: the caller (tasks/ingest.py) also wraps
    the call in try/except, but this guard ensures the gate is safe regardless.
    """
    try:
        text = chunk.get("text", "")

        # ------------------------------------------------------------------
        # Stage 1: Content filter (heuristic, no LLM, no network)
        # ------------------------------------------------------------------
        if len(text) < 80:
            return False, "too_short"

        alpha_chars = sum(1 for c in text if c.isalpha())
        ratio = alpha_chars / len(text)
        if ratio < 0.5:
            return False, f"low_alpha:{ratio:.2f}"

        sentence_endings = sum(1 for c in text if c in ".!?")
        if sentence_endings < 2:
            return False, "too_few_sentences"

        # ------------------------------------------------------------------
        # Stage 2: Relevance (cosine sim vs anchor embeddings)
        # ------------------------------------------------------------------
        rel_score = _relevance_score(embedding)
        if rel_score < _RELEVANCE_THRESHOLD:
            return False, f"low_relevance:{rel_score:.3f}"

        # ------------------------------------------------------------------
        # Stage 3: Semantic dedup (pgvector nearest neighbor)
        # ------------------------------------------------------------------
        dedup_score = _semantic_dedup_score(embedding, tenant_id, conn=conn)
        if dedup_score > _DEDUP_THRESHOLD:
            return False, f"near_duplicate:{dedup_score:.3f}"

        return True, ""

    except Exception as exc:
        logger.warning("quality_gate unexpected error, failing open: %s", exc)
        return True, f"error_fail_open:{type(exc).__name__}"
