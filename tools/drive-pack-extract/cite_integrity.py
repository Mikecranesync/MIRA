"""Cite-integrity gate for the drive-pack manual extractor.

Every fault/parameter entry the extractor emits carries a citation claiming a
manual excerpt lives on a specific page. This module is the anti-fabrication
check: it re-opens the source PDF, reads that page's OWN ``extract_text()``,
and confirms the excerpt genuinely appears there — words in order — before
the extractor is allowed to keep the entry.

Pure read: opens the PDF read-only via pdfplumber. No fieldbus, no sockets,
no DB, no writes of any kind (stricter even than
``.claude/rules/fieldbus-readonly.md``, which scopes device I/O — this module
does no I/O beyond reading the PDF file it is given).
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

import pdfplumber

logger = logging.getLogger("drive-pack-extract.cite_integrity")

_WHITESPACE_RE = re.compile(r"\s+")


def normalize(text: str) -> str:
    """Collapse all whitespace — including the line-wraps ``extract_text()``
    introduces inside a single logical sentence — to single spaces.

    This is what makes ``verify_excerpt_on_page`` tolerant of PDF line
    wrapping while still requiring the excerpt's words to appear *in order*:
    both the page text and the excerpt are normalized the same way before the
    substring check.
    """
    return _WHITESPACE_RE.sub(" ", text).strip()


def verify_excerpt_on_page(pdf_path: str | Path, page: int, excerpt: str) -> bool:
    """Return True iff ``excerpt`` genuinely appears on ``page`` of ``pdf_path``.

    ``page`` is 1-indexed, matching pdfplumber's ``Page.page_number``. Re-reads
    the PDF from disk on every call — this function never trusts a cached
    copy of the text or whatever the caller claims the page said. An empty or
    whitespace-only excerpt is never verifiable (an entry must cite real text,
    not nothing).
    """
    excerpt_norm = normalize(excerpt)
    if not excerpt_norm:
        return False

    with pdfplumber.open(str(pdf_path)) as pdf:
        for pdf_page in pdf.pages:
            if pdf_page.page_number == page:
                page_text = pdf_page.extract_text() or ""
                return excerpt_norm in normalize(page_text)

    logger.warning("cite_integrity: page %s not found in %s", page, pdf_path)
    return False
