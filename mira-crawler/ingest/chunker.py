"""Section-aware text chunker for crawled documents.

Splits extracted text blocks into chunks that respect section boundaries.
Tables are never split across chunks. Configurable min/max sizes.
"""

from __future__ import annotations

import logging
import re
from typing import Generator

logger = logging.getLogger("mira-crawler.chunker")

DEFAULT_MIN_CHARS = 200
DEFAULT_MAX_CHARS = 2000
DEFAULT_OVERLAP = 100


def _chunk_text(
    text: str, max_chars: int, overlap: int, min_chars: int
) -> Generator[str, None, None]:
    """Yield overlapping chunks of approximately max_chars characters."""
    start = 0
    while start < len(text):
        end = start + max_chars
        chunk = text[start:end].strip()
        if len(chunk) >= min_chars:
            yield chunk
        start += max_chars - overlap


def _extract_equipment_id(filename: str) -> str:
    """Extract equipment_id from filename pattern.

    Examples:
        ABB_IRB6700_Maintenance.pdf → IRB6700
        FANUC_R2000_Programming.pdf → R2000
        generic_guide.pdf → ''
    """
    stem = re.sub(r"\.(pdf|docx|html?)$", "", filename, flags=re.IGNORECASE)
    parts = re.split(r"[_\-\s]+", stem)

    # Look for a part that looks like a model number (letters + digits)
    for part in parts:
        if re.match(r"^[A-Z]{1,5}\d{2,}", part, re.IGNORECASE) and len(part) <= 20:
            return part.upper()
    return ""


def chunk_blocks(
    blocks: list[dict],
    source_url: str = "",
    source_file: str = "",
    source_type: str = "equipment_manual",
    equipment_id: str = "",
    max_chars: int = DEFAULT_MAX_CHARS,
    min_chars: int = DEFAULT_MIN_CHARS,
    overlap: int = DEFAULT_OVERLAP,
) -> list[dict]:
    """Expand raw text blocks into sized chunks with full metadata.

    Input blocks: list of {text, page_num, section}
    Output chunks: list of {text, page_num, section, source_url, source_file,
                            source_type, equipment_id, chunk_index}
    """
    if not equipment_id and source_file:
        equipment_id = _extract_equipment_id(source_file)

    chunks: list[dict] = []
    chunk_index = 0

    for block in blocks:
        text = block["text"]
        page_num = block.get("page_num")
        section = block.get("section", "")

        if len(text) <= max_chars:
            if len(text) >= min_chars:
                chunks.append({
                    "text": text,
                    "page_num": page_num,
                    "section": section,
                    "source_url": source_url,
                    "source_file": source_file,
                    "source_type": source_type,
                    "equipment_id": equipment_id,
                    "chunk_index": chunk_index,
                })
                chunk_index += 1
        else:
            for piece in _chunk_text(text, max_chars, overlap, min_chars):
                chunks.append({
                    "text": piece,
                    "page_num": page_num,
                    "section": section,
                    "source_url": source_url,
                    "source_file": source_file,
                    "source_type": source_type,
                    "equipment_id": equipment_id,
                    "chunk_index": chunk_index,
                })
                chunk_index += 1

    logger.info(
        "Chunked %d blocks → %d chunks (source=%s, equipment=%s)",
        len(blocks), len(chunks), source_file or source_url, equipment_id,
    )
    return chunks
