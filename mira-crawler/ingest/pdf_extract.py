"""Local PDF → text extraction for the ingest pipeline (no external service).

Replaces the removed docling HTTP dependency (`full_ingest_pipeline` used to POST
every PDF to `mira-docling:5001`, which was deleted 2026-06-06 after OOMing the
8 GB VPS — see `docs/known-issues/2026-06-06-hub-upload-failures-docling-oom.md`).
Since then `full_ingest_pipeline` Connection-refused on every manual, silently
breaking all KB ingest.

Extraction strategy (nothing here opens a network socket):
  1. **pdfplumber** (via the shared `ingest.converter`) when it's importable —
     better structure (tables → markdown, section headings).
  2. **pypdf** fallback — the only PDF lib guaranteed on the ingest host
     (`kb_growth_cron` runs as a host cron via `doppler run -- python3`, so it has
     only host-installed packages; pypdf is present, pdfplumber is not).

Tika (OCR) is intentionally NOT wired here: it also needs a service
(`TIKA_URL=mira-tika:9998`) that isn't running on prod, so it would just be
another Connection-refused. Text-layer OEM manuals extract fine without OCR.
"""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger("mira-crawler.pdf_extract")


def _blocks_to_markdown(blocks: list[dict]) -> str:
    """Join converter blocks ({text, page_num, section, chunk_type?}) into one
    markdown string, emitting a `## <section>` header when the section changes."""
    out: list[str] = []
    last_section: str | None = None
    for b in blocks:
        section = (b.get("section") or "").strip()
        if section and section != last_section:
            out.append(f"\n## {section}\n")
            last_section = section
        text = (b.get("text") or "").strip()
        if text:
            out.append(text)
    return "\n\n".join(out).strip()


def _extract_via_pdfplumber(pdf_path: str | Path) -> str | None:
    """Reuse the crawler's pdfplumber extractor (tables + sections). Returns None
    if pdfplumber/the converter is unavailable or yields nothing — caller then
    falls back to pypdf. Never raises."""
    try:
        from ingest.converter import extract_from_pdf  # lazy: pdfplumber optional
    except Exception:  # noqa: BLE001 — module/dep not present → fall back
        return None
    try:
        data = Path(pdf_path).read_bytes()
        blocks = extract_from_pdf(data)
    except Exception as exc:  # noqa: BLE001 — pdfplumber runtime failure → fall back
        logger.info("pdfplumber extraction failed (%s) — falling back to pypdf", exc)
        return None
    if not blocks:
        return None
    md = _blocks_to_markdown(blocks)
    return md or None


def _extract_via_pypdf(pdf_path: str | Path) -> str:
    """Page-by-page text via pypdf (always available on the ingest host). Emits a
    `## Page N` header per page so the pipeline's page-count heuristic still works.
    A malformed PDF yields "" rather than raising."""
    try:
        import pypdf
    except ImportError:  # pragma: no cover - pypdf is a hard dep of the pipeline
        logger.error("pypdf not installed — cannot extract PDF text")
        return ""
    try:
        reader = pypdf.PdfReader(str(pdf_path))
    except Exception as exc:  # noqa: BLE001 — unreadable/corrupt PDF
        logger.warning("pypdf could not open %s: %s", pdf_path, exc)
        return ""

    parts: list[str] = []
    for i, page in enumerate(reader.pages, start=1):
        try:
            text = (page.extract_text() or "").strip()
        except Exception as exc:  # noqa: BLE001 — skip a bad page, keep the rest
            logger.debug("pypdf page %d failed: %s", i, exc)
            text = ""
        if text:
            parts.append(f"\n## Page {i}\n\n{text}")
    return "\n".join(parts).strip()


def extract_pdf_text(pdf_path: str | Path) -> tuple[str, str]:
    """Extract markdown-ish text from a local PDF. No network I/O.

    Returns ``(text, method)`` where method ∈ {"pdfplumber", "pypdf"}. ``text`` is
    "" only if the PDF is empty/unreadable by every available extractor.
    """
    md = _extract_via_pdfplumber(pdf_path)
    if md:
        return md, "pdfplumber"
    return _extract_via_pypdf(pdf_path), "pypdf"
