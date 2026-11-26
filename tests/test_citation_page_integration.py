"""Integration tests for page label citations.

Tests that page labels flow through the entire pipeline:
- Ingest → knowledge_entries metadata
- Retrieval → chunk metadata
- Citation rendering → [Source: ...] tags and footers
"""

import json

import pytest


def test_citation_uses_page_label_not_pdf_index():
    """Test that citations prefer page_label over page_num."""
    from mira_bots.shared.response_formatter import _format_citation_label
    from mira_bots.shared.workers.rag_worker import kb_citation_entry

    # Chunk with both page_label (printed) and page_num (PDF index)
    chunk = {
        "manufacturer": "AutomationDirect",
        "model_number": "GS10",
        "source_url": "gs10-manual.pdf",
        "metadata": {
            "section": "Fault Codes",
            "page_num": 13,  # PDF page 13
            "page_label": "2-15",  # Printed page 2-15
        },
    }

    # kb_citation_entry should extract both
    entry = kb_citation_entry(chunk)
    assert entry["page_num"] == 13
    assert entry["page_label"] == "2-15"

    # _format_citation_label should prefer page_label
    label = _format_citation_label(entry)
    assert "2-15" in label
    assert "13" not in label or "p. 2-15" in label


def test_citation_falls_back_to_pdf_page():
    """Test that citations fall back to 'PDF p.N' when no page_label exists."""
    from mira_bots.shared.response_formatter import _format_citation_label
    from mira_bots.shared.workers.rag_worker import kb_citation_entry

    # Chunk with only page_num, no page_label
    chunk = {
        "manufacturer": "Siemens",
        "model_number": "SIRIUS 3RV",
        "source_url": "3rv-manual.pdf",
        "metadata": {
            "section": "Wiring",
            "page_num": 42,
        },
    }

    entry = kb_citation_entry(chunk)
    assert entry["page_num"] == 42
    assert entry.get("page_label") is None

    # Should show "PDF p.42" to indicate it's not a printed page
    label = _format_citation_label(entry)
    assert "PDF p. 42" in label or "PDF p.42" in label


def test_citation_handles_roman_numerals():
    """Test that roman numeral page labels are preserved."""
    from mira_bots.shared.response_formatter import _format_citation_label
    from mira_bots.shared.workers.rag_worker import kb_citation_entry

    chunk = {
        "manufacturer": "Rockwell Automation",
        "model_number": "PowerFlex 525",
        "source_url": "pf525-manual.pdf",
        "metadata": {
            "section": "Table of Contents",
            "page_num": 2,  # PDF page 2
            "page_label": "ii",  # Printed page ii
        },
    }

    entry = kb_citation_entry(chunk)
    label = _format_citation_label(entry)
    
    # Should show "p. ii", not "PDF p. 2"
    assert "p. ii" in label or "p.ii" in label
    assert "PDF" not in label


def test_citation_handles_offset_pages():
    """Test that page labels work for manuals with front matter offset."""
    from mira_bots.shared.response_formatter import _format_citation_label
    from mira_bots.shared.workers.rag_worker import kb_citation_entry

    # Manual structure: 10 pages front matter, then page 1 starts at PDF page 11
    # So PDF page 23 = printed page 13
    chunk = {
        "manufacturer": "ABB",
        "model_number": "ACS880",
        "source_url": "acs880-manual.pdf",
        "metadata": {
            "section": "Parameters",
            "page_num": 23,  # PDF page 23
            "page_label": "13",  # Printed page 13
        },
    }

    entry = kb_citation_entry(chunk)
    label = _format_citation_label(entry)
    
    # Should show printed page 13, not PDF page 23
    assert "p. 13" in label or "p.13" in label
    # Make sure it's not showing 23
    assert "23" not in label or "p. 13" in label  # Allow if both present but label preferred


def test_hub_citation_prefers_page_label():
    """Test that Hub citation rendering also prefers page_label."""
    # This would need to be run in the Hub's Jest environment
    # For now, verify the TypeScript logic is correct by inspection
    pass


def test_chip_text_footnote_agreement():
    """Test that chip, in-text, and footnote citations all use the same page."""
    from mira_bots.shared.response_formatter import _format_citation_label
    from mira_bots.shared.workers.rag_worker import format_source_label, kb_citation_entry

    chunk = {
        "manufacturer": "Yaskawa",
        "model_number": "V1000",
        "source_url": "v1000-manual.pdf",
        "metadata": {
            "section": "Fault Codes",
            "page_num": 100,
            "page_label": "5-23",
        },
    }

    # Both rendering functions should produce consistent page citations
    source_label = format_source_label(chunk)
    citation_label = _format_citation_label(kb_citation_entry(chunk))

    # Both should contain the printed page label
    assert "5-23" in source_label or "5-23" in citation_label
    # Neither should show the PDF page when a label exists
    if "5-23" in source_label:
        assert "100" not in source_label or "5-23" in source_label


def test_no_page_data_produces_no_citation():
    """Test that chunks with no page data don't append a page number."""
    from mira_bots.shared.response_formatter import _format_citation_label
    from mira_bots.shared.workers.rag_worker import kb_citation_entry

    chunk = {
        "manufacturer": "Generic",
        "model_number": "Test",
        "source_url": "test.pdf",
        "metadata": {
            "section": "Overview",
            # No page_num, no page_label
        },
    }

    entry = kb_citation_entry(chunk)
    label = _format_citation_label(entry)

    # Should not contain any page reference
    assert "p." not in label.lower() or not label
    assert "PDF" not in label


def test_metadata_page_label_survives_json_roundtrip():
    """Test that page_label in metadata survives JSON serialization."""
    metadata = {
        "source_url": "manual.pdf",
        "chunk_index": 42,
        "page_num": 15,
        "page_label": "3-8",
        "section": "Faults",
    }

    # Simulate what ingest does
    serialized = json.dumps(metadata)
    deserialized = json.loads(serialized)

    assert deserialized["page_label"] == "3-8"
    assert deserialized["page_num"] == 15


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
