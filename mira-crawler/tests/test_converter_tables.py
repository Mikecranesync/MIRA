"""Tests for table extraction in mira-crawler/ingest/converter.py.

Covers _format_table_markdown (pure helper) and extract_from_pdf table emission
behavior (mocked pdfplumber page so no real PDF required).
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from ingest.converter import _format_table_markdown, extract_from_pdf


class TestFormatTableMarkdown:
    def test_basic_table_renders_github_markdown(self):
        table = [
            ["Param", "Value", "Units"],
            ["Voltage", "480", "V"],
            ["Current", "12.5", "A"],
        ]
        md = _format_table_markdown(table)
        assert "| Param | Value | Units |" in md
        assert "|---|---|---|" in md
        assert "| Voltage | 480 | V |" in md
        assert "| Current | 12.5 | A |" in md

    def test_none_and_empty_cells_become_blank(self):
        md = _format_table_markdown([["A", "B"], [None, ""], ["", "x"]])
        assert "|  | x |" in md

    def test_pipe_in_cell_escaped(self):
        md = _format_table_markdown([["k", "v"], ["a", "x|y"]])
        assert "x\\|y" in md

    def test_newline_in_cell_collapsed(self):
        md = _format_table_markdown([["k", "v"], ["a", "line1\nline2"]])
        assert "line1 line2" in md

    def test_rejects_table_smaller_than_two_rows(self):
        assert _format_table_markdown([["solo"]]) == ""
        assert _format_table_markdown([]) == ""

    def test_rejects_single_column(self):
        assert _format_table_markdown([["A"], ["B"]]) == ""

    def test_pads_short_rows(self):
        md = _format_table_markdown([["A", "B", "C"], ["x"]])
        assert "| x |  |  |" in md


def _mock_page(text: str = "", tables: list | None = None):
    page = MagicMock()
    page.extract_text.return_value = text
    page.extract_tables.return_value = tables or []
    return page


def _mock_doc(*pages):
    doc = MagicMock()
    doc.pages = list(pages)
    doc.__enter__.return_value = doc
    doc.__exit__.return_value = False
    return doc


class TestExtractFromPdfTableChunks:
    def test_table_chunk_emitted_with_chunk_type_table(self):
        pdfplumber = pytest.importorskip("pdfplumber")
        long_table = [
            ["Parameter", "Range", "Default"],
            ["acceleration time", "0.1-600 s " * 5, "10 s"],
            ["deceleration time", "0.1-600 s " * 5, "10 s"],
        ]
        page = _mock_page(text="Some intro text. " * 20, tables=[long_table])
        with patch.object(pdfplumber, "open", return_value=_mock_doc(page)):
            blocks = extract_from_pdf(b"fake", max_pages=10, min_chars=20)

        table_blocks = [b for b in blocks if b.get("chunk_type") == "table"]
        assert len(table_blocks) == 1
        assert table_blocks[0]["page_num"] == 1
        assert "| Parameter | Range | Default |" in table_blocks[0]["text"]

    def test_tables_below_min_chars_are_skipped(self):
        pdfplumber = pytest.importorskip("pdfplumber")
        page = _mock_page(text="A " * 60, tables=[[["a", "b"], ["c", "d"]]])
        with patch.object(pdfplumber, "open", return_value=_mock_doc(page)):
            blocks = extract_from_pdf(b"fake", max_pages=10, min_chars=200)

        assert not any(b.get("chunk_type") == "table" for b in blocks)

    def test_table_extraction_failure_isolated_to_page(self):
        pdfplumber = pytest.importorskip("pdfplumber")
        bad = MagicMock()
        bad.extract_text.return_value = "Page 1 content. " * 20
        bad.extract_tables.side_effect = RuntimeError("malformed")
        good = _mock_page(
            text="Page 2 content. " * 20,
            tables=[[["Col1", "Col2"], ["a" * 100, "b" * 100]]],
        )
        with patch.object(pdfplumber, "open", return_value=_mock_doc(bad, good)):
            blocks = extract_from_pdf(b"fake", max_pages=10, min_chars=20)

        text_pages = sorted({b["page_num"] for b in blocks if b.get("chunk_type") != "table"})
        table_pages = [b["page_num"] for b in blocks if b.get("chunk_type") == "table"]
        assert text_pages == [1, 2]
        assert table_pages == [2]
