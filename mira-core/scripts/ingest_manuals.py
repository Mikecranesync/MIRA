#!/usr/bin/env python3
"""Nightly manual ingest pipeline.

Pulls all queued URLs from source_fingerprints / manual_cache / manuals,
downloads each document, chunks it, embeds via Ollama nomic-embed-text:v1.5,
and inserts into NeonDB knowledge_entries.

Usage:
    doppler run --project factorylm --config prd -- \\
      uv run --with pymupdf --with psycopg2-binary --with sqlalchemy \\
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
from typing import Generator

import httpx

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

OLLAMA_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text:latest")
MIRA_TENANT_ID = os.getenv("MIRA_TENANT_ID")
CHUNK_SIZE = 800
CHUNK_OVERLAP = 100
DOWNLOAD_TIMEOUT = 60
EMBED_TIMEOUT = 30
MAX_PDF_PAGES = 300          # skip runaway PDFs
MIN_CHUNK_CHARS = 80
REQUEST_DELAY = 0.5          # seconds between URL downloads (polite crawl)

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

from db.neon import (  # noqa: E402
    get_pending_urls,
    insert_knowledge_entry,
    knowledge_entry_exists,
    mark_manual_cache_done,
    mark_manual_verified,
    mark_source_fingerprint_done,
)


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
        import fitz  # PyMuPDF
    except ImportError:
        log.error("PyMuPDF not available — install pymupdf")
        return []

    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:
        log.warning("Failed to open PDF: %s", exc)
        return []

    pages_to_read = min(len(doc), MAX_PDF_PAGES)
    blocks: list[dict] = []

    for page_idx in range(pages_to_read):
        page = doc[page_idx]
        raw = page.get_text("text")
        if not raw or len(raw.strip()) < 50:
            continue
        text = _clean_text(raw)
        sections = _detect_sections(text)
        if not sections:
            sections = [("", text)]
        for heading, body in sections:
            if len(body) >= MIN_CHUNK_CHARS:
                blocks.append({"text": body, "page_num": page_idx + 1, "section": heading})

    doc.close()
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
# Chunking
# ---------------------------------------------------------------------------

def _chunk_text(text: str) -> Generator[str, None, None]:
    """Yield overlapping ~CHUNK_SIZE chunks."""
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunk = text[start:end].strip()
        if len(chunk) >= MIN_CHUNK_CHARS:
            yield chunk
        start += CHUNK_SIZE - CHUNK_OVERLAP


def _blocks_to_chunks(blocks: list[dict]) -> list[dict]:
    """Expand raw blocks into fixed-size chunks preserving metadata."""
    chunks: list[dict] = []
    for block in blocks:
        text = block["text"]
        if len(text) <= CHUNK_SIZE:
            chunks.append(block)
        else:
            for piece in _chunk_text(text):
                chunks.append({"text": piece, "page_num": block["page_num"], "section": block["section"]})
    return chunks


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

    # Extract
    if source_type == "pdf" or resp.headers.get("content-type", "").startswith("application/pdf"):
        blocks = _extract_from_pdf(data)
    else:
        blocks = _extract_from_html(data)

    if not blocks:
        log.warning("[SKIP] %s — no extractable text", url)
        return 0

    chunks = _blocks_to_chunks(blocks)
    inserted = 0

    for chunk_idx, chunk in enumerate(chunks):
        text = chunk["text"]
        if len(text) < MIN_CHUNK_CHARS:
            continue

        # Dedup check
        if knowledge_entry_exists(MIRA_TENANT_ID, url, chunk_idx):
            continue

        embedding = _embed(text)
        if embedding is None:
            continue

        try:
            insert_knowledge_entry(
                tenant_id=MIRA_TENANT_ID,
                content=text,
                embedding=embedding,
                manufacturer=manufacturer,
                model_number=model,
                source_url=url,
                chunk_index=chunk_idx,
                page_num=chunk["page_num"],
                section=chunk["section"],
                source_type="manual",
            )
            inserted += 1
        except Exception as exc:
            log.warning("[WARN] insert failed chunk %d of %s: %s", chunk_idx, url, exc)

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
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    if not MIRA_TENANT_ID:
        log.error("MIRA_TENANT_ID env var not set — aborting")
        sys.exit(1)

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
