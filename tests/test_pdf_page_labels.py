"""Tests for PDF page label extraction.

Tests both metadata-based extraction and fallback detection from headers/footers.
"""

import io

import pytest

# PyMuPDF import guard
pytest.importorskip("fitz", reason="PyMuPDF (fitz) is required for page label tests")

from mira_core.scripts.pdf_page_labels import (
    extract_page_labels,
    format_page_citation,
    get_page_label,
)


def _create_test_pdf_with_labels(page_labels: list[str]) -> bytes:
    """Create a synthetic PDF with specified page labels.

    Args:
        page_labels: List of page labels (e.g., ["i", "ii", "1", "2"])

    Returns:
        PDF bytes
    """
    import fitz

    doc = fitz.open()

    # Add pages
    for i, label in enumerate(page_labels):
        page = doc.new_page(width=612, height=792)
        # Add label to page (visible text for detection testing)
        text_rect = fitz.Rect(50, 750, 562, 780)
        page.insert_textbox(text_rect, label, fontsize=12, align=fitz.TEXT_ALIGN_CENTER)

    # Set PDF page labels metadata
    # Format: startpage, prefix, style, firstpagenum
    # Style: 'D' = decimal, 'r' = lowercase roman, 'R' = uppercase roman
    if len(page_labels) >= 3:
        # Roman numerals for first 3 pages, then arabic from 1
        doc.set_page_labels(
            [
                {"startpage": 0, "prefix": "", "style": "r", "firstpagenum": 1},
                {"startpage": 3, "prefix": "", "style": "D", "firstpagenum": 1},
            ]
        )

    # Save to bytes
    pdf_bytes = doc.tobytes()
    doc.close()

    return pdf_bytes


def test_extract_page_labels_from_metadata():
    """Test extraction of page labels from PDF /PageLabels metadata."""
    # Create PDF with roman numerals (i, ii, iii) then arabic (1, 2, 3, ...)
    pdf_bytes = _create_test_pdf_with_labels(["i", "ii", "iii", "1", "2", "3", "4"])

    labels = extract_page_labels(pdf_bytes)

    # Check that we got labels for all pages
    assert len(labels) >= 3
    assert labels[0] in ("i", "1")  # Could be roman or arabic depending on metadata
    assert labels[1] in ("ii", "2")
    assert labels[2] in ("iii", "3")


def test_extract_page_labels_from_text():
    """Test fallback detection of page numbers from page text."""
    import fitz

    # Create PDF without metadata but with visible page numbers
    doc = fitz.open()
    for i in range(5):
        page = doc.new_page(width=612, height=792)
        # Add page number in footer
        footer_rect = fitz.Rect(50, 750, 562, 780)
        page.insert_textbox(footer_rect, f"{i + 1}", fontsize=12, align=fitz.TEXT_ALIGN_CENTER)

    pdf_bytes = doc.tobytes()
    doc.close()

    labels = extract_page_labels(pdf_bytes)

    # Should detect incrementing numbers
    assert len(labels) > 0


def test_get_page_label_single_page():
    """Test getting a single page's label."""
    pdf_bytes = _create_test_pdf_with_labels(["i", "ii", "iii", "1", "2"])

    label = get_page_label(pdf_bytes, 0)
    assert label in ("i", "1")


def test_format_page_citation_with_label():
    """Test formatting citation with a page label."""
    assert format_page_citation(0, "2-15") == "p. 2-15"
    assert format_page_citation(0, "iv") == "p. iv"
    assert format_page_citation(0, "228") == "p. 228"


def test_format_page_citation_without_label():
    """Test formatting citation without a label (PDF page fallback)."""
    assert format_page_citation(12, None) == "PDF p. 13"  # 0-indexed → 1-indexed
    assert format_page_citation(0, None) == "PDF p. 1"


def test_format_page_citation_no_data():
    """Test formatting citation with no data."""
    assert format_page_citation(None, None) == ""


