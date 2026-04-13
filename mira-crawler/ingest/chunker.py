"""Section-aware text chunker for crawled documents.

Splits extracted text blocks into chunks that respect section and sentence
boundaries. Tables are detected and kept intact (or split only at row
boundaries). Configurable min/max sizes.

Token hard cap ensures chunks stay under MAX_TOKENS (default 2000) for
compatibility with EmbeddingGemma (2048 token context) and nomic-embed-text.
Uses tiktoken when available, falls back to len(text)//4 estimate.
"""

from __future__ import annotations

import logging
import re
from typing import Generator

logger = logging.getLogger("mira-crawler.chunker")

DEFAULT_MIN_CHARS = 200
DEFAULT_MAX_CHARS = 2000
DEFAULT_OVERLAP = 200
TABLE_MAX_CHARS = 1200
MAX_TOKENS = 2000  # hard cap — leaves 48 tokens headroom for embedding task prefixes

# Token counting: tiktoken if available, else conservative char estimate
try:
    import tiktoken
    _ENCODER = tiktoken.get_encoding("cl100k_base")

    def _token_len(text: str) -> int:
        return len(_ENCODER.encode(text))

    def _token_truncate(text: str, max_tokens: int) -> str:
        tokens = _ENCODER.encode(text)
        if len(tokens) <= max_tokens:
            return text
        return _ENCODER.decode(tokens[:max_tokens])

except ImportError:
    logger.info("tiktoken not available — using char//4 estimate for token counts")

    def _token_len(text: str) -> int:
        return len(text) // 4

    def _token_truncate(text: str, max_tokens: int) -> str:
        max_chars = max_tokens * 4
        return text[:max_chars] if len(text) > max_chars else text

_PIPE_TABLE_RE = re.compile(r"^\s*\|.+\|.+\|")
_SEPARATOR_RE = re.compile(r"^\s*\|[\s\-:]+(\|[\s\-:]+)+\|?\s*$")

# Abbreviations that end in "." but are NOT sentence boundaries.
# Common in industrial maintenance manuals.
_ABBREV_EXCEPTIONS = frozenset({
    "fig.", "no.", "eq.", "pp.", "vol.", "vs.", "approx.",
    "min.", "max.", "sec.", "ref.", "e.g.", "i.e.", "etc.",
    "in.", "ft.", "lb.", "hp.", "dr.", "mr.", "mrs.", "st.",
    "dept.", "inc.", "corp.", "mfr.", "mfg.", "temp.", "qty.",
    "dia.", "dim.", "tol.", "assy.", "mtg.", "adj.",
})

# Sentence-ending punctuation followed by whitespace or end of string
_SENTENCE_END_RE = re.compile(r"[.?!]\s")


def _find_sentence_boundary(text: str, target_pos: int, lookahead: int = 150) -> int | None:
    """Find the nearest sentence boundary at or after target_pos.

    Scans forward from target_pos up to lookahead chars. A boundary is
    a period, question mark, or exclamation mark followed by whitespace,
    excluding common abbreviations.

    Returns the position AFTER the whitespace (start of next sentence),
    or None if no boundary found within lookahead.
    """
    end = min(target_pos + lookahead, len(text))
    search_region = text[target_pos:end]

    for m in _SENTENCE_END_RE.finditer(search_region):
        # Check if the period is part of an abbreviation
        dot_pos = target_pos + m.start()
        # Look back up to 10 chars for the abbreviation
        lookback_start = max(0, dot_pos - 10)
        before = text[lookback_start:dot_pos + 1].lower()
        is_abbrev = any(before.endswith(abbr) for abbr in _ABBREV_EXCEPTIONS)
        if not is_abbrev:
            # Return position after the whitespace
            return target_pos + m.end()

    return None


def _last_sentence_overlap(chunk: str, max_overlap: int = 200) -> str:
    """Extract the last complete sentence from a chunk for overlap.

    Returns the last sentence (up to max_overlap chars). If the last
    sentence exceeds max_overlap, returns the last max_overlap chars.
    """
    # Find the last sentence boundary before the end
    # Search backwards for sentence-ending punctuation followed by space
    matches = list(_SENTENCE_END_RE.finditer(chunk))
    if len(matches) >= 2:
        # Last match is the end of the last sentence; second-to-last is where
        # the last sentence starts
        last_sentence_start = matches[-2].end()
        overlap = chunk[last_sentence_start:]
        if len(overlap) <= max_overlap:
            return overlap
    # Fallback: last max_overlap chars
    if len(chunk) > max_overlap:
        return chunk[-max_overlap:]
    return chunk


def _chunk_text(
    text: str, max_chars: int, overlap: int, min_chars: int
) -> Generator[str, None, None]:
    """Yield overlapping chunks of approximately max_chars characters.

    Legacy character-based splitter. Used when sentence_aware=False.
    """
    start = 0
    while start < len(text):
        end = start + max_chars
        chunk = text[start:end].strip()
        if len(chunk) >= min_chars:
            yield chunk
        start += max_chars - overlap


