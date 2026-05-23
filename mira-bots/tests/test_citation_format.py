"""Tests for shared.response_formatter citation cleanup.

Mike got '[1] 193 um011 en p' as a citation in production — meaning raw filename
stems were being dumped instead of human-readable labels. These tests pin the
expected clean output."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.response_formatter import _format_citation_label, _maybe_append_citation_footer


class TestCitationLabel:
    def test_garbled_rockwell_filename_stem(self):
        label = _format_citation_label(
            {"manufacturer": "Allen-Bradley", "model_number": "193 um011 en p"}
        )
        assert "193" in label
        assert "User Manual" in label
        assert "um011" not in label
        assert "en p" not in label

    def test_clean_model_passes_through(self):
        label = _format_citation_label(
            {
                "manufacturer": "Allen-Bradley",
                "model_number": "PowerFlex 525",
                "section": "Fault F006",
            }
        )
        assert label == "Allen-Bradley PowerFlex 525 — Fault F006"

    def test_filename_with_dashes(self):
        label = _format_citation_label(
            {"manufacturer": "Rockwell Automation", "model_number": "1756-in001-en-p"}
        )
        assert "ControlLogix 1756" in label
        assert "Installation" in label

    def test_pflex_filename_recognized(self):
        label = _format_citation_label({"manufacturer": "", "model_number": "pflex_um001_en_p"})
        assert "PowerFlex" in label
        assert "User Manual" in label

    def test_empty_falls_back_to_kb(self):
        assert _format_citation_label({}) == "knowledge base"

    def test_source_url_fallback(self):
        label = _format_citation_label(
            {"source_url": "https://example.com/docs/abb_acs550_manual.pdf"}
        )
        assert "Acs550" in label or "ACS550" in label.upper()

    def test_section_appended(self):
        label = _format_citation_label(
            {
                "manufacturer": "Siemens",
                "model_number": "SINAMICS G120",
                "section": "Fault F0005",
            }
        )
        assert label.endswith("Fault F0005")

    def test_page_num_appended_when_present(self):
        label = _format_citation_label(
            {
                "manufacturer": "Allen-Bradley",
                "model_number": "PowerFlex 525",
                "section": "Fault F004",
                "page_num": 12,
            }
        )
        assert label.endswith("p. 12")
        assert "Fault F004" in label

    def test_page_num_falls_back_to_metadata(self):
        # Some callers pass the chunk dict before flattening; _format should
        # still recover page_num from the metadata sub-dict.
        label = _format_citation_label(
            {
                "manufacturer": "Allen-Bradley",
                "model_number": "PowerFlex 525",
                "metadata": {"page_num": 47, "section": ""},
            }
        )
        assert label.endswith("p. 47")

    def test_page_num_zero_or_none_omitted(self):
        for bad in (None, 0, -1, "12", 12.5):
            label = _format_citation_label(
                {
                    "manufacturer": "Allen-Bradley",
                    "model_number": "PowerFlex 525",
                    "page_num": bad,
                }
            )
            assert "p." not in label

    def test_no_double_manufacturer(self):
        # If model already includes the manufacturer name, don't repeat it.
        label = _format_citation_label(
            {"manufacturer": "Allen-Bradley", "model_number": "Allen-Bradley PowerFlex 525"}
        )
        assert label.count("Allen-Bradley") == 1

    def test_url_only_with_filename_pattern(self):
        # The Q3 production case: model_number=None, only source_url to a Rockwell PDF.
        label = _format_citation_label(
            {
                "manufacturer": None,
                "model_number": None,
                "source_url": "https://literature.rockwellautomation.com/idc/groups/literature/documents/um/520-um001_-en-e.pdf",
                "section": "A490 [Load Loss Level]",
            }
        )
        assert "Allen-Bradley" in label
        assert "User Manual" in label
        assert "520-um001" not in label
        assert "Um001" not in label
        assert "A490" in label

    def test_url_only_unknown_vendor(self):
        # Unknown domain still cleans the stem and appends section.
        label = _format_citation_label(
            {
                "source_url": "https://example.com/docs/some_random_manual.pdf",
                "section": "Section 5",
            }
        )
        assert "Some Random Manual" in label
        assert "Section 5" in label

    def test_url_manufacturer_inference(self):
        for url, expected in [
            ("https://literature.rockwellautomation.com/foo.pdf", "Allen-Bradley"),
            ("https://support.industry.siemens.com/cs/doc.pdf", "Siemens"),
            ("https://library.e.abb.com/public/x.pdf", "ABB"),
        ]:
            label = _format_citation_label({"source_url": url})
            assert expected in label, f"{url} → {label!r}"


class TestCitationFooter:
    def test_footer_dedupes_identical_labels(self):
        kb_status = {
            "citations": [
                {"manufacturer": "Allen-Bradley", "model_number": "193 um011 en p"},
                {"manufacturer": "Allen-Bradley", "model_number": "193 um011 en p"},
                {
                    "manufacturer": "Rockwell Automation",
                    "model_number": "Bulletin 193 Overload Relay",
                },
            ]
        }
        out = _maybe_append_citation_footer("Reply text.", kb_status)
        # Two distinct citation lines, not three
        assert out.count("[1]") == 1
        assert out.count("[2]") == 1
        assert "[3]" not in out

    def test_no_citations_no_footer(self):
        out = _maybe_append_citation_footer("Reply text.", {"citations": []})
        assert out == "Reply text."

    def test_existing_footer_not_duplicated(self):
        existing = "Reply text.\n\n--- Sources ---\n[1] something"
        out = _maybe_append_citation_footer(
            existing, {"citations": [{"manufacturer": "X", "model_number": "Y"}]}
        )
        assert out == existing  # unchanged

    def test_inline_source_tags_block_footer(self):
        existing = "The cause is X [Source: Allen-Bradley PowerFlex 525]"
        out = _maybe_append_citation_footer(
            existing, {"citations": [{"manufacturer": "AB", "model_number": "PF525"}]}
        )
        assert out == existing  # unchanged
