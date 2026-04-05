"""Document parsing and chunking — delegates to mira-crawler's chunker.

Handles file extraction (PDF, DOCX, TXT) then passes text blocks to
mira-crawler/ingest/chunker.chunk_blocks for sentence-aware, table-aware
splitting with token hard cap for EmbeddingGemma / nomic-embed-text.
"""

from __future__ import annotations

import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger("mira-sidecar")

# Make mira-crawler importable
_CRAWLER_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "mira-crawler",
)
if _CRAWLER_DIR not in sys.path:
    sys.path.insert(0, _CRAWLER_DIR)

from ingest.chunker import chunk_blocks  # noqa: E402


@dataclass
class Chunk:
    """A text segment extracted from a document."""

    text: str
    page: int | None
    chunk_index: int
    source_file: str


# ---------------------------------------------------------------------------
# File extraction (kept here — crawler chunker only does chunking)
# ---------------------------------------------------------------------------


def _extract_pdf(file_path: Path) -> list[tuple[int, str]]:
    import pdfplumber

    pages: list[tuple[int, str]] = []
    try:
        with pdfplumber.open(str(file_path)) as pdf:
            for i, page in enumerate(pdf.pages, start=1):
                text = page.extract_text() or ""
                if text.strip():
                    pages.append((i, text))
    except Exception as exc:
        logger.error("pdfplumber failed on %s: %s", file_path, exc)
    return pages


def _extract_docx(file_path: Path) -> list[tuple[int | None, str]]:
    from docx import Document

    paragraphs: list[str] = []
    try:
        doc = Document(str(file_path))
        for para in doc.paragraphs:
            if para.text.strip():
                paragraphs.append(para.text)
    except Exception as exc:
        logger.error("python-docx failed on %s: %s", file_path, exc)
        return []
    return [(None, "\n".join(paragraphs))]


def _extract_txt(file_path: Path) -> list[tuple[int | None, str]]:
    try:
        text = file_path.read_text(encoding="utf-8", errors="replace")
        return [(None, text)]
    except OSError as exc:
        logger.error("Failed to read %s: %s", file_path, exc)
        return []


# ---------------------------------------------------------------------------
# Public API — same interface as before
# ---------------------------------------------------------------------------


def chunk_document(
    file_path: str,
    chunk_size: int = 512,
    overlap: int = 64,
) -> list[Chunk]:
    """Parse a document and return token-bounded Chunk objects.

    Extracts text from the file, then delegates to mira-crawler's
    chunk_blocks for sentence-aware, table-aware splitting.
    """
    path = Path(file_path)
    suffix = path.suffix.lower()

    if suffix == ".pdf":
        page_texts = _extract_pdf(path)
    elif suffix in (".docx", ".doc"):
        page_texts = _extract_docx(path)
    else:
        page_texts = _extract_txt(path)

    if not page_texts:
        logger.warning("No text extracted from %s", file_path)
        return []

    # Convert to blocks format expected by chunk_blocks
    blocks = [
        {"text": text, "page_num": page, "section": ""}
        for page, text in page_texts
        if text.strip()
    ]

    # chunk_size is in tokens (~4 chars/token) — convert to chars for chunk_blocks
    max_chars = chunk_size * 4
    overlap_chars = overlap * 4

    raw_chunks = chunk_blocks(
        blocks,
        source_url=path.name,
        source_file=path.name,
        max_chars=max_chars,
        min_chars=80,
        overlap=overlap_chars,
    )

    return [
        Chunk(
            text=c["text"],
            page=c.get("page_num"),
            chunk_index=c["chunk_index"],
            source_file=path.name,
        )
        for c in raw_chunks
    ]
