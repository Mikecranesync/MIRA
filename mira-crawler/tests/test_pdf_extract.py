"""Coverage for the local PDF text extractor that replaces the removed docling.

Run: pytest mira-crawler/tests/test_pdf_extract.py -q  (needs pypdf; reportlab for
the fixture; pdfplumber optional — the fallback path is exercised without it).

Seam under test: ingest.pdf_extract.extract_pdf_text(path) -> (text, method).
Proves it extracts real text with NO external service (docling/tika are gone) and
that it degrades to pypdf — the only PDF lib guaranteed on the ingest host.
"""

import sys
from pathlib import Path

import pytest

CRAWLER = Path(__file__).resolve().parents[1]  # mira-crawler/
if str(CRAWLER) not in sys.path:
    sys.path.insert(0, str(CRAWLER))

from ingest.pdf_extract import extract_pdf_text  # noqa: E402
import ingest.pdf_extract as pdf_extract  # noqa: E402

# Real, checkable strings we render into the fixture PDF.
KNOWN = [
    "PowerFlex 525 Adjustable Frequency AC Drive User Manual",
    "Fault F004 indicates a DC bus overvoltage condition on the drive",
    "Parameter P053 sets the deceleration time for the connected motor",
]


def _make_pdf(path: Path, lines: list[str]) -> None:
    """Render a one-page, text-layer PDF (repo convention: reportlab)."""
    pytest.importorskip("reportlab")
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(str(path), pagesize=letter)
    y = 720
    for line in lines:
        c.drawString(72, y, line)
        y -= 24
    c.showPage()
    c.save()


def test_extract_returns_real_text_from_a_pdf(tmp_path):
    pdf = tmp_path / "manual.pdf"
    _make_pdf(pdf, KNOWN)

    text, method = extract_pdf_text(pdf)

    assert method in ("pdfplumber", "pypdf")
    assert "PowerFlex 525" in text
    assert "F004" in text
    assert "P053" in text
    # No external service was contacted — the module has no HTTP client at all.
    assert not hasattr(pdf_extract, "httpx")


def test_falls_back_to_pypdf_when_pdfplumber_path_unavailable(tmp_path, monkeypatch):
    """The prod ingest host has only pypdf — force that path and prove it works."""
    pdf = tmp_path / "manual.pdf"
    _make_pdf(pdf, KNOWN)

    # Simulate pdfplumber/converter being unavailable (the host reality).
    monkeypatch.setattr(pdf_extract, "_extract_via_pdfplumber", lambda _p: None)

    text, method = extract_pdf_text(pdf)

    assert method == "pypdf"
    assert "PowerFlex 525" in text
    assert "F004" in text


def test_empty_or_bad_pdf_yields_empty_not_crash(tmp_path):
    bad = tmp_path / "not-a.pdf"
    bad.write_bytes(b"%PDF-1.4 not really a pdf")
    text, method = extract_pdf_text(bad)
    assert text == ""
    assert method == "pypdf"
