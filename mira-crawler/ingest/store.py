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
    image_embedding: list[float] | None = None,
) -> str:
    """Insert a single chunk into knowledge_entries. Returns entry ID or empty string."""
    from sqlalchemy import text

    from .manufacturer_normalize import normalize_manufacturer

    # Collapse OCR/extraction manufacturer variants at the write boundary so
    # the knowledge_entries.manufacturer column (which the Hub KB catalog
    # GROUPs BY) stays canonical regardless of which caller wrote it (#1596).
    manufacturer = normalize_manufacturer(manufacturer).canonical

    entry_id = str(uuid.uuid4())
    metadata = {
        "chunk_index": chunk_index,
        "section": section,
        "equipment_id": equipment_id,
        "source": "mira_crawler",
        "chunk_type": chunk_type,
    }

    img_emb_val = str(image_embedding) if image_embedding else None

    try:
        with _engine().connect() as conn:
            conn.execute(
                text("""
                    INSERT INTO knowledge_entries
                        (id, tenant_id, source_type, manufacturer, model_number,
                         content, embedding, source_url, source_page,
                         metadata, is_private, verified, chunk_type, image_embedding)
                    VALUES
                        (:id, :tenant_id, :source_type, :manufacturer, :model_number,
                         :content, cast(:embedding AS vector), :source_url, :source_page,
                         cast(:metadata AS jsonb), false, false, :chunk_type,
                         cast(:image_embedding AS vector))
                    ON CONFLICT (tenant_id, source_url, ((metadata->>'chunk_index')::int))
                    WHERE (metadata->>'chunk_index') IS NOT NULL
                    DO NOTHING
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
                    "image_embedding": img_emb_val,
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
    image_embedding: list[float] | None = None,
) -> int:
    """Store a batch of (chunk, embedding) pairs into NeonDB.

    Skips chunks that already exist (dedup by source_url + chunk_index).
    Returns number of chunks inserted.
    image_embedding: optional 768-dim visual vector stored alongside text embedding.

    UNS+KG flywheel (spec §4.4): when manufacturer+model are known, this
    upserts an `equipment` and a `manual` entity, links the chunk row to
    the equipment via `equipment_entity_id`, and runs the fault-code
    extractor over chunk text to densify the KG. All entity writes are
    idempotent (UNIQUE on tenant_id+entity_type+name).

    Manufacturer normalization (#1596) happens at the write boundaries —
    `insert_chunk` for the chunk row and `kg_writer.register_*` for the KG
    entities — so direct callers of those (e.g. tasks/ingest.py) are covered
    too, not just this orchestrator.
    """
    # Lazy-import KG modules so a misconfigured KG layer cannot break
    # the chunk-insert hot path. Failures degrade to "we still wrote
    # the vectors, we just didn't densify the graph this batch."
    try:
        from . import kg_writer
        from .extractors.fault_codes import extract_fault_codes
    except Exception as e:  # pragma: no cover — defensive
        logger.warning("KG modules unavailable, skipping graph densification: %s", e)
        kg_writer = None  # type: ignore[assignment]
        extract_fault_codes = None  # type: ignore[assignment]

    inserted = 0
    equipment_id: str | None = None
    manual_id: str | None = None

    # Step 1 (per-batch): register the equipment + manual once. The same
    # batch always carries chunks for one (mfr, model) combination — the
    # caller is the per-URL processor in mira-crawler/tasks/ingest.py.
    if kg_writer is not None and manufacturer and model_number:
        manual_url = next(
            (c.get("source_url") for c, _ in chunks_with_embeddings if c.get("source_url")),
            None,
        )
        manual_title = next(
            (c.get("title") for c, _ in chunks_with_embeddings if c.get("title")),
            None,
        )
        equipment_id, manual_id = kg_writer.register_equipment_and_manual(
            tenant_id=tenant_id,
            manufacturer=manufacturer,
            model=model_number,
            manual_title=manual_title,
            manual_url=manual_url,
        )

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
            image_embedding=image_embedding,
        )
        if not entry_id:
            continue
        inserted += 1

        # Step 2: bridge the chunk row to its equipment entity, if known.
        if kg_writer is not None and equipment_id:
            kg_writer.link_chunk_to_equipment(entry_id, equipment_id)

            # Step 3: extract fault codes from chunk text and densify the KG.
            if extract_fault_codes is not None:
                for match in extract_fault_codes(chunk.get("text", "")):
                    kg_writer.register_fault_code(
                        tenant_id=tenant_id,
                        equipment_id=equipment_id,
                        manufacturer=manufacturer,
                        fault_code=match.normalized(),
                        # Anchoring the fault under its model in the KB
                        # tree gives the Hub a navigable
                        # mfr/family/model/fault_codes/<code> path.
                        model=model_number,
                        confidence=0.85,
                        source_chunk_id=entry_id,
                    )

    logger.info(
        "Stored %d/%d chunks (equipment_id=%s, manual_id=%s)",
        inserted,
        len(chunks_with_embeddings),
        equipment_id,
        manual_id,
    )
    return inserted
