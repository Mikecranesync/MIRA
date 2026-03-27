"""NeonDB storage for crawled document chunks.

Inserts embedded chunks into the knowledge_entries table using the same
connection pattern as mira-core/mira-ingest/db/neon.py (SQLAlchemy +
NullPool, sslmode=require).
"""

from __future__ import annotations

import json
import logging
import os
import uuid

logger = logging.getLogger("mira-crawler.store")

_ENGINE = None


def _engine():
    """Get or create SQLAlchemy engine with NullPool."""
    global _ENGINE  # noqa: PLW0603
    if _ENGINE is not None:
        return _ENGINE

    from sqlalchemy import create_engine
    from sqlalchemy.pool import NullPool

    url = os.environ.get("NEON_DATABASE_URL")
    if not url:
        raise RuntimeError("NEON_DATABASE_URL not set")

    _ENGINE = create_engine(
        url,
        poolclass=NullPool,
        connect_args={"sslmode": "require"},
        pool_pre_ping=True,
    )
    return _ENGINE


def chunk_exists(tenant_id: str, source_url: str, chunk_index: int) -> bool:
    """Check if a chunk has already been stored (dedup guard)."""
    from sqlalchemy import text

    try:
        with _engine().connect() as conn:
            count = conn.execute(
                text("""
                    SELECT COUNT(*) FROM knowledge_entries
                    WHERE tenant_id = :tid
                      AND source_url = :url
                      AND metadata->>'chunk_index' = :idx
                """),
                {"tid": tenant_id, "url": source_url, "idx": str(chunk_index)},
            ).scalar()
        return (count or 0) > 0
    except Exception as e:
        logger.warning("Dedup check failed: %s", e)
        return False


def insert_chunk(
    tenant_id: str,
    content: str,
    embedding: list[float],
    source_url: str = "",
    source_type: str = "equipment_manual",
    manufacturer: str = "",
    model_number: str = "",
    equipment_id: str = "",
    page_num: int | None = None,
    section: str = "",
    chunk_index: int = 0,
    chunk_type: str = "text",
) -> str:
    """Insert a single chunk into knowledge_entries. Returns entry ID or empty string."""
    from sqlalchemy import text

    entry_id = str(uuid.uuid4())
    metadata = {
        "chunk_index": chunk_index,
        "section": section,
        "equipment_id": equipment_id,
        "source": "mira_crawler",
        "chunk_type": chunk_type,
    }

    try:
        with _engine().connect() as conn:
            conn.execute(
                text("""
                    INSERT INTO knowledge_entries
                        (id, tenant_id, source_type, manufacturer, model_number,
                         content, embedding, source_url, source_page,
                         metadata, is_private, verified, chunk_type)
                    VALUES
                        (:id, :tenant_id, :source_type, :manufacturer, :model_number,
                         :content, cast(:embedding AS vector), :source_url, :source_page,
                         cast(:metadata AS jsonb), false, false, :chunk_type)
                """),
                {
                    "id": entry_id,
                    "tenant_id": tenant_id,
                    "source_type": source_type,
                    "manufacturer": manufacturer,
                    "model_number": model_number,
                    "content": content,
                    "embedding": str(embedding),
                    "source_url": source_url,
                    "source_page": page_num,
                    "metadata": json.dumps(metadata),
                    "chunk_type": chunk_type,
                },
            )
            conn.commit()
        return entry_id
    except Exception as e:
        logger.error("Insert failed: %s", e)
        return ""


def store_chunks(
    chunks_with_embeddings: list[tuple[dict, list[float]]],
    tenant_id: str,
    manufacturer: str = "",
    model_number: str = "",
) -> int:
    """Store a batch of (chunk, embedding) pairs into NeonDB.

    Skips chunks that already exist (dedup by source_url + chunk_index).
    Returns number of chunks inserted.
    """
    inserted = 0

    for chunk, embedding in chunks_with_embeddings:
        source_url = chunk.get("source_url", "")
        chunk_index = chunk.get("chunk_index", 0)

        # Dedup
        if chunk_exists(tenant_id, source_url, chunk_index):
            continue

        entry_id = insert_chunk(
            tenant_id=tenant_id,
            content=chunk["text"],
            embedding=embedding,
            source_url=source_url,
            source_type=chunk.get("source_type", "equipment_manual"),
            manufacturer=manufacturer,
            model_number=model_number,
            equipment_id=chunk.get("equipment_id", ""),
            page_num=chunk.get("page_num"),
            section=chunk.get("section", ""),
            chunk_index=chunk_index,
            chunk_type=chunk.get("chunk_type", "text"),
        )
        if entry_id:
            inserted += 1

    logger.info("Stored %d/%d chunks", inserted, len(chunks_with_embeddings))
    return inserted