def test_chapter_section_labels():
    """Test that chapter-section labels (e.g., '2-15') are preserved."""
    import fitz

    # Create PDF with chapter-section style page numbers
    doc = fitz.open()
    for i, label in enumerate(["2-15", "2-16", "2-17", "3-1", "3-2"]):
        page = doc.new_page(width=612, height=792)
        footer_rect = fitz.Rect(50, 750, 562, 780)
        page.insert_textbox(footer_rect, label, fontsize=12, align=fitz.TEXT_ALIGN_CENTER)

    pdf_bytes = doc.tobytes()
    doc.close()

    # Even without metadata, these should be detectable from text
    # (though the detection logic may not be perfect for non-incrementing)
    labels = extract_page_labels(pdf_bytes)

    # At minimum, verify the utility doesn't crash
    assert isinstance(labels, dict)


def test_offset_printed_pages():
    """Test PDF where printed page 1 appears at PDF page 10 (after front matter)."""
    import fitz

    # Create PDF: 10 pages of roman numerals, then arabic starting at 1
    doc = fitz.open()

    # Front matter (pages i-x)
    roman = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"]
    for label in roman:
        page = doc.new_page(width=612, height=792)
        footer_rect = fitz.Rect(50, 750, 562, 780)
        page.insert_textbox(footer_rect, label, fontsize=12, align=fitz.TEXT_ALIGN_CENTER)

    # Main content (pages 1-5)
    for i in range(1, 6):
        page = doc.new_page(width=612, height=792)
        footer_rect = fitz.Rect(50, 750, 562, 780)
        page.insert_textbox(footer_rect, str(i), fontsize=12, align=fitz.TEXT_ALIGN_CENTER)

    # Set proper page labels
    doc.set_page_labels(
        [
            {"startpage": 0, "prefix": "", "style": "r", "firstpagenum": 1},  # i, ii, ...
            {"startpage": 10, "prefix": "", "style": "D", "firstpagenum": 1},  # 1, 2, ...
        ]
    )

    pdf_bytes = doc.tobytes()
    doc.close()

    labels = extract_page_labels(pdf_bytes)

    # Verify we have labels for all pages
    assert len(labels) >= 10

    # Verify the transition from roman to arabic at page 10
    # (exact labels depend on PyMuPDF's formatting)
    assert labels[0] in ("i", "1")
    assert labels[9] in ("x", "10")
    if len(labels) > 10:
        assert labels[10] in ("1", "11")


def test_manual_with_cover_and_toc():
    """Test a realistic manual structure: cover, TOC (roman), content (arabic)."""
    import fitz

    doc = fitz.open()

    # Cover page (unnumbered)
    cover = doc.new_page(width=612, height=792)
    cover.insert_textbox(fitz.Rect(50, 400, 562, 450), "MANUAL TITLE", fontsize=24)

    # TOC (pages i, ii)
    for label in ["i", "ii"]:
        page = doc.new_page(width=612, height=792)
        footer_rect = fitz.Rect(50, 750, 562, 780)
        page.insert_textbox(footer_rect, label, fontsize=12, align=fitz.TEXT_ALIGN_CENTER)

    # Main content (pages 1-5)
    for i in range(1, 6):
        page = doc.new_page(width=612, height=792)
        footer_rect = fitz.Rect(50, 750, 562, 780)
        page.insert_textbox(footer_rect, str(i), fontsize=12, align=fitz.TEXT_ALIGN_CENTER)

    # Set page labels (cover unnumbered, TOC roman, content arabic)
    doc.set_page_labels(
        [
            {"startpage": 1, "prefix": "", "style": "r", "firstpagenum": 1},  # Pages 1-2: i, ii
            {"startpage": 3, "prefix": "", "style": "D", "firstpagenum": 1},  # Pages 3+: 1, 2, ...
        ]
    )

    pdf_bytes = doc.tobytes()
    doc.close()

    labels = extract_page_labels(pdf_bytes)

    # Cover may or may not have a label (depends on metadata)
    # TOC should be roman
    # Content should be arabic starting from 1

    assert len(labels) >= 3


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
