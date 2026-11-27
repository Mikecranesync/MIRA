"""PDF page label extraction utility.

Extracts the printed page labels from PDF metadata (/PageLabels dictionary)
or falls back to detecting page numbers from headers/footers via OCR text.

Used by the ingest pipeline to store accurate page citations that match what
a technician sees in the printed manual.

References:
- https://github.com/Mikecranesync/MIRA/issues/4794
- PDF Reference 1.7, Section 8.3.1 (Page Labels)
"""

from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger("pdf_page_labels")


def extract_page_labels(pdf_bytes: bytes) -> dict[int, str]:
    """Extract printed page labels from a PDF.

    Returns a dict mapping 0-indexed page numbers to their printed labels.
    Example: {0: "i", 1: "ii", 2: "iii", 3: "1", 4: "2", ...}

    Falls back to detecting page numbers from headers/footers if no PDF
    /PageLabels metadata exists.

    Args:
        pdf_bytes: Raw PDF file bytes

    Returns:
        Dict mapping page index (0-based) to printed page label string.
        Empty dict if no labels can be extracted.
    """
    try:
        import fitz  # PyMuPDF

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except ImportError:
        logger.warning("PyMuPDF not available — cannot extract page labels")
        return {}
    except Exception as e:
        logger.warning("Failed to open PDF for page label extraction: %s", e)
        return {}

    try:
        # First try: PDF /PageLabels metadata
        labels = _extract_from_metadata(doc)
        if labels:
            logger.info("Extracted %d page labels from PDF metadata", len(labels))
            return labels

        # Fallback: detect from headers/footers
        labels = _extract_from_text(doc)
        if labels:
            logger.info("Detected %d page labels from headers/footers", len(labels))
            return labels

        logger.debug("No page labels found in PDF (no metadata, no detectable headers)")
        return {}

    finally:
        doc.close()


def _extract_from_metadata(doc: Any) -> dict[int, str]:
    """Extract page labels from PDF /PageLabels dictionary."""
    labels: dict[int, str] = {}

    try:
        # PyMuPDF exposes page labels via doc.get_page_labels()
        # Returns list of dicts: [{'startpage': 0, 'prefix': '', 'style': 'D', 'firstpagenum': 1}, ...]
        label_specs = doc.get_page_labels()
        if not label_specs:
            return {}

        # Build labels for all pages based on the label rules
        for i in range(len(doc)):
            label = doc[i].get_label()
            if label:
                labels[i] = label

    except Exception as e:
        logger.debug("Failed to extract PDF page labels from metadata: %s", e)

    return labels


# Patterns for detecting page numbers in headers/footers
_PAGE_NUMBER_RE = re.compile(
    r"""
    (?:^|\s)                        # Start or whitespace
    (?:
        (?P<roman>[ivxlcdm]{1,7})   # Roman numerals (lowercase)
        |(?P<ROMAN>[IVXLCDM]{1,7})  # Roman numerals (uppercase)
        |(?P<arabic>\d{1,4})        # Arabic numerals
    )
    (?:\s|$)                        # Whitespace or end
    """,
    re.VERBOSE | re.IGNORECASE,
)


def _extract_from_text(doc: Any) -> dict[int, str]:
    """Detect page numbers from headers/footers using OCR text.

    Looks at the top and bottom 10% of each page for isolated numbers or
    roman numerals that increment consistently.
    """
    labels: dict[int, str] = {}

    # Sample every Nth page to detect pattern, then fill in the gaps
    sample_pages = list(range(0, len(doc), max(1, len(doc) // 20)))[:20]

    candidates: list[tuple[int, str]] = []
    for page_idx in sample_pages:
        try:
            page = doc[page_idx]
            text = page.get_text()
            if not text:
                continue

            # Look at top and bottom 10% of page
            lines = text.split("\n")
            if not lines:
                continue

            header_lines = lines[: max(1, len(lines) // 10)]
            footer_lines = lines[-max(1, len(lines) // 10) :]

            # Find page number candidates in header/footer
            for line in header_lines + footer_lines:
                line = line.strip()
                # Skip long lines (not page numbers)
                if len(line) > 20:
                    continue

                match = _PAGE_NUMBER_RE.search(line)
                if match:
                    # Prefer the most isolated match (shortest surrounding text)
                    label = match.group("arabic") or match.group("roman") or match.group("ROMAN")
                    if label:
                        candidates.append((page_idx, label))
                        break  # One per page

        except Exception as e:
            logger.debug("Failed to extract text from page %d: %s", page_idx, e)

    if not candidates:
        return {}

    # Validate that candidates form a consistent sequence
    # (incrementing numbers or roman numerals)
    if _is_consistent_sequence(candidates):
        # Interpolate labels for all pages based on the detected pattern
        return _interpolate_labels(candidates, len(doc))

    return {}


def _is_consistent_sequence(candidates: list[tuple[int, str]]) -> bool:
    """Check if detected page labels form a consistent incrementing sequence."""
    if len(candidates) < 2:
        return False

    # Check if all are arabic numerals and increment correctly
    try:
        values = [int(label) for _, label in candidates]
        page_indices = [idx for idx, _ in candidates]

        # Check if values increment by the same amount as page indices
        for i in range(1, len(values)):
            value_diff = values[i] - values[i - 1]
            page_diff = page_indices[i] - page_indices[i - 1]
            if value_diff != page_diff:
                return False
        return True

    except ValueError:
        # Not all arabic — could be roman numerals
        # For now, just accept sequences of length >= 3 as likely valid
        return len(candidates) >= 3


def _interpolate_labels(
    candidates: list[tuple[int, str]], total_pages: int
) -> dict[int, str]:
    """Interpolate page labels for all pages based on detected pattern."""
    if not candidates:
        return {}

    labels: dict[int, str] = {}

    # Try arabic numeral interpolation
    try:
        first_page_idx, first_label = candidates[0]
        first_value = int(first_label)

        # Calculate offset: printed page number = page_idx + offset
        offset = first_value - first_page_idx

        for page_idx in range(total_pages):
            printed_number = page_idx + offset
            if printed_number > 0:
                labels[page_idx] = str(printed_number)

    except ValueError:
        # Roman numerals or other format — only use detected values
        for page_idx, label in candidates:
            labels[page_idx] = label

    return labels


def get_page_label(pdf_bytes: bytes, page_index: int) -> str | None:
    """Get the printed page label for a single page.

    Args:
        pdf_bytes: Raw PDF file bytes
        page_index: 0-based page index

    Returns:
        Printed page label string, or None if not available
    """
    labels = extract_page_labels(pdf_bytes)
    return labels.get(page_index)


def format_page_citation(page_index: int | None, page_label: str | None) -> str:
    """Format a page citation for display.

    Args:
        page_index: 0-based PDF page index (for fallback)
        page_label: Printed page label from PDF metadata or detection

    Returns:
        Human-readable page citation: "p. 2-15" or "PDF p. 13"
    """
    if page_label:
        return f"p. {page_label}"
    elif page_index is not None and page_index >= 0:
        # Fallback: show PDF page number (1-indexed for humans)
        return f"PDF p. {page_index + 1}"
    else:
        return ""
