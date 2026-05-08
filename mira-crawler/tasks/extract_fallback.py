"""Fallback PDF text extraction — runs when Docling is down.

Quality is lower (no layout, no table reconstruction, no markdown structure),
but the pipeline keeps moving. See docs/specs/kb-ingest-hardening-spec.md §7.

Order of preference:
  1. pdfplumber  — best layout fidelity of the pure-python options
  2. pypdf       — fallback when pdfplumber not installed
  3. (give up)   — caller treats as docling=failed and skips the doc
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger("mira.extract_fallback")


def _try_pdfplumber(path: Path) -> Optional[str]:
    try:
        import pdfplumber  # type: ignore
    except ImportError:
        return None
    try:
        out: list[str] = []
        with pdfplumber.open(str(path)) as pdf:
            for page in pdf.pages:
                txt = page.extract_text() or ""
                if txt.strip():
                    out.append(txt)
        return "\n\n".join(out).strip() or None
    except Exception as exc:
        logger.warning("pdfplumber failed: %s", exc)
        return None


def _try_pypdf(path: Path) -> Optional[str]:
    try:
        import pypdf  # type: ignore
    except ImportError:
        return None
    try:
        reader = pypdf.PdfReader(str(path))
        out: list[str] = []
        for page in reader.pages:
            try:
                txt = page.extract_text() or ""
            except Exception:
                txt = ""
            if txt.strip():
                out.append(txt)
        return "\n\n".join(out).strip() or None
    except Exception as exc:
        logger.warning("pypdf failed: %s", exc)
        return None


def fallback_extract(pdf_path: Path) -> tuple[str, str]:
    """Extract text without Docling. Returns (text, method_label).

    method_label is one of: 'pdfplumber', 'pypdf', 'fallback_failed'.
    Empty text means all fallbacks failed — caller should treat as a hard miss.
    """
    if not pdf_path.exists() or pdf_path.stat().st_size == 0:
        return "", "fallback_failed"

    # 1. pdfplumber
    txt = _try_pdfplumber(pdf_path)
    if txt:
        logger.info("Fallback: pdfplumber extracted %d chars", len(txt))
        return txt, "pdfplumber"

    # 2. pypdf
    txt = _try_pypdf(pdf_path)
    if txt:
        logger.info("Fallback: pypdf extracted %d chars", len(txt))
        return txt, "pypdf"

    logger.error("All fallback extractors failed for %s", pdf_path.name)
    return "", "fallback_failed"
