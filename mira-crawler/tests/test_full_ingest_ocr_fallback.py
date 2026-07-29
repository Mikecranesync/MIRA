"""Tests for the Tika OCR fallback in full_ingest_pipeline.step_extract (#2539).

step_extract runs local pdfplumber/pypdf extraction first; with ocr=True it
falls back to Tika OCR when local extraction finds no text layer (scanned PDF).
Fail-safe: converter.extract_from_tika swallows all errors and returns [], so a
missing/unreachable Tika leaves the pipeline at 0 chars (needs_ocr), never a
crash.
"""

from __future__ import annotations

from unittest.mock import patch

from tasks.full_ingest_pipeline import PipelineReport, step_extract


def _fake_pdf(tmp_path):
    p = tmp_path / "scanned.pdf"
    p.write_bytes(b"%PDF-1.4\n" + b"0" * 1024)
    return p


class TestOcrFallback:
    def test_local_text_layer_never_calls_ocr(self, tmp_path):
        pdf = _fake_pdf(tmp_path)
        report = PipelineReport(pdf_url="x")
        with (
            patch(
                "ingest.pdf_extract.extract_pdf_text",
                return_value=("# Heading\n\nreal text", "pdfplumber"),
            ),
            patch("ingest.converter.extract_from_tika") as tika,
        ):
            text = step_extract(pdf, report, ocr=True)
        assert text == "# Heading\n\nreal text"
        assert report.extract_method == "pdfplumber"
        tika.assert_not_called()

    def test_zero_char_with_ocr_uses_tika(self, tmp_path):
        pdf = _fake_pdf(tmp_path)
        report = PipelineReport(pdf_url="x")
        with (
            patch("ingest.pdf_extract.extract_pdf_text", return_value=("", "pypdf")),
            patch(
                "ingest.converter.extract_from_tika",
                return_value=[{"text": "OCR page one", "page_num": None, "section": ""}],
            ),
        ):
            text = step_extract(pdf, report, ocr=True)
        assert "OCR page one" in text
        assert report.extract_method == "tika_ocr"
        assert report.errors == []

    def test_zero_char_with_ocr_but_tika_empty_reports_zero_char(self, tmp_path):
        pdf = _fake_pdf(tmp_path)
        report = PipelineReport(pdf_url="x")
        with (
            patch("ingest.pdf_extract.extract_pdf_text", return_value=("", "pypdf")),
            patch("ingest.converter.extract_from_tika", return_value=[]),
        ):
            text = step_extract(pdf, report, ocr=True)
        assert text == ""
        assert any("produced 0 chars" in e for e in report.errors)

    def test_zero_char_without_ocr_flag_skips_tika(self, tmp_path):
        pdf = _fake_pdf(tmp_path)
        report = PipelineReport(pdf_url="x")
        with (
            patch("ingest.pdf_extract.extract_pdf_text", return_value=("", "pypdf")),
            patch("ingest.converter.extract_from_tika") as tika,
        ):
            text = step_extract(pdf, report, ocr=False)
        assert text == ""
        assert any("produced 0 chars" in e for e in report.errors)
        tika.assert_not_called()
