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

    if cached and len(cached) == len(anchors):
        _anchor_embeddings = cached
        return _anchor_embeddings

    # Generate embeddings for any anchors that don't have one yet
    logger.info("Generating %d anchor embeddings (one-time setup)...", len(anchors))
    try:
        from ingest.embedder import embed_text
    except ImportError:
        logger.warning("Cannot import embed_text — relevance stage disabled")
        _anchor_embeddings = []
        return _anchor_embeddings

    embeddings: list[list[float]] = []
    for text in anchors:
        vec = embed_text(text)
        if vec is not None:
            embeddings.append(vec)
        else:
            logger.warning("Anchor embedding failed for: %s...", text[:60])
            # Append a zero vector as placeholder so indices remain aligned
            embeddings.append([])

    _anchor_embeddings = embeddings

    # Persist back to anchors.json for future runs
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


def _semantic_dedup_score(embedding: list[float], tenant_id: str) -> float:
    """Return cosine similarity to the nearest existing chunk in NeonDB.

    Uses pgvector <=> operator (cosine distance).  Returns 0.0 on any error
    so the gate fails open rather than blocking ingest.
    """
    try:
        from ingest.store import _engine
        from sqlalchemy import text

        engine = _engine()
        vec_str = str(embedding)
        with engine.connect() as conn:
            row = conn.execute(
                text("""
                    SELECT 1 - (embedding <=> cast(:vec AS vector)) AS similarity
                    FROM knowledge_entries
                    WHERE tenant_id = :tid
                    ORDER BY embedding <=> cast(:vec AS vector)
                    LIMIT 1
                """),
                {"vec": vec_str, "tid": tenant_id},
            ).fetchone()
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
) -> tuple[bool, str]:
    """Run 3-stage quality gate on a chunk before DB insertion.

    Args:
        chunk:     Chunk dict with at least a 'text' key.
        embedding: Pre-computed Ollama embedding for the chunk text.
        tenant_id: Tenant scope for semantic dedup query.

    Returns:
        (True, "")           — chunk passes all stages
        (False, reason_str)  — chunk rejected; reason encodes which stage failed
    """
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
    dedup_score = _semantic_dedup_score(embedding, tenant_id)
    if dedup_score > _DEDUP_THRESHOLD:
        return False, f"near_duplicate:{dedup_score:.3f}"

    return True, ""
