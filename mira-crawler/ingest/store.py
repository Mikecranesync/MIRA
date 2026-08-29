"""NeonDB storage for crawled document chunks.

Inserts embedded chunks into the knowledge_entries table using the same
connection pattern as mira-core/mira-ingest/db/neon.py (SQLAlchemy +
NullPool, sslmode=require).
"""

from __future__ import annotations

import json
import logging
import os
import re
import uuid

logger = logging.getLogger("mira-crawler.store")

_ENGINE = None

_SCHEME_RE = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*")


def canonical_source_url(url: str) -> str:
    """Lower-case ONLY the scheme and the host of ``url``; every other byte —
    userinfo, port, path, query, fragment — is preserved exactly as given.

    The dedup key ``(tenant_id, source_url, chunk_index)`` is an exact-match
    UNIQUE index (migration 003), while origin classification lower-cases the
    host — so two casings of one origin were stored as two rows (Gate 7 on
    PR #3481, code F1, SUSTAINED). BOTH constructors of the key — chunk_exists
    and insert_chunk — apply this, so lookup and write can never disagree.
    Bare filesystem paths (no scheme, or a one-letter Windows drive) and
    authority-less URLs (``file:/x``) get at most a lower-cased scheme.

    Historical residual, documented not migrated: rows written before this
    function keep their stored casing; a recrawl of such a row writes the
    canonical key beside it (one extra row per historical mixed-case URL) —
    a one-off dedup migration is the follow-up, never a silent rewrite here.
    """
    if not url:
        return url
    head, sep, rest = url.partition(":")
    if not sep or len(head) < 2 or not _SCHEME_RE.fullmatch(head):
        return url  # not a URL (bare path, Windows drive letter) — untouched
    scheme = head.lower()
    if not rest.startswith("//"):
        return f"{scheme}:{rest}"  # no authority component (e.g. file:/allowed/doc.pdf)
    body = rest[2:]
    end = len(body)
    for stop in "/?#":
        idx = body.find(stop)
        if idx != -1:
            end = min(end, idx)
    authority, tail = body[:end], body[end:]
    userinfo, at, hostport = authority.rpartition("@")
    if hostport.startswith("["):  # IPv6 literal
        close = hostport.find("]")
        host, port = (
            (hostport[: close + 1], hostport[close + 1 :]) if close != -1 else (hostport, "")
        )
    else:
        host, colon, port = hostport.partition(":")
        port = colon + port
    return f"{scheme}://{userinfo}{at}{host.lower()}{port}{tail}"


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

    source_url = canonical_source_url(source_url)  # the SAME key insert_chunk writes
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
    verified: bool = False,
    *,
    is_private: bool,
) -> str:
    """Insert a single chunk into knowledge_entries. Returns entry ID or empty string.

    is_private is REQUIRED (CU-03, finding I-1): the caller must make an
    explicit visibility decision. Shared OEM/public-crawl content passes
    False; a customer's own document passes True — never rely on a default
    (the #1833 leak shape). Write law:
    .claude/rules/knowledge-entries-tenant-scoping.md.
    """
    from sqlalchemy import text

    from .manufacturer_normalize import normalize_manufacturer

    # Collapse OCR/extraction manufacturer variants at the write boundary so
    # the knowledge_entries.manufacturer column (which the Hub KB catalog
    # GROUPs BY) stays canonical regardless of which caller wrote it (#1596).
    manufacturer = normalize_manufacturer(manufacturer).canonical

    # One canonical key for every casing of an origin — before provenance and
    # before binding, so the classified URL and the stored URL are the same
    # string, and chunk_exists() looks up exactly what this writes.
    source_url = canonical_source_url(source_url)

    # ── Provenance enforcement at the write boundary (Gate 9 round 1, F1) ──
    # Every storage route passes through here, which is the point: enforcing in
    # tasks/ingest.py only meant reddit/patents/youtube/manualslib_scraper and
    # the Apify coverage tool published policy-private and policy-BLOCKED
    # sources to the shared corpus with a hardcoded is_private=False. Patching
    # those five callers would not have been the fix — the sixth would
    # reintroduce it.
    #
    # This can make a row more private than the caller asked, or refuse it
    # outright. It can never grant sharing the caller did not request.
    try:
        from .provenance import enforce_visibility
    except ImportError:  # pragma: no cover — flat-path layout
        from provenance import enforce_visibility  # type: ignore[no-redef]

    allowed, is_private, prov_reason = enforce_visibility(source_url, is_private)
    if not allowed:
        logger.warning(
            "Refusing knowledge_entries write for %s — %s",
            (source_url or "<no url>")[:100],
            prov_reason,
        )
        return ""

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
                         cast(:metadata AS jsonb), :is_private, :verified, :chunk_type,
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
                    "is_private": is_private,
                    "verified": verified,
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
    verified: bool = False,
    *,
    is_private: bool,
) -> int:
    """Store a batch of (chunk, embedding) pairs into NeonDB.

    Skips chunks that already exist (dedup by source_url + chunk_index).
    Returns number of chunks inserted.
    image_embedding: optional 768-dim visual vector stored alongside text embedding.
    verified: when True the chunk is written as trusted (citable while
    MIRA_ENFORCE_APPROVED_RETRIEVAL is on). Only OEM-trusted crawlers pass
    True — see .claude/rules/oem-crawler-trusted.md.
    is_private: REQUIRED (CU-03, I-1) — the caller's explicit visibility
    decision, threaded to every insert_chunk. False = shared corpus;
    True = the owning tenant only. Visibility is orthogonal to trust
    (verified).

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
            verified=verified,
            is_private=is_private,
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


def ingested_source_urls(source_urls: list[str], tenant_id: str = "") -> set[str]:
    """Return which of ``source_urls`` actually have rows in knowledge_entries.

    The authority for "was this ingested?" — used by
    `ingest.ingest_ledger.reconcile` to promote pending items to committed. The
    corpus is the only definition of success that cannot drift from reality: a
    Celery ack proves a message was delivered, not that a document landed.

    One batched query, not one per URL. Returns an empty set on any error so a
    DB blip leaves items pending (retryable) rather than falsely committing or
    falsely dead-lettering them.
    """
    if not source_urls:
        return set()
    from sqlalchemy import text

    # Rows written since the canonical key landed carry the canonical spelling;
    # rows written before it keep their raw casing. Ask for BOTH and answer in
    # the caller's own spelling, so the ledger's keys match either way and a
    # mixed-case enqueued URL can never stay pending forever.
    asked = list(source_urls)
    lookup = sorted({*asked, *(canonical_source_url(u) for u in asked)})
    try:
        with _engine().connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT DISTINCT source_url FROM knowledge_entries "
                    "WHERE source_url = ANY(:urls)" + (" AND tenant_id = :tid" if tenant_id else "")
                ),
                ({"urls": lookup, "tid": tenant_id} if tenant_id else {"urls": lookup}),
            ).fetchall()
        found = {r[0] for r in rows if r and r[0]}
        return {u for u in asked if u in found or canonical_source_url(u) in found}
    except Exception as e:
        logger.warning("ingested_source_urls check failed (treating as none): %s", e)
        return set()
