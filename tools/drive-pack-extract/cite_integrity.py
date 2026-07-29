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

# A CHAPTER-SECTION page label ("4-188", "3-6", "A-12") — the convention some
# OEM manuals (AutomationDirect DURApulse GS10/GS20) use instead of a single
# running page number. Such a label cannot be resolved to a pdfplumber page
# index without the manual's own page-label map, so a citation carrying one is
# verified whole-document instead (see ``verify_excerpt_in_document``).
_PAGE_LABEL_RE = re.compile(r"^\s*[0-9A-Za-z]+[-–][0-9]+[A-Za-z]?\s*$")


def is_chapter_section_label(page: object) -> bool:
    """True if ``page`` is a chapter-section label ("4-188") rather than an int
    page number. An int (or int-string like "162") is NOT a label."""
    if isinstance(page, int):
        return False
    if not isinstance(page, str):
        return False
    try:
        int(page)
    except ValueError:
        return bool(_PAGE_LABEL_RE.match(page))
    return False


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


def load_normalized_pages(
    pdf_path: str | Path, pages: set[int] | None = None
) -> dict[int, str]:
    """Read pages' NORMALIZED text once — ``{page_number: normalized_text}``.

    Batch helper: ``verify_excerpt_on_page`` / ``verify_excerpt_in_document`` each
    reopen the PDF from disk on every call (correct, and fine for a one-off
    check), which makes verifying a whole pack O(citations x pages) — ~90 s per
    whole-document call on a 274-page manual. A caller checking many citations
    against ONE manual should load the pages once via this helper and do the
    substring checks in memory (``excerpt_norm in pages[n]`` for a page-pinned
    cite, ``any(excerpt_norm in t for t in pages.values())`` for a whole-document
    one) — the same semantics, one read.

    ``pages`` (a set of 1-based page numbers) restricts the (expensive)
    ``extract_text`` to just those pages — pass the distinct integer pages a pack
    actually cites so a pack with citations on ~6 of a 156-page manual reads 6
    pages, not 156. ``pages=None`` reads the whole document (needed when a
    chapter-section-label citation must be verified against every page).
    """
    wanted = set(pages) if pages is not None else None
    out: dict[int, str] = {}
    with pdfplumber.open(str(pdf_path)) as pdf:
        for pdf_page in pdf.pages:
            if wanted is None or pdf_page.page_number in wanted:
                out[pdf_page.page_number] = normalize(pdf_page.extract_text() or "")
    return out


def verify_excerpt_in_document(pdf_path: str | Path, excerpt: str) -> bool:
    """Return True iff ``excerpt`` appears verbatim on SOME page of ``pdf_path``.

    The fallback for a citation whose ``page`` is a chapter-section label
    ("4-188") that can't be resolved to a physical pdfplumber page index. This
    verifies the excerpt is genuine manual text — it still catches a fabricated
    excerpt (invented text appears on no page) — but does NOT pin it to a
    specific page. A weaker, honest guarantee; callers report it distinctly from
    page-pinned verification. Same normalization as ``verify_excerpt_on_page``,
    so line-wrapping is tolerated. Reads the PDF once per call, never trusting a
    cached copy.
    """
    excerpt_norm = normalize(excerpt)
    if not excerpt_norm:
        return False

    with pdfplumber.open(str(pdf_path)) as pdf:
        for pdf_page in pdf.pages:
            if excerpt_norm in normalize(pdf_page.extract_text() or ""):
                return True
    return False
