"""F5 — the CLI renders PDF pages to budgeted images client-side.

R1 iteration finding (ATV340, 2026-07-14): sending a PDF as a raw document block
bypasses ``printsense.preprocess`` entirely — Claude renders pages internally at
its own (lower) budget, and the dense 2-page ATV340 sheet came back read at
connector level (bare CN2, no STO_A/STO_B; both shielded cables missed;
56.5/F/REJECT) while page-IMAGE inputs of comparable sheets read at terminal
level. Fix: rasterize each PDF page with PyMuPDF at high DPI and feed them as
image pages through the normal budget path.
"""

import io

import pytest

pytest.importorskip("pydantic")
fitz = pytest.importorskip("fitz")  # PyMuPDF

from printsense import cli  # noqa: E402


def _tiny_pdf(pages: int = 2) -> bytes:
    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page(width=300, height=200)
        page.insert_text((40, 100), f"SHEET {i + 1}  -W549{i}")
    return doc.tobytes()


def test_pdf_rendered_to_image_pages(tmp_path):
    pdf = tmp_path / "sheet.pdf"
    pdf.write_bytes(_tiny_pdf(pages=2))

    pages = cli._load_pages([pdf])

    # one IMAGE page per PDF page — no application/pdf passthrough anymore
    assert len(pages) == 2
    assert all(mt == "image/jpeg" for _b, mt in pages)


def test_pdf_pages_are_high_res_enough(tmp_path):
    # A 300x200pt page at the render DPI must come out well above naive 72dpi
    # (72dpi would be 300x200 px) — the whole point is legibility.
    from PIL import Image

    pdf = tmp_path / "sheet.pdf"
    pdf.write_bytes(_tiny_pdf(pages=1))

    pages = cli._load_pages([pdf])
    img = Image.open(io.BytesIO(pages[0][0]))

    assert max(img.size) >= 900  # >= ~220 dpi on a 300pt-wide page


def test_broken_pdf_is_usage_error(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(cli, "interpret_print", lambda *a, **k: None)
    bad = tmp_path / "broken.pdf"
    bad.write_bytes(b"%PDF-1.4 not really a pdf")

    rc = cli.main([str(bad), "--out", str(tmp_path / "o")])

    assert rc == cli.EXIT_USAGE
    assert "pdf" in capsys.readouterr().err.lower()
