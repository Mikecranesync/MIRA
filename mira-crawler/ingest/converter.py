"""Document converter — PDF/HTML → structured text blocks.

Supports two backends:
- pdfplumber (default, fast, text-layer PDFs only)
- Docling (opt-in via USE_DOCLING=true, ML-powered, handles scanned PDFs)

Returns list[dict] with keys {text, page_num, section, chunk_type?}.
Tables in PDFs are emitted as separate chunks with chunk_type="table" and
markdown-formatted text; pdfplumber's extract_text() alone would flatten
table structure into whitespace and lose rows/columns.

All exceptions caught — never crashes on bad input.
"""

from __future__ import annotations

import io
import logging
import re
from typing import Sequence

logger = logging.getLogger("mira-crawler.converter")

_BOILERPLATE_RE = re.compile(
    r"(?:^\d{1,4}$)|(?:www\.\S+\.com)",
    re.MULTILINE,
)


def _clean_text(text: str) -> str:
    """Strip boilerplate noise from page text."""
    text = _BOILERPLATE_RE.sub("", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _detect_sections(page_text: str) -> list[tuple[str, str]]:
    """Split page text into (heading, body) sections."""
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
            and (stripped.istitle() or stripped.isupper() or re.match(r"^\d+[\.\-]\d+", stripped))
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


def _format_table_markdown(table: "Sequence[Sequence[str | None]]") -> str:
    """Convert a pdfplumber table (list of rows) into GitHub-flavored markdown.

    Returns empty string if the table is too small to be meaningful
    (<2 non-empty rows or <2 columns after normalization).
    """
    if not table:
        return ""

    rows = [
        [(cell or "").replace("\n", " ").replace("|", "\\|").strip() for cell in row]
        for row in table
    ]
    rows = [r for r in rows if any(c for c in r)]
    if len(rows) < 2:
        return ""

    width = max(len(r) for r in rows)
    if width < 2:
        return ""
    rows = [r + [""] * (width - len(r)) for r in rows]

    header, body = rows[0], rows[1:]
    lines = [
        "| " + " | ".join(header) + " |",
        "|" + "|".join(["---"] * width) + "|",
    ]
    lines.extend("| " + " | ".join(r) + " |" for r in body)
    return "\n".join(lines)


def extract_from_pdf(
    data: bytes, max_pages: int = 300, min_chars: int = 80
) -> list[dict]:
    """Extract text + table blocks from PDF bytes using pdfplumber.

    Returns list of {text, page_num, section, chunk_type?} dicts.
    Tables are emitted as separate chunks with chunk_type="table" and
    markdown-formatted text. Text and table chunks are both returned so
    retrieval can rank them independently.
    """
    try:
        import pdfplumber
    except ImportError:
        logger.error("pdfplumber not installed")
        return []

    blocks: list[dict] = []
    table_count = 0
    try:
        with pdfplumber.open(io.BytesIO(data)) as doc:
            pages_to_read = min(len(doc.pages), max_pages)
            for page_idx in range(pages_to_read):
                page = doc.pages[page_idx]
                raw = page.extract_text()
                sections: list[tuple[str, str]] = []
                if raw and len(raw.strip()) >= 50:
                    text = _clean_text(raw)
                    sections = _detect_sections(text) or [("", text)]
                    for heading, body in sections:
                        if len(body) >= min_chars:
                            blocks.append({
                                "text": body,
                                "page_num": page_idx + 1,
                                "section": heading,
                            })

                try:
                    tables = page.extract_tables() or []
                except Exception as e:
                    # pdfplumber raises on some malformed pages; skip tables on this page only
                    logger.debug("table extraction failed on page %d: %s", page_idx + 1, e)
                    tables = []
                heading_for_tables = sections[-1][0] if sections else ""
                for table in tables:
                    md = _format_table_markdown(table)
                    if len(md) >= min_chars:
                        blocks.append({
                            "text": md,
                            "page_num": page_idx + 1,
                            "section": heading_for_tables,
                            "chunk_type": "table",
                        })
                        table_count += 1
    except Exception as e:
        logger.warning("PDF extraction failed: %s", e)
        return []

    logger.info(
        "Extracted %d blocks from PDF (%d pages read, %d table chunks)",
        len(blocks), pages_to_read, table_count,
    )
    return blocks


def extract_from_html(data: bytes, min_chars: int = 80) -> list[dict]:
    """Extract text blocks from HTML bytes using BeautifulSoup.

    Returns list of {text, page_num, section} dicts.
    """
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        logger.error("beautifulsoup4 not installed")
        return []

    soup = BeautifulSoup(data, "html.parser")
    for tag in soup(["script", "style", "nav", "header", "footer"]):
        tag.decompose()

    blocks: list[dict] = []
    for para in soup.find_all("p"):
        text = para.get_text(" ", strip=True)
        if len(text) >= min_chars:
            blocks.append({"text": text, "page_num": None, "section": ""})

    if not blocks:
        full = soup.get_text("\n", strip=True)
        full = _clean_text(full)
        if len(full) >= min_chars:
            blocks.append({"text": full, "page_num": None, "section": ""})

    logger.info("Extracted %d blocks from HTML", len(blocks))
    return blocks


def extract_from_tika(
    data: bytes, max_pages: int = 300, min_chars: int = 80
) -> list[dict]:
    """Extract text from PDF bytes using Apache Tika server.

    Tika handles scanned/image-heavy PDFs via OCR (Tesseract built into the
    container). Falls back to empty list if Tika is unreachable.

    Requires TIKA_URL env var (default: http://mira-tika:9998 in Docker,
    http://localhost:9998 locally).
    """
    import os

    import httpx

    tika_url = os.getenv("TIKA_URL", "http://mira-tika:9998")

    try:
        with httpx.Client(timeout=120) as client:
            resp = client.put(
                f"{tika_url}/tika",
                content=data,
                headers={
                    "Content-Type": "application/pdf",
                    "Accept": "text/plain",
                },
            )
            resp.raise_for_status()
            raw_text = resp.text
    except Exception as e:
        logger.warning("Tika extraction failed: %s", e)
        return []

    if not raw_text or len(raw_text.strip()) < 50:
        logger.info("Tika returned empty/minimal text")
        return []

    blocks: list[dict] = []
    sections = _detect_sections(_clean_text(raw_text))
    if not sections:
        sections = [("", _clean_text(raw_text))]

    for heading, body in sections:
        if len(body) >= min_chars:
            blocks.append({
                "text": body,
                "page_num": None,
                "section": heading,
            })

    logger.info("Tika extracted %d blocks from PDF", len(blocks))
    return blocks


def extract_from_pdf_with_fallback(
    data: bytes, max_pages: int = 300, min_chars: int = 80
) -> list[dict]:
    """Try pdfplumber first; if it yields few results, fall back to Tika.

    Scanned PDFs have no text layer — pdfplumber returns empty, but Tika
    runs OCR and extracts text. This function handles both transparently.
    """
    blocks = extract_from_pdf(data, max_pages=max_pages, min_chars=min_chars)

    if len(blocks) >= 3:
        return blocks

    logger.info(
        "pdfplumber yielded only %d blocks — trying Tika OCR fallback", len(blocks)
    )
    tika_blocks = extract_from_tika(data, max_pages=max_pages, min_chars=min_chars)

    if len(tika_blocks) > len(blocks):
        logger.info("Tika produced %d blocks (vs pdfplumber %d) — using Tika", len(tika_blocks), len(blocks))
        return tika_blocks

    return blocks


def extract_from_docling(
    data: bytes, max_pages: int = 300, min_chars: int = 80
) -> list[dict]:
    """Extract text blocks from PDF bytes using Docling adapter.

    Requires docling to be installed. Falls back to empty list on failure.
    Returns list of {text, page_num, section} dicts.
    """
    try:
        import sys
        from pathlib import Path

        # Import the existing DoclingAdapter from mira-core/scripts
        scripts_dir = Path(__file__).resolve().parent.parent.parent / "mira-core" / "scripts"
        sys.path.insert(0, str(scripts_dir))
        from docling_adapter import DoclingAdapter
    except ImportError as e:
        logger.warning("Docling not available: %s — returning empty", e)
        return []

    adapter = DoclingAdapter(max_pages=max_pages, min_chunk_chars=min_chars)
    return adapter.extract_from_pdf(data)
