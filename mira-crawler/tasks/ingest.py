"""Document ingest tasks — download, extract, chunk, embed, store.

Reuses existing mira-crawler pipeline modules:
- converter.py for PDF/HTML extraction
- chunker.py for semantic chunking
- embedder.py for Ollama embedding
- store.py for NeonDB insert + dedup
"""

from __future__ import annotations

import logging
import os

import httpx

try:
    from mira_crawler.celery_app import app
except ImportError:
    from celery_app import app

logger = logging.getLogger("mira-crawler.tasks.ingest")

DOWNLOAD_TIMEOUT = int(os.getenv("INGEST_DOWNLOAD_TIMEOUT", "60"))
MAX_PDF_BYTES = int(os.getenv("INGEST_MAX_PDF_BYTES", str(150 * 1024 * 1024)))  # 150 MB


@app.task(bind=True, max_retries=3, default_retry_delay=30)
def ingest_url(self, url: str, manufacturer: str = "",
               model: str = "", source_type: str = "equipment_manual"):
    """Download, extract, chunk, embed, and store one document.

    Works with PDFs and HTML pages. Skips already-ingested chunks (dedup).
    """
    from ingest.chunker import chunk_blocks
    from ingest.converter import extract_from_html, extract_from_pdf
    from ingest.embedder import embed_text
    from ingest.store import chunk_exists, insert_chunk

    tenant_id = os.getenv("MIRA_TENANT_ID", "")
    ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    embed_model = os.getenv("EMBED_MODEL", "nomic-embed-text:latest")

    if not tenant_id:
        logger.error("MIRA_TENANT_ID not set — cannot ingest")
        return {"url": url, "inserted": 0, "error": "no_tenant_id"}

    # 1. Pre-flight size check for PDFs — avoids OOM on very large files
    is_pdf_url = url.lower().endswith(".pdf")
    if is_pdf_url:
        try:
            head = httpx.head(
                url,
                timeout=10,
                follow_redirects=True,
                headers={"User-Agent": "MIRA-IngestBot/1.0 (KB builder)"},
            )
            content_length = int(head.headers.get("content-length", 0))
            if content_length > MAX_PDF_BYTES:
                logger.warning(
                    "Skipping %s — too large (%d MB > %d MB limit)",
                    url[:80], content_length // 1024 // 1024, MAX_PDF_BYTES // 1024 // 1024,
                )
                return {"url": url, "inserted": 0, "error": "file_too_large"}
        except Exception:
            pass  # HEAD failed — proceed with download, let normal timeout/OOM guard handle it

    # 2. Download
    try:
        resp = httpx.get(
            url,
            timeout=DOWNLOAD_TIMEOUT,
            follow_redirects=True,
            headers={"User-Agent": "MIRA-IngestBot/1.0 (KB builder)"},
        )
        resp.raise_for_status()
        data = resp.content
        content_type = resp.headers.get("content-type", "")
        if len(data) > MAX_PDF_BYTES and ("application/pdf" in content_type or is_pdf_url):
            logger.warning(
                "Skipping %s — downloaded %d MB exceeds limit",
                url[:80], len(data) // 1024 // 1024,
            )
            return {"url": url, "inserted": 0, "error": "file_too_large"}
    except Exception as exc:
        logger.warning("Download failed for %s: %s — retrying", url[:80], exc)
        raise self.retry(exc=exc)

    # 3. Extract text blocks
    is_pdf = url.lower().endswith(".pdf") or "application/pdf" in content_type
    if is_pdf:
        blocks = extract_from_pdf(data)
    else:
        blocks = extract_from_html(data)

    if not blocks:
        logger.warning("No extractable text from %s", url[:80])
        return {"url": url, "inserted": 0, "error": "no_content"}

    # 4. Chunk
    chunks = chunk_blocks(
        blocks,
        source_url=url,
        max_chars=2000,
        min_chars=80,
        overlap=200,
    )
    total = len(chunks)
    logger.info("Extracted %d blocks → %d chunks from %s", len(blocks), total, url[:80])

    # 5. Embed + store (with dedup and progress)
    inserted = 0
    skipped = 0

    for i, chunk in enumerate(chunks):
        chunk_idx = chunk.get("chunk_index", i)

        # Dedup
        if chunk_exists(tenant_id, url, chunk_idx):
            skipped += 1
            continue

        # Progress logging every 50 chunks
        if (i + 1) % 50 == 0:
            logger.info("Embedding chunk %d/%d for %s...", i + 1, total, url[:60])

        embedding = embed_text(
            chunk["text"],
            ollama_url=ollama_url,
            model=embed_model,
        )
        if embedding is None:
            continue

        entry_id = insert_chunk(
            tenant_id=tenant_id,
            content=chunk["text"],
            embedding=embedding,
            source_url=url,
            source_type=source_type,
            manufacturer=manufacturer,
            model_number=model,
            page_num=chunk.get("page_num"),
            section=chunk.get("section", ""),
            chunk_index=chunk_idx,
            chunk_type=chunk.get("chunk_type", "text"),
        )
        if entry_id:
            inserted += 1

    logger.info(
        "Completed %s: %d inserted, %d skipped, %d total chunks",
        url[:60], inserted, skipped, total,
    )
    return {"url": url, "inserted": inserted, "skipped": skipped, "total": total}


@app.task
def ingest_all_pending():
    """Queue ingest tasks for all pending URLs in manual_cache.

    Reads from NeonDB manual_cache table (pdf_stored=false) and queues
    each URL as a separate ingest task.
    """
    import sys

    # Add mira-ingest to path for db.neon imports
    _ingest_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "..", "mira-core", "mira-ingest",
    )
    if _ingest_dir not in sys.path:
        sys.path.insert(0, os.path.abspath(_ingest_dir))

    try:
        from db.neon import get_pending_urls
    except ImportError:
        logger.error("Cannot import db.neon — check PYTHONPATH")
        return {"queued": 0, "error": "import_failed"}

    pending = get_pending_urls()
    logger.info("Found %d pending URLs to ingest", len(pending))

    queued = 0
    for record in pending:
        url = record.get("url", "")
        manufacturer = record.get("manufacturer", "")
        model = record.get("model", "")
        if url:
            ingest_url.delay(
                url=url,
                manufacturer=manufacturer,
                model=model,
                source_type="manual",
            )
            queued += 1

    return {"queued": queued}
