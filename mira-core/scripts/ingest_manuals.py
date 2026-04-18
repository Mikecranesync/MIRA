#!/usr/bin/env python3
"""Nightly manual ingest pipeline.

Pulls all queued URLs from source_fingerprints / manual_cache / manuals,
downloads each document, chunks it, embeds via Ollama nomic-embed-text:v1.5,
and inserts into NeonDB knowledge_entries.

Usage:
    doppler run --project factorylm --config prd -- \\
      uv run --with pdfplumber --with psycopg2-binary --with sqlalchemy \\
             --with httpx --with beautifulsoup4 \\
      python mira-core/scripts/ingest_manuals.py
"""

from __future__ import annotations

import io
import json
import logging
import os
import re
import sys
import time
import uuid

import httpx

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text:latest")
MIRA_TENANT_ID = os.getenv("MIRA_TENANT_ID")
CHUNK_SIZE = 800             # pdfplumber fallback path
CHUNK_SIZE_DOCLING = 2500    # Docling path — blocks are pre-chunked semantically
CHUNK_OVERLAP = 200
DOWNLOAD_TIMEOUT = 60
EMBED_TIMEOUT = 30
MAX_PDF_PAGES = int(os.getenv("MAX_PDF_PAGES", "1000"))
MIN_CHUNK_CHARS = 80
REQUEST_DELAY = 0.5          # seconds between URL downloads (polite crawl)

# Docling is the primary PDF extractor. pdfplumber is the fallback.
_docling = None
try:
    import pathlib as _pathlib
    import sys as _sys
    _sys.path.insert(0, str(_pathlib.Path(__file__).parent))
    from docling_adapter import DoclingAdapter as _DoclingAdapter
    _docling = _DoclingAdapter(max_pages=MAX_PDF_PAGES)
except Exception as _e:
    import logging as _logging
    _logging.getLogger(__name__).warning(
        "Docling unavailable: %s — pdfplumber will be used for all PDFs", _e
    )

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("ingest_manuals")

# ---------------------------------------------------------------------------
# sys.path: make db.neon importable when run from repo root
# ---------------------------------------------------------------------------

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_INGEST_DIR = os.path.join(os.path.dirname(_SCRIPT_DIR), "mira-ingest")
if _INGEST_DIR not in sys.path:
    sys.path.insert(0, _INGEST_DIR)

_CRAWLER_DIR = os.path.join(os.path.dirname(os.path.dirname(_SCRIPT_DIR)), "mira-crawler")
if _CRAWLER_DIR not in sys.path:
    sys.path.insert(0, _CRAWLER_DIR)

from db.neon import (  # noqa: E402
    ensure_knowledge_hierarchy_columns,
    get_pending_urls,
    insert_knowledge_entries_batch,
    knowledge_entry_exists,
    mark_manual_cache_done,
    mark_manual_verified,
    mark_source_fingerprint_done,
)
from ingest.chunker import chunk_blocks  # noqa: E402

# ---------------------------------------------------------------------------
# Text extraction
# ---------------------------------------------------------------------------

BOILERPLATE_RE = re.compile(
    r"(?:^\d{1,4}$)"           # bare page numbers
    r"|(?:www\.\S+\.com)",
    re.MULTILINE,
)