def _chunk_text_sentence_aware(
    text: str, max_chars: int, overlap: int, min_chars: int
) -> Generator[tuple[str, str], None, None]:
    """Yield (chunk_text, chunk_quality) tuples with sentence-aware splitting.

    Splits at sentence boundaries when possible. Falls back to character
    split when no boundary is found within the lookahead window.
    chunk_quality is "sentence_split" or "fallback_char_split".
    """
    start = 0
    while start < len(text):
        remaining = len(text) - start

        # If remaining text fits in one chunk, emit it
        if remaining <= max_chars:
            chunk = text[start:].strip()
            if len(chunk) >= min_chars:
                yield (chunk, "sentence_split")
            break

        # Try to find a sentence boundary near max_chars
        boundary = _find_sentence_boundary(text, start + max_chars)

        if boundary is not None and boundary <= start + max_chars + 150:
            chunk = text[start:boundary].strip()
            quality = "sentence_split"
        else:
            # Fallback to hard character split
            chunk = text[start:start + max_chars].strip()
            quality = "fallback_char_split"
            boundary = start + max_chars
            logger.warning(
                "No sentence boundary found at pos %d — falling back to char split",
                start + max_chars,
            )

        if len(chunk) >= min_chars:
            yield (chunk, quality)

        # Advance: use sentence-based overlap when possible
        if quality == "sentence_split":
            overlap_text = _last_sentence_overlap(chunk, max_overlap=overlap)
            start = boundary - len(overlap_text)
        else:
            start = boundary - overlap

        # Safety: ensure forward progress
        if start <= (boundary - len(text[start:boundary]) if boundary > start else start):
            start = boundary


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
    sentence_aware: bool = True,
) -> list[tuple[str, str, str]]:
    """Split a block into (chunk_text, chunk_type, chunk_quality) triples.

    Detects table regions, extracts them as table chunks, runs remaining
    prose through sentence-aware or character-based splitting.
    """
    regions = _detect_table_regions(text)
    if not regions:
        if sentence_aware:
            return [
                (piece, "text", quality)
                for piece, quality in _chunk_text_sentence_aware(
                    text, max_chars, overlap, min_chars
                )
            ]
        return [
            (piece, "text", "fallback_char_split")
            for piece in _chunk_text(text, max_chars, overlap, min_chars)
        ]

    lines = text.split("\n")
    results: list[tuple[str, str, str]] = []
    prev_end = 0

    for start, end, header, separator in regions:
        # Process prose before this table
        if start > prev_end:
            prose = "\n".join(lines[prev_end:start]).strip()
            if prose:
                if sentence_aware:
                    for piece, quality in _chunk_text_sentence_aware(
                        prose, max_chars, overlap, min_chars
                    ):
                        results.append((piece, "text", quality))
                else:
                    for piece in _chunk_text(prose, max_chars, overlap, min_chars):
                        results.append((piece, "text", "fallback_char_split"))

        # Process the table
        table_text = "\n".join(lines[start:end]).strip()
        for piece in _split_table(table_text, header, separator, TABLE_MAX_CHARS):
            if len(piece.strip()) >= min_chars:
                results.append((piece, "table", "table"))

        prev_end = end

    # Process trailing prose after last table
    if prev_end < len(lines):
        prose = "\n".join(lines[prev_end:]).strip()
        if prose:
            if sentence_aware:
                for piece, quality in _chunk_text_sentence_aware(
                    prose, max_chars, overlap, min_chars
                ):
                    results.append((piece, "text", quality))
            else:
                for piece in _chunk_text(prose, max_chars, overlap, min_chars):
                    results.append((piece, "text", "fallback_char_split"))

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
    sentence_aware: bool = True,
) -> list[dict]:
    """Expand raw text blocks into sized chunks with full metadata.

    Input blocks: list of {text, page_num, section}
    Output chunks: list of {text, page_num, section, source_url, source_file,
                            source_type, equipment_id, chunk_index, chunk_type,
                            chunk_quality}

    When sentence_aware=True (default), prose is split at sentence boundaries.
    Tables always split at row boundaries regardless of this setting.
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
                chunk_quality = "table" if chunk_type == "table" else "sentence_split"
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
                    "chunk_quality": chunk_quality,
                })
                chunk_index += 1
        else:
            for piece, chunk_type, chunk_quality in _split_block_with_tables(
                text, max_chars, overlap, min_chars, sentence_aware=sentence_aware,
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
                    "chunk_quality": chunk_quality,
                })
                chunk_index += 1

    # Token hard cap — ensure no chunk exceeds MAX_TOKENS for embedding models
    for chunk in chunks:
        if _token_len(chunk["text"]) > MAX_TOKENS:
            chunk["text"] = _token_truncate(chunk["text"], MAX_TOKENS)
            if chunk.get("chunk_quality") != "table":
                chunk["chunk_quality"] = "token_truncated"

    logger.info(
        "Chunked %d blocks → %d chunks (source=%s, equipment=%s)",
        len(blocks), len(chunks), source_file or source_url, equipment_id,
    )
    return chunks
