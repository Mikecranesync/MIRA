"""Document IR — one-pass, vendor-agnostic PDF normalization.

The universal VFD manual compiler's foundation layer. Opens an OEM drive
manual ONCE and normalizes every requested page into a stable intermediate
representation the downstream layers (``table_discovery`` ->
``schema_inference`` -> ``generic_table_parser`` -> ``evidence_validator``)
all read from — so nothing below re-opens the PDF or re-runs ``extract_words``.

Pure read-only, offline: reads the PDF file it is given via pdfplumber, writes
nothing, opens no socket / DB / fieldbus (`.claude/rules/fieldbus-readonly.md`).

What each ``PageIR`` carries (all position-aware, matching the coordinate model
the existing ``extractor.py`` already parses against — x0/x1/top/bottom in PDF
points, top-left origin):

* ``words``      — pdfplumber ``extract_words`` dicts (``text``/``x0``/``x1``/
                   ``top``/``bottom`` + ``fontname``/``size``); the same
                   ``Word`` shape ``extractor._cluster_lines`` consumes.
* ``word_lines`` — words clustered into visual rows (``_LINE_TOL``), so table
                   discovery reasons over rows without re-clustering.
* ``edges``      — pdfplumber ruling edges (lines + rect borders), split into
                   ``h_edges`` / ``v_edges``; this is what tells a ruled table
                   (ABB/Schneider/Siemens) apart from an unruled one
                   (Yaskawa/Delta), and what ``page.extract_tables`` keys on.
* ``text``       — ``extract_text`` (used verbatim for cite-integrity excerpts).
* ``ocr_status`` — ``native`` (real text layer) / ``image_only`` (scanned, would
                   need OCR — flagged, never silently fabricated) / ``empty``.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pdfplumber

Word = dict[str, Any]
Edge = dict[str, Any]

_LINE_TOL = 2.5  # points — matches extractor._LINE_TOL (words within = one row)
_WORD_ATTRS = ["fontname", "size"]


def _cluster_lines(words: list[Word], tol: float = _LINE_TOL) -> list[list[Word]]:
    """Group words into visual rows, top-to-bottom then left-to-right.

    Identical semantics to ``extractor._cluster_lines`` (kept local so this
    foundation layer has no import cycle with the parser layer)."""
    ordered = sorted(words, key=lambda w: (w["top"], w["x0"]))
    lines: list[list[Word]] = []
    current: list[Word] = []
    for w in ordered:
        if current and abs(w["top"] - current[-1]["top"]) > tol:
            lines.append(current)
            current = []
        current.append(w)
    if current:
        lines.append(current)
    return lines


@dataclass
class PageIR:
    """Normalized single page. 1-indexed ``number`` matches pdfplumber."""

    number: int
    width: float
    height: float
    words: list[Word]
    word_lines: list[list[Word]]
    h_edges: list[Edge]
    v_edges: list[Edge]
    rects: list[dict[str, Any]]
    text: str
    ocr_status: str  # "native" | "image_only" | "empty"
    # Ruled-table cells (pdfplumber ``extract_tables`` output) — computed only
    # for ruled pages (ABB/Schneider/Siemens grids); [] on unruled pages, which
    # the word-position route in ``generic_table_parser`` handles instead.
    tables: list[list[list[str | None]]] = field(default_factory=list)

    @property
    def n_words(self) -> int:
        return len(self.words)

    @property
    def is_ruled(self) -> bool:
        """A ruled table needs both horizontal separators and >=1 vertical
        rule (a page with only a page-frame box is not 'ruled')."""
        return len(self.h_edges) >= 2 and len(self.v_edges) >= 1


@dataclass
class DocumentIR:
    """One manual, normalized. ``pages`` holds only the requested subset."""

    path: str
    doc_id: str
    sha256: str
    n_pages_total: int
    pages: list[PageIR] = field(default_factory=list)

    def page(self, number: int) -> PageIR | None:
        for p in self.pages:
            if p.number == number:
                return p
        return None


def sha256_of(pdf_path: str | Path) -> str:
    h = hashlib.sha256()
    with open(pdf_path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _ocr_status(page: Any, text: str) -> str:
    if text.strip():
        return "native"
    # No text layer. If the page carries an image, it is a scanned page that
    # would need OCR — flag it (never silently emit nothing as if empty).
    try:
        if page.images:
            return "image_only"
    except Exception:
        pass
    return "empty"


def _split_edges(page: Any) -> tuple[list[Edge], list[Edge]]:
    """Ruling edges (from lines + rect borders), split by orientation.

    ``page.edges`` is pdfplumber's derived edge set — the same input
    ``extract_tables`` uses for the ``lines`` strategy. Horizontal vs vertical
    by which span is longer, robust to hairline float noise."""
    h_edges: list[Edge] = []
    v_edges: list[Edge] = []
    for e in page.edges:
        dx = abs(e.get("x1", 0) - e.get("x0", 0))
        dy = abs(e.get("y1", 0) - e.get("y0", 0))
        if e.get("orientation") == "h" or dx > dy:
            h_edges.append(e)
        else:
            v_edges.append(e)
    return h_edges, v_edges


def build_page_ir(page: Any) -> PageIR:
    """Normalize one already-open pdfplumber page."""
    try:
        words = page.extract_words(extra_attrs=_WORD_ATTRS)
    except Exception:
        words = page.extract_words()
    text = page.extract_text() or ""
    h_edges, v_edges = _split_edges(page)
    tables: list[list[list[str | None]]] = []
    # Only ruled pages get the (relatively expensive) table extraction — this
    # is where the lines strategy pays off and bounds cost on big manuals.
    if len(h_edges) >= 2 and len(v_edges) >= 1:
        try:
            tables = page.extract_tables() or []
        except Exception:
            tables = []
    return PageIR(
        number=page.page_number,
        width=float(page.width or 0.0),
        height=float(page.height or 0.0),
        words=words,
        word_lines=_cluster_lines(words),
        h_edges=h_edges,
        v_edges=v_edges,
        rects=list(page.rects),
        text=text,
        ocr_status=_ocr_status(page, text),
        tables=tables,
    )


def build_document_ir(
    pdf_path: str | Path,
    *,
    pages: list[int] | None = None,
    doc_id: str | None = None,
    compute_sha: bool = True,
) -> DocumentIR:
    """Open the PDF once and normalize the requested pages.

    ``pages`` (1-indexed) restricts the expensive ``extract_words`` pass to a
    subset — pass the candidate pages discovery flagged so a 964-page manual
    normalizes only its table pages. ``pages=None`` normalizes everything
    (the cost the discovery pass pays once for the whole document).
    """
    pdf_path = str(pdf_path)
    wanted = set(pages) if pages is not None else None
    doc_id = doc_id or Path(pdf_path).stem
    sha = sha256_of(pdf_path) if compute_sha else ""
    page_irs: list[PageIR] = []
    with pdfplumber.open(pdf_path) as pdf:
        n_total = len(pdf.pages)
        for page in pdf.pages:
            if wanted is not None and page.page_number not in wanted:
                continue
            page_irs.append(build_page_ir(page))
    return DocumentIR(
        path=pdf_path,
        doc_id=doc_id,
        sha256=sha,
        n_pages_total=n_total,
        pages=page_irs,
    )