def _clean_text(text: str) -> str:
    text = BOILERPLATE_RE.sub("", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _detect_sections(page_text: str) -> list[tuple[str, str]]:
    """Split page text into (heading, body) sections using the Eaton heuristic."""
    lines = page_text.split("\n")
    sections: list[tuple[str, str]] = []
    current_heading = ""
    current_body: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            current_body.append("")
            continue
        is_heading = (
            len(stripped) < 80
            and not stripped.endswith(".")
            and not stripped.endswith(",")
            and (stripped.istitle() or stripped.isupper() or re.match(r"^\d+\.\d+", stripped))
            and len(stripped.split()) <= 12
        )
        if is_heading and current_body:
            body = "\n".join(current_body).strip()
            if body and len(body) > 50:
                sections.append((current_heading, body))
            current_heading = stripped
            current_body = []
        elif is_heading and not current_body:
            current_heading = stripped
        else:
            current_body.append(stripped)

    body = "\n".join(current_body).strip()
    if body and len(body) > 50:
        sections.append((current_heading, body))

    return sections


def _extract_from_pdf(data: bytes) -> list[dict]:
    """Return list of {text, page_num, section} dicts from a PDF."""
    try:
        import pdfplumber
    except ImportError:
        log.error("pdfplumber not available — install pdfplumber")
        return []

    blocks: list[dict] = []
    try:
        with pdfplumber.open(io.BytesIO(data)) as doc:
            pages_to_read = min(len(doc.pages), MAX_PDF_PAGES)
            for page_idx in range(pages_to_read):
                raw = doc.pages[page_idx].extract_text()
                if not raw or len(raw.strip()) < 50:
                    continue
                text = _clean_text(raw)
                sections = _detect_sections(text)
                if not sections:
                    sections = [("", text)]
                for heading, body in sections:
                    if len(body) >= MIN_CHUNK_CHARS:
                        blocks.append({"text": body, "page_num": page_idx + 1, "section": heading})
    except Exception as exc:
        log.warning("Failed to open PDF: %s", exc)
        return []

    return blocks


def _extract_from_html(data: bytes) -> list[dict]:
    """Return list of {text, page_num, section} from an HTML response."""
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        log.error("beautifulsoup4 not available")
        return []

    soup = BeautifulSoup(data, "html.parser")
    for tag in soup(["script", "style", "nav", "header", "footer"]):
        tag.decompose()

    paragraphs = [p.get_text(" ", strip=True) for p in soup.find_all("p")]
    blocks: list[dict] = []
    for i, para in enumerate(paragraphs):
        if len(para) >= MIN_CHUNK_CHARS:
            blocks.append({"text": para, "page_num": None, "section": ""})

    if not blocks:
        full = soup.get_text("\n", strip=True)
        full = _clean_text(full)
        if len(full) >= MIN_CHUNK_CHARS:
            blocks.append({"text": full, "page_num": None, "section": ""})

    return blocks


# ---------------------------------------------------------------------------
# Chunking — delegated to mira-crawler/ingest/chunker.py (table-aware)
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------

def _embed(text: str) -> list[float] | None:
    try:
        resp = httpx.post(
            f"{OLLAMA_URL}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": text},
            timeout=EMBED_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()["embedding"]
    except Exception as exc:
        log.warning("Embed failed: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Manufacturer / model extraction from URL
# ---------------------------------------------------------------------------

_MFR_HINTS: dict[str, str] = {
    "siemens": "Siemens",
    "rockwellautomation": "Rockwell Automation",
    "allen-bradley": "Allen-Bradley",
    "ab.com": "Allen-Bradley",
    "abb.com": "ABB",
    "abb.": "ABB",
    "schneider": "Schneider Electric",
    "mitsubishi": "Mitsubishi Electric",
    "eaton": "Eaton",
    "omron": "Omron",
    "fanuc": "Fanuc",
}

# Rockwell catalog prefix → (manufacturer, product name) for local PDF filenames
_CATALOG_MAP: dict[str, tuple[str, str]] = {
    "100": ("Rockwell Automation", "Bulletin 100 Contactor"),
    "140g": ("Rockwell Automation", "Bulletin 140G Circuit Breaker"),
    "150": ("Rockwell Automation", "SMC-3 Soft Starter"),
    "193": ("Rockwell Automation", "Bulletin 193 Overload Relay"),
    "20a": ("Rockwell Automation", "PowerFlex 70"),
    "20b": ("Rockwell Automation", "PowerFlex 700"),
    "2100": ("Rockwell Automation", "CENTERLINE 2100 MCC"),
    "22a": ("Rockwell Automation", "PowerFlex 70"),
    "22b": ("Rockwell Automation", "PowerFlex 40"),
    "22c": ("Rockwell Automation", "PowerFlex 400"),
    "22comm": ("Rockwell Automation", "PowerFlex Communications"),
    "22d": ("Rockwell Automation", "PowerFlex 40P"),
    "22f": ("Rockwell Automation", "PowerFlex 4M"),
    "520": ("Rockwell Automation", "PowerFlex 525"),
    "750": ("Rockwell Automation", "PowerMonitor 5000"),
    "pflex": ("Rockwell Automation", "PowerFlex Reference"),
    "440c": ("Rockwell Automation", "GuardMaster"),
    "1756": ("Rockwell Automation", "ControlLogix"),
    "1769": ("Rockwell Automation", "CompactLogix"),
}


def _catalog_lookup(filename: str) -> tuple[str | None, str | None]:
    """Extract manufacturer + model from Rockwell catalog filename prefix."""
    stem = filename.lower().rsplit(".", 1)[0]
    for prefix, (mfr, model) in sorted(_CATALOG_MAP.items(), key=lambda x: -len(x[0])):
        if stem.startswith(prefix):
            return mfr, model
    return None, None


def _extract_mfr_from_url(url: str, hint: str | None = None) -> str | None:
    if hint:
        return hint
    url_lower = url.lower()
    for key, name in _MFR_HINTS.items():
        if key in url_lower:
            return name
    return None


def _extract_model_from_url(url: str, hint: str | None = None) -> str | None:
    if hint:
        return hint
    # Look for common model number patterns in the URL path
    filename = url.rstrip("/").split("/")[-1]
    filename = re.sub(r"\.(pdf|html|htm)$", "", filename, flags=re.IGNORECASE)
    # Replace separators with spaces for readability
    model_candidate = re.sub(r"[-_]", " ", filename).strip()
    if 3 <= len(model_candidate) <= 60:
        return model_candidate.upper()
    return None


# ---------------------------------------------------------------------------
# Per-URL processor
# ---------------------------------------------------------------------------

def process_url(record: dict) -> int:
    """Download, chunk, embed, insert one URL. Returns number of chunks inserted."""
    url = record["url"]
    source_type = record.get("source_type", "web")
    manufacturer = _extract_mfr_from_url(url, record.get("manufacturer"))
    model = _extract_model_from_url(url, record.get("model"))

    # Download
    try:
        resp = httpx.get(url, timeout=DOWNLOAD_TIMEOUT, follow_redirects=True,
                         headers={"User-Agent": "MIRA-IngestBot/1.0 (manual KB builder)"})
        resp.raise_for_status()
        data = resp.content
    except Exception as exc:
        log.warning("[SKIP] %s — download failed: %s", url, exc)
        return 0

    # Extract — Docling primary, pdfplumber fallback for PDFs
    used_docling = False
    if source_type == "pdf" or resp.headers.get("content-type", "").startswith("application/pdf"):
        if _docling is not None:
            blocks = _docling.extract_from_pdf(data)
            if blocks:
                used_docling = True
                log.info("Extracted %d blocks from %s via docling", len(blocks), url)
            else:
                log.warning("Docling returned 0 blocks for %s — falling back to pdfplumber", url)
                blocks = _extract_from_pdf(data)
        else:
            blocks = _extract_from_pdf(data)
    else:
        blocks = _extract_from_html(data)

    if not blocks:
        log.warning("[SKIP] %s — no extractable text", url)
        return 0

    # Docling blocks are pre-chunked semantically — use larger max_chars to avoid
    # re-splitting them. pdfplumber blocks need the standard split size.
    effective_chunk_size = CHUNK_SIZE_DOCLING if used_docling else CHUNK_SIZE

    chunks = chunk_blocks(
        blocks,
        source_url=url,
        max_chars=effective_chunk_size,
        min_chars=MIN_CHUNK_CHARS,
        overlap=CHUNK_OVERLAP,
    )
    inserted = 0
    total_chunks = len(chunks)
    batch_size = 100
    buffer: list[dict] = []

    for i, chunk in enumerate(chunks):
        text = chunk["text"]
        chunk_idx = chunk["chunk_index"]

        # Dedup check
        if knowledge_entry_exists(MIRA_TENANT_ID, url, chunk_idx):
            continue

        # Progress logging every 50 chunks
        if (i + 1) % 50 == 0:
            log.info("Embedding chunk %d/%d for %s...", i + 1, total_chunks, url[:60])

        embedding = _embed(text)
        if embedding is None:
            continue

        meta = {
            "source_url": url,
            "chunk_index": chunk_idx,
            "page_num": chunk.get("page_num"),
            "section": chunk.get("section", ""),
            "chunk_type": chunk.get("chunk_type", "text"),
        }
        buffer.append({
            "id": str(uuid.uuid4()),
            "tenant_id": MIRA_TENANT_ID,
            "source_type": "manual",
            "manufacturer": manufacturer,
            "model_number": model,
            "content": text,
            "embedding": str(embedding),
            "source_url": url,
            "source_page": chunk_idx,
            "metadata": json.dumps(meta),
            "chunk_type": chunk.get("chunk_type", "text"),
        })

        if len(buffer) >= batch_size:
            try:
                insert_knowledge_entries_batch(buffer)
                inserted += len(buffer)
                log.info("Inserted %d/%d chunks for %s", inserted, total_chunks, url[:60])
            except Exception as exc:
                log.warning("[WARN] batch insert failed at chunk %d of %s: %s", i, url, exc)
            buffer = []

    # Flush remainder
    if buffer:
        try:
            insert_knowledge_entries_batch(buffer)
            inserted += len(buffer)
        except Exception as exc:
            log.warning("[WARN] final batch insert failed: %s", exc)

    log.info("Completed %s: %d/%d chunks inserted", url[:60], inserted, total_chunks)
    return inserted


# ---------------------------------------------------------------------------
# Tracking updates
# ---------------------------------------------------------------------------

def _update_tracking(record: dict, inserted: int) -> None:
    table = record["source_table"]
    row_id = record["row_id"]
    try:
        if table == "source_fingerprints":
            mark_source_fingerprint_done(row_id, inserted)
        elif table == "manual_cache":
            mark_manual_cache_done(row_id)
        elif table == "manuals":
            mark_manual_verified(row_id)
    except Exception as exc:
        log.warning("Tracking update failed for %s row %s: %s", table, row_id, exc)


# ---------------------------------------------------------------------------
# Local PDF ingest
# ---------------------------------------------------------------------------

def process_local_pdf(pdf_path: str) -> int:
    """Extract, chunk, embed, insert one local PDF file. Returns chunks inserted."""
    from pathlib import Path

    path = Path(pdf_path)
    filename = path.name
    mfr, model = _catalog_lookup(filename)
    if not mfr:
        mfr = _extract_mfr_from_url(filename, None)
    if not model:
        model = _extract_model_from_url(filename, None)

    data = path.read_bytes()

    used_docling = False
    if _docling is not None:
        blocks = _docling.extract_from_pdf(data)
        if blocks:
            used_docling = True
            log.info("Extracted %d blocks from %s via docling", len(blocks), filename)
        else:
            log.warning("Docling returned 0 blocks for %s — falling back to pdfplumber", filename)
            blocks = _extract_from_pdf(data)
    else:
        blocks = _extract_from_pdf(data)

    if not blocks:
        log.warning("[SKIP] %s — no extractable text", filename)
        return 0

    effective_chunk_size = CHUNK_SIZE_DOCLING if used_docling else CHUNK_SIZE

    chunks = chunk_blocks(
        blocks,
        source_url=filename,
        source_file=filename,
        max_chars=effective_chunk_size,
        min_chars=MIN_CHUNK_CHARS,
        overlap=CHUNK_OVERLAP,
    )
    log.info("  %s → %d blocks → %d chunks", filename, len(blocks), len(chunks))

    inserted = 0
    total_chunks = len(chunks)
    batch_size = 100
    buffer: list[dict] = []

    for i, chunk in enumerate(chunks):
        chunk_idx = chunk["chunk_index"]

        if knowledge_entry_exists(MIRA_TENANT_ID, filename, chunk_idx):
            continue

        if (i + 1) % 50 == 0:
            log.info("Embedding chunk %d/%d for %s...", i + 1, total_chunks, filename)

        embedding = _embed(chunk["text"])
        if embedding is None:
            continue

        meta = {
            "source_url": filename,
            "chunk_index": chunk_idx,
            "page_num": chunk.get("page_num"),
            "section": chunk.get("section", ""),
            "chunk_type": chunk.get("chunk_type", "text"),
        }
        buffer.append({
            "id": str(uuid.uuid4()),
            "tenant_id": MIRA_TENANT_ID,
            "source_type": "manual",
            "manufacturer": mfr,
            "model_number": model,
            "content": chunk["text"],
            "embedding": str(embedding),
            "source_url": filename,
            "source_page": chunk_idx,
            "metadata": json.dumps(meta),
            "chunk_type": chunk.get("chunk_type", "text"),
        })

        if len(buffer) >= batch_size:
            try:
                insert_knowledge_entries_batch(buffer)
                inserted += len(buffer)
                log.info("Inserted %d/%d chunks for %s", inserted, total_chunks, filename)
            except Exception as exc:
                log.warning("[WARN] batch insert failed at chunk %d of %s: %s", i, filename, exc)
            buffer = []

    if buffer:
        try:
            insert_knowledge_entries_batch(buffer)
            inserted += len(buffer)
        except Exception as exc:
            log.warning("[WARN] final batch insert failed: %s", exc)

    log.info("Completed %s: %d/%d chunks inserted", filename, inserted, total_chunks)
    return inserted


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    import argparse
    from pathlib import Path

    parser = argparse.ArgumentParser(description="MIRA manual ingest pipeline")
    parser.add_argument(
        "--local-dir",
        help="Ingest all PDFs from a local directory instead of NeonDB URL queue",
    )
    args = parser.parse_args()

    ensure_knowledge_hierarchy_columns()

    if not MIRA_TENANT_ID:
        log.error("MIRA_TENANT_ID env var not set — aborting")
        sys.exit(1)

    if args.local_dir:
        # Local PDF mode
        pdf_dir = Path(args.local_dir)
        if not pdf_dir.is_dir():
            log.error("Directory not found: %s", pdf_dir)
            sys.exit(1)

        pdf_files = sorted(pdf_dir.glob("*.pdf"))
        log.info("Found %d PDFs in %s", len(pdf_files), pdf_dir)

        total_inserted = 0
        for i, pdf_path in enumerate(pdf_files, 1):
            log.info("[%d/%d] %s", i, len(pdf_files), pdf_path.name)
            try:
                inserted = process_local_pdf(str(pdf_path))
                total_inserted += inserted
                log.info("  → %d chunks inserted", inserted)
            except Exception as exc:
                log.error("[FAIL] %s — %s", pdf_path.name, exc)

        log.info("Done. %d PDFs, %d total chunks inserted.", len(pdf_files), total_inserted)
        return

    # URL queue mode (existing behavior)
    log.info("Fetching pending URLs from NeonDB...")
    pending = get_pending_urls()
    log.info("Found %d URLs to process", len(pending))

    total_inserted = 0
    ok_count = 0
    fail_count = 0

    for i, record in enumerate(pending, 1):
        url = record["url"]
        mfr = record.get("manufacturer") or "?"
        model = record.get("model") or "?"
        log.info("[%d/%d] %s %s — %s", i, len(pending), mfr, model, url)

        try:
            inserted = process_url(record)
        except Exception as exc:
            log.error("[FAIL] %s — unexpected error: %s", url, exc)
            fail_count += 1
            continue

        if inserted > 0:
            _update_tracking(record, inserted)
            log.info("[OK] %s %s — %d chunks embedded", mfr, model, inserted)
            total_inserted += inserted
            ok_count += 1
        else:
            log.warning("[FAIL] %s — 0 chunks inserted", url)
            fail_count += 1

        time.sleep(REQUEST_DELAY)

    log.info(
        "Done. %d URLs processed (%d ok / %d fail). %d total chunks inserted into knowledge_entries.",
        len(pending), ok_count, fail_count, total_inserted,
    )


if __name__ == "__main__":
    main()
