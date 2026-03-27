"""Section-aware text chunker for crawled documents.

Splits extracted text blocks into chunks that respect section boundaries.
Tables are detected and kept intact (or split only at row boundaries).
Configurable min/max sizes.
"""

from __future__ import annotations

import logging
import re
from typing import Generator

logger = logging.getLogger("mira-crawler.chunker")

DEFAULT_MIN_CHARS = 200
DEFAULT_MAX_CHARS = 2000
DEFAULT_OVERLAP = 100
TABLE_MAX_CHARS = 1200

_PIPE_TABLE_RE = re.compile(r"^\s*\|.+\|.+\|")
_SEPARATOR_RE = re.compile(r"^\s*\|[\s\-:]+(\|[\s\-:]+)+\|?\s*$")


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


# ---------------------------------------------------------------------------
# Table detection helpers
# ---------------------------------------------------------------------------


def _is_pipe_table_line(line: str) -> bool:
    """Return True if line looks like a pipe-delimited table row."""
    return bool(_PIPE_TABLE_RE.match(line))


def _is_separator_line(line: str) -> bool:
    """Return True if line is a markdown table separator (|---|---|)."""
    return bool(_SEPARATOR_RE.match(line))


def _is_tab_table_line(line: str) -> bool:
    """Return True if line has 2+ tab characters (tabular data)."""
    return line.count("\t") >= 2


def _detect_table_regions(text: str) -> list[tuple[int, int, str, str]]:
    """Find contiguous table regions in text.

    Returns list of (start_line_idx, end_line_idx, header_line, separator_line)
    tuples.  A region requires 3+ consecutive lines matching table heuristics.
    """
    lines = text.split("\n")
    regions: list[tuple[int, int, str, str]] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if _is_pipe_table_line(line) or _is_tab_table_line(line):
            start = i
            header = line
            separator = ""
            # Check for separator line right after header
            if i + 1 < len(lines) and _is_separator_line(lines[i + 1]):
                separator = lines[i + 1]
                i += 2
            else:
                i += 1
            # Consume consecutive table lines
            while i < len(lines) and (
                _is_pipe_table_line(lines[i])
                or _is_tab_table_line(lines[i])
                or _is_separator_line(lines[i])
            ):
                i += 1
            # Require at least 3 lines for a table (header + separator/row + row)
            if i - start >= 3:
                regions.append((start, i, header, separator))
        else:
            i += 1
    return regions


def _split_table(
    table_text: str,
    header_line: str,
    separator_line: str,
    max_chars: int = TABLE_MAX_CHARS,
) -> list[str]:
    """Split a table at row boundaries, prepending header to every split.

    If table_text <= max_chars, returns [table_text] unchanged.
    Otherwise splits between rows so each chunk gets header + separator prepended.
    """
    if len(table_text) <= max_chars:
        return [table_text]

    lines = table_text.split("\n")
    # Build the prefix that goes on every split chunk
    prefix_parts = [header_line]
    if separator_line:
        prefix_parts.append(separator_line)
    prefix = "\n".join(prefix_parts)
    prefix_len = len(prefix) + 1  # +1 for the newline after prefix

    # Identify data rows (skip header and separator already in prefix)
    skip = len(prefix_parts)
    data_rows = lines[skip:]

    chunks: list[str] = []
    current_rows: list[str] = []
    current_len = prefix_len

    for row in data_rows:
        row_len = len(row) + 1  # +1 for newline
        if current_rows and current_len + row_len > max_chars:
            chunk = prefix + "\n" + "\n".join(current_rows)
            chunks.append(chunk)
            current_rows = []
            current_len = prefix_len
        current_rows.append(row)
        current_len += row_len

    if current_rows:
        chunk = prefix + "\n" + "\n".join(current_rows)
        chunks.append(chunk)

    return chunks if chunks else [table_text]


def _split_block_with_tables(
    text: str,
    max_chars: int,
    overlap: int,
    min_chars: int,
) -> list[tuple[str, str]]:
    """Split a block into (chunk_text, chunk_type) pairs.

    Detects table regions, extracts them as table chunks, runs remaining
    prose through _chunk_text().
    """
    regions = _detect_table_regions(text)
    if not regions:
        return [(piece, "text") for piece in _chunk_text(text, max_chars, overlap, min_chars)]

    lines = text.split("\n")
    results: list[tuple[str, str]] = []
    prev_end = 0

    for start, end, header, separator in regions:
        # Process prose before this table
        if start > prev_end:
            prose = "\n".join(lines[prev_end:start]).strip()
            if prose:
                for piece in _chunk_text(prose, max_chars, overlap, min_chars):
                    results.append((piece, "text"))

        # Process the table
        table_text = "\n".join(lines[start:end]).strip()
        for piece in _split_table(table_text, header, separator, TABLE_MAX_CHARS):
            if len(piece.strip()) >= min_chars:
                results.append((piece, "table"))

        prev_end = end

    # Process trailing prose after last table
    if prev_end < len(lines):
        prose = "\n".join(lines[prev_end:]).strip()
        if prose:
            for piece in _chunk_text(prose, max_chars, overlap, min_chars):
                results.append((piece, "text"))

    return results


def _has_table(text: str) -> bool:
    """Quick check whether text contains any table region."""
    return bool(_detect_table_regions(text))


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
                            source_type, equipment_id, chunk_index, chunk_type}
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
                chunk_type = "table" if _has_table(text) else "text"
                chunks.append({
                    "text": text,
                    "page_num": page_num,
                    "section": section,
                    "source_url": source_url,
                    "source_file": source_file,
                    "source_type": source_type,
                    "equipment_id": equipment_id,
                    "chunk_index": chunk_index,
                    "chunk_type": chunk_type,
                })
                chunk_index += 1
        else:
            for piece, chunk_type in _split_block_with_tables(
                text, max_chars, overlap, min_chars
            ):
                chunks.append({
                    "text": piece,
                    "page_num": page_num,
                    "section": section,
                    "source_url": source_url,
                    "source_file": source_file,
                    "source_type": source_type,
                    "equipment_id": equipment_id,
                    "chunk_index": chunk_index,
                    "chunk_type": chunk_type,
                })
                chunk_index += 1

    logger.info(
        "Chunked %d blocks → %d chunks (source=%s, equipment=%s)",
        len(blocks), len(chunks), source_file or source_url, equipment_id,
    )
    return chunks
