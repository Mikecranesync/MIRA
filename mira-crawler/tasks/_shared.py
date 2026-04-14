"""Shared helpers for Celery task modules.

Consolidates three patterns that were previously duplicated across tasks/:

1. ``get_redis()``       — Redis client factory using CELERY_BROKER_URL
2. ``ingest_text_inline()`` — chunk/embed/store pipeline for raw text strings
                              (used when there's no URL to fetch, e.g. Reddit
                              post bodies, patent abstracts, rendered HTML).
3. ``REDIS_SEEN_TTL_SEC`` — common 90-day TTL for dedup sets.

Both helpers fail-open: they never raise on network errors, returning neutral
values (an unusable client, or 0 inserts) so the task can log and move on.
"""

from __future__ import annotations

import logging
import os
from urllib.parse import urlparse

logger = logging.getLogger("mira-crawler.tasks._shared")

# Default TTL for Redis dedup sets — 90 days in seconds.
REDIS_SEEN_TTL_SEC = 90 * 24 * 3600


def get_redis(db: int = 0):
    """Return a Redis client built from ``CELERY_BROKER_URL``.

    Always connects to the requested db index (default 0) regardless of what
    was in the broker URL, because shared state (dedup sets, lastmod hashes)
    must be isolated from Celery's own queue data on db 0/1.

    Uses ``decode_responses=True`` so ``smembers()`` and friends return ``str``
    instead of ``bytes`` — every current caller expects string keys.

    Args:
        db: Redis database index to connect to.

    Returns:
        A configured ``redis.Redis`` instance. Connection errors are raised
        at first use, not here — callers should wrap ``.smembers()`` etc. in
        try/except to preserve fail-open behaviour.
    """
    import redis

    broker_url = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
    parsed = urlparse(broker_url)
    host = parsed.hostname or "localhost"
    port = parsed.port or 6379
    return redis.Redis(host=host, port=port, db=db, decode_responses=True)


def ingest_text_inline(
    text: str,
    source_url: str,
    source_type: str,
    tenant_id: str,
    ollama_url: str,
    embed_model: str,
) -> int:
    """Chunk, embed, and store a raw text string into the KB.

    Runs the same pipeline as ``tasks.ingest.ingest_url`` but starts from an
    in-memory string (no HTTP fetch, no file download). The quality gate is
    applied so Reddit, patents, and Playwright crawls go through the same
    3-stage filter as manual ingests.

    Args:
        text:        The text to ingest. Short or empty strings yield 0 inserts.
        source_url:  URL used for dedup and attribution.
        source_type: Category string (``"forum_post"``, ``"patent"``, ...).
        tenant_id:   Tenant scope for dedup + store.
        ollama_url:  Base URL of the Ollama instance providing embeddings.
        embed_model: Embedding model name (e.g. ``"nomic-embed-text:latest"``).

    Returns:
        Number of chunks successfully inserted into ``knowledge_entries``.
    """
    try:
        from ingest.chunker import chunk_blocks
        from ingest.embedder import embed_text
        from ingest.quality import quality_gate
        from ingest.store import chunk_exists, insert_chunk
    except ImportError:
        from mira_crawler.ingest.chunker import chunk_blocks
        from mira_crawler.ingest.embedder import embed_text
        from mira_crawler.ingest.quality import quality_gate
        from mira_crawler.ingest.store import chunk_exists, insert_chunk

    if not text or not text.strip():
        return 0

    blocks = [{"text": text, "page_num": None, "section": ""}]
    chunks = chunk_blocks(
        blocks,
        source_url=source_url,
        source_type=source_type,
        max_chars=2000,
        min_chars=80,
        overlap=200,
    )

    inserted = 0

    # Open ONE NeonDB connection for the whole document — quality gate's
    # dedup stage runs one SELECT per chunk; sharing the connection avoids
    # a TLS handshake per chunk (#112).
    try:
        from ingest.store import _engine
    except ImportError:
        from mira_crawler.ingest.store import _engine

    dedup_conn = None
    try:
        dedup_conn = _engine().connect()
    except Exception as exc:
        logger.warning("Could not open shared dedup connection (fail open): %s", exc)

    try:
        for chunk in chunks:
            chunk_idx = chunk.get("chunk_index", 0)

            if chunk_exists(tenant_id, source_url, chunk_idx):
                continue

            embedding = embed_text(chunk["text"], ollama_url=ollama_url, model=embed_model)
            if embedding is None:
                continue

            # Quality gate — fail open on any error so ingest is never blocked
            try:
                passed, reason = quality_gate(chunk, embedding, tenant_id, conn=dedup_conn)
                if not passed:
                    logger.debug(
                        "Quality gate rejected chunk %d from %s: %s",
                        chunk_idx,
                        source_url[:80],
                        reason,
                    )
                    continue
            except Exception as exc:
                logger.warning("Quality gate error (fail open): %s", exc)

            entry_id = insert_chunk(
                tenant_id=tenant_id,
                content=chunk["text"],
                embedding=embedding,
                source_url=source_url,
                source_type=source_type,
                chunk_index=chunk_idx,
                chunk_type=chunk.get("chunk_type", "text"),
            )
            if entry_id:
                inserted += 1
    finally:
        if dedup_conn is not None:
            try:
                dedup_conn.close()
            except Exception:
                pass

    return inserted
