"""Document parsing and semantic chunking.

Supports PDF (pdfplumber), DOCX (python-docx), and plain TXT.
Token counting uses tiktoken (cl100k_base) so chunk_size is in tokens,
not characters. Splits prefer sentence boundaries; falls back to
whitespace when no sentence boundary is found.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path

import tiktoken

logger = logging.getLogger("mira-sidecar")

# Shared encoder — cl100k_base covers GPT-4 and most modern models
_ENCODER = tiktoken.get_encoding("cl100k_base")

# Sentence boundary: end of sentence followed by whitespace and a capital letter
_SENTENCE_END_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z])")


@dataclass
class Chunk:
    """A text segment extracted from a document."""

    text: str
    page: int | None
    chunk_index: int
    source_file: str


# ---------------------------------------------------------------------------
# Token helpers
# ---------------------------------------------------------------------------


def _token_count(text: str) -> int:
    return len(_ENCODER.encode(text))


def _split_to_tokens(text: str, chunk_size: int, overlap: int) -> list[str]:
    """Split text into token-bounded chunks with overlap.

    Tries to break on sentence boundaries first. Falls back to whitespace.
    """
    # Attempt sentence-boundary split first
    sentences = _SENTENCE_END_RE.split(text)
    # Re-merge sentences into token-bounded windows
    chunks: list[str] = []
    current_tokens: list[int] = []
    current_text = ""

    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        s_tokens = _ENCODER.encode(sentence + " ")
        if len(current_tokens) + len(s_tokens) > chunk_size and current_tokens:
            # Flush current window
            chunks.append(current_text.strip())
            # Retain overlap tokens at the tail for the next chunk
            if overlap > 0:
                overlap_tokens = current_tokens[-overlap:]
                current_text = _ENCODER.decode(overlap_tokens) + " "
                current_tokens = overlap_tokens[:]
            else:
                current_text = ""
                current_tokens = []
        current_tokens.extend(s_tokens)
        current_text += sentence + " "

    if current_text.strip():
        chunks.append(current_text.strip())

    # Edge case: a single sentence exceeds chunk_size — hard-split by tokens
    result: list[str] = []
    for chunk in chunks:
        tokens = _ENCODER.encode(chunk)
        if len(tokens) <= chunk_size:
            result.append(chunk)
        else:
            # Hard-split with overlap
            start = 0
            while start < len(tokens):
                end = min(start + chunk_size, len(tokens))
                result.append(_ENCODER.decode(tokens[start:end]))
                start += chunk_size - overlap
    return result


# ---------------------------------------------------------------------------
# Format-specific text extraction
# ---------------------------------------------------------------------------


def _extract_pdf(file_path: Path) -> list[tuple[int, str]]:
    """Extract (page_number, text) tuples from a PDF using pdfplumber."""
    import pdfplumber  # deferred import — optional dependency

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


def _extract_docx(file_path: Path) -> list[tuple[int, str]]:
    """Extract (None, text) from a DOCX. DOCX has no page concept."""
    from docx import Document  # deferred import — optional dependency

    paragraphs: list[str] = []
    try:
        doc = Document(str(file_path))
        for para in doc.paragraphs:
            if para.text.strip():
                paragraphs.append(para.text)
    except Exception as exc:
        logger.error("python-docx failed on %s: %s", file_path, exc)
        return []
    return [(None, "\n".join(paragraphs))]  # type: ignore[list-item]


def _extract_txt(file_path: Path) -> list[tuple[int, str]]:
    """Read plain text file. No page metadata."""
    try:
        text = file_path.read_text(encoding="utf-8", errors="replace")
        return [(None, text)]  # type: ignore[list-item]
    except OSError as exc:
        logger.error("Failed to read %s: %s", file_path, exc)
        return []


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def chunk_document(
    file_path: str,
    chunk_size: int = 512,
    overlap: int = 64,
) -> list[Chunk]:
    """Parse a document and return a list of token-bounded Chunk objects.

    Args:
        file_path: Absolute or relative path to the document.
        chunk_size: Maximum number of tokens per chunk.
        overlap: Number of overlap tokens between consecutive chunks.

    Returns:
        List of Chunk objects, empty on parse failure.
    """
    path = Path(file_path)
    suffix = path.suffix.lower()
    source_name = path.name

    if suffix == ".pdf":
        page_texts = _extract_pdf(path)
    elif suffix in (".docx", ".doc"):
        page_texts = _extract_docx(path)
    elif suffix in (".txt", ".md", ".log", ".csv"):
        page_texts = _extract_txt(path)
    else:
        # Attempt plain text fallback for unknown extensions
        logger.warning("Unknown extension '%s' for %s — attempting plain text", suffix, path.name)
        page_texts = _extract_txt(path)

    if not page_texts:
        logger.warning("No text extracted from %s", file_path)
        return []

    chunks: list[Chunk] = []
    chunk_index = 0

    for page_num, text in page_texts:
        if not text.strip():
            continue
        sub_chunks = _split_to_tokens(text, chunk_size=chunk_size, overlap=overlap)
        for sub in sub_chunks:
            if not sub.strip():
                continue
            chunks.append(
                Chunk(
                    text=sub,
                    page=page_num,
                    chunk_index=chunk_index,
                    source_file=source_name,
                )
            )
            chunk_index += 1

    logger.info(
        "Chunked %s → %d chunks (chunk_size=%d, overlap=%d)",
        source_name,
        len(chunks),
        chunk_size,
        overlap,
    )
    return chunks
