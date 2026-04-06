"""Tests for section-aware and sentence-aware document chunker."""

from __future__ import annotations

from ingest.chunker import (
    _extract_equipment_id,
    _find_sentence_boundary,
    _last_sentence_overlap,
    chunk_blocks,
)


class TestExtractEquipmentId:
    def test_standard_pattern(self):
        assert _extract_equipment_id("ABB_IRB6700_Maintenance.pdf") == "IRB6700"

    def test_fanuc_pattern(self):
        assert _extract_equipment_id("FANUC_R2000_Programming.pdf") == "R2000"

    def test_plc_pattern(self):
        assert _extract_equipment_id("Micro820_QuickStart.pdf") == "MICRO820"

    def test_no_model_number(self):
        assert _extract_equipment_id("generic_maintenance_guide.pdf") == ""

    def test_vfd_pattern(self):
        assert _extract_equipment_id("GS20_VFD_Manual.pdf") == "GS20"


class TestChunkBlocks:
    def test_small_block_passes_through(self):
        """Block smaller than max_chars stays intact."""
        blocks = [{"text": "A" * 300, "page_num": 1, "section": "Intro"}]
        result = chunk_blocks(blocks, max_chars=2000, min_chars=200)
        assert len(result) == 1
        assert result[0]["text"] == "A" * 300
        assert result[0]["chunk_index"] == 0

    def test_large_block_split(self):
        """Block larger than max_chars gets split."""
        # Use sentences so sentence-aware splitting works cleanly
        sentence = "This is a test sentence for chunking. "
        text = sentence * 100  # ~3800 chars
        blocks = [{"text": text, "page_num": 1, "section": "Theory"}]
        result = chunk_blocks(blocks, max_chars=500, min_chars=100)
        assert len(result) > 1

    def test_tiny_block_skipped(self):
        """Block smaller than min_chars gets dropped."""
        blocks = [{"text": "too short", "page_num": 1, "section": ""}]
        result = chunk_blocks(blocks, min_chars=200)
        assert len(result) == 0

    def test_metadata_preserved(self):
        """source_url, source_type, equipment_id flow through."""
        blocks = [{"text": "A" * 300, "page_num": 5, "section": "Safety"}]
        result = chunk_blocks(
            blocks,
            source_url="https://example.com/manual.pdf",
            source_file="ABB_IRB6700_Manual.pdf",
            source_type="equipment_manual",
            max_chars=2000,
            min_chars=200,
        )
        assert result[0]["source_url"] == "https://example.com/manual.pdf"
        assert result[0]["source_type"] == "equipment_manual"
        assert result[0]["equipment_id"] == "IRB6700"
        assert result[0]["page_num"] == 5
        assert result[0]["section"] == "Safety"

    def test_equipment_id_from_filename(self):
        """equipment_id auto-extracted from source_file when not provided."""
        blocks = [{"text": "A" * 300, "page_num": 1, "section": ""}]
        result = chunk_blocks(
            blocks,
            source_file="GS20_Installation_Guide.pdf",
            max_chars=2000,
            min_chars=200,
        )
        assert result[0]["equipment_id"] == "GS20"

    def test_explicit_equipment_id_overrides(self):
        """Explicit equipment_id takes precedence over filename extraction."""
        blocks = [{"text": "A" * 300, "page_num": 1, "section": ""}]
        result = chunk_blocks(
            blocks,
            source_file="some_file.pdf",
            equipment_id="CUSTOM123",
            max_chars=2000,
            min_chars=200,
        )
        assert result[0]["equipment_id"] == "CUSTOM123"

    def test_chunk_index_sequential(self):
        """chunk_index increments across all blocks."""
        blocks = [
            {"text": "A" * 300, "page_num": 1, "section": "A"},
            {"text": "B" * 300, "page_num": 2, "section": "B"},
            {"text": "C" * 300, "page_num": 3, "section": "C"},
        ]
        result = chunk_blocks(blocks, max_chars=2000, min_chars=200)
        indices = [c["chunk_index"] for c in result]
        assert indices == [0, 1, 2]

    def test_empty_blocks_returns_empty(self):
        """Empty input returns empty output."""
        assert chunk_blocks([]) == []

    def test_chunk_quality_present(self):
        """All chunks have chunk_quality field."""
        blocks = [{"text": "A" * 300, "page_num": 1, "section": ""}]
        result = chunk_blocks(blocks, max_chars=2000, min_chars=200)
        assert "chunk_quality" in result[0]


class TestTableDetection:
    """Table-aware chunking: detect tables, keep intact, split at row boundaries."""

    def test_pipe_table_kept_intact(self):
        """Pipe-delimited table with header+separator+rows → 1 chunk, chunk_type=table."""
        table = (
            "| Parameter | Value | Unit |\n"
            "|---|---|---|\n"
            "| Voltage | 480 | VAC |\n"
            "| Current | 15 | A |\n"
            "| Frequency | 60 | Hz |"
        )
        blocks = [{"text": table, "page_num": 1, "section": "Specs"}]
        result = chunk_blocks(blocks, max_chars=2000, min_chars=50)
        assert len(result) == 1
        assert result[0]["chunk_type"] == "table"
        assert "480" in result[0]["text"]
        assert "60" in result[0]["text"]

    def test_large_table_splits_at_rows(self):
        """Table over 1200 chars splits between rows, all chunk_type=table."""
        header = "| Parameter | Standard Rating | Derated Rating | Notes |"
        sep = "|---|---|---|---|"
        rows = [
            f"| Parameter {i} | Value {i}A with extra padding text here | "
            f"Value {i}B with extra padding text here | Note {i} details |"
            for i in range(30)
        ]
        table = "\n".join([header, sep] + rows)
        assert len(table) > 1200  # confirm it exceeds TABLE_MAX_CHARS
        blocks = [{"text": table, "page_num": 5, "section": "Ratings"}]
        result = chunk_blocks(blocks, max_chars=2000, min_chars=50)
        assert len(result) > 1
        for chunk in result:
            assert chunk["chunk_type"] == "table"

    def test_header_prepended_to_splits(self):
        """Each split chunk starts with the original header + separator."""
        header = "| Param | Value |"
        sep = "|---|---|"
        rows = [f"| Row {i} | {'X' * 80} |" for i in range(30)]
        table = "\n".join([header, sep] + rows)
        blocks = [{"text": table, "page_num": 1, "section": "Data"}]
        result = chunk_blocks(blocks, max_chars=2000, min_chars=50)
        if len(result) > 1:
            for chunk in result:
                assert chunk["text"].startswith(header)
                assert sep in chunk["text"]

    def test_mixed_prose_and_table(self):
        """Block with prose + table yields separate text and table chunks when split."""
        prose = "This is a description of the equipment specifications. " * 20
        table = (
            "| Parameter | Value |\n"
            "|---|---|\n"
            "| Temp | 40C |\n"
            "| Voltage | 480V |\n"
            "| Current | 15A |"
        )
        mixed = prose + "\n" + table + "\n" + prose
        blocks = [{"text": mixed, "page_num": 1, "section": "Overview"}]
        # Use max_chars smaller than total to force splitting
        result = chunk_blocks(blocks, max_chars=800, min_chars=50)
        types = {c["chunk_type"] for c in result}
        assert "table" in types
        assert "text" in types

    def test_tab_delimited_table(self):
        """Tab-separated columnar data (3+ rows, 2+ tabs) → chunk_type=table."""
        lines = [
            "Header1\tHeader2\tHeader3",
            "val1a\tval1b\tval1c",
            "val2a\tval2b\tval2c",
            "val3a\tval3b\tval3c",
            "val4a\tval4b\tval4c",
        ]
        table = "\n".join(lines)
        blocks = [{"text": table, "page_num": 1, "section": "Data"}]
        result = chunk_blocks(blocks, max_chars=2000, min_chars=50)
        assert len(result) == 1
        assert result[0]["chunk_type"] == "table"

    def test_prose_gets_text_type(self):
        """Regular prose text gets chunk_type=text."""
        blocks = [{"text": "A" * 300, "page_num": 1, "section": "Intro"}]
        result = chunk_blocks(blocks, max_chars=2000, min_chars=200)
        assert len(result) == 1
        assert result[0]["chunk_type"] == "text"

    def test_powerflex_ambient_temp_scenario(self):
        """The exact bug: both 40C and 50C must land in the same chunk."""
        table = (
            "| Parameter | Rating | Condition |\n"
            "|---|---|---|\n"
            "| Ambient Temperature | 40°C (104°F) | Full rated current, no derating |\n"
            "| Ambient Temperature | 50°C (122°F) | With output current derating |\n"
            "| Storage Temperature | -40 to 70°C (-40 to 158°F) | |\n"
            "| Relative Humidity | 0-95% | Non-condensing |"
        )
        blocks = [{"text": table, "page_num": 42, "section": "Environmental Specifications"}]
        result = chunk_blocks(blocks, max_chars=800, min_chars=50)
        assert len(result) == 1
        assert "40°C" in result[0]["text"]
        assert "50°C" in result[0]["text"]
        assert result[0]["chunk_type"] == "table"
        assert result[0]["section"] == "Environmental Specifications"


class TestSentenceBoundary:
    """Unit tests for sentence boundary detection."""

    def test_finds_period_boundary(self):
        text = "First sentence here. Second sentence starts here."
        result = _find_sentence_boundary(text, 15)
        assert result is not None
        assert text[result:].startswith("Second")

    def test_skips_abbreviation(self):
        text = "Set to approx. 60Hz for normal operation. Next sentence."
        # Target near "approx." — should skip it and find "Next"
        result = _find_sentence_boundary(text, 10)
        assert result is not None
        assert text[result:].startswith("Next")

    def test_returns_none_when_no_boundary(self):
        text = "A" * 500  # No sentence boundaries
        result = _find_sentence_boundary(text, 100, lookahead=150)
        assert result is None

    def test_question_mark_boundary(self):
        text = "What is the voltage? Check the manual for details."
        result = _find_sentence_boundary(text, 15)
        assert result is not None
        assert text[result:].startswith("Check")

    def test_exclamation_boundary(self):
        text = "DANGER! De-energize before proceeding."
        result = _find_sentence_boundary(text, 0)
        assert result is not None
        assert text[result:].startswith("De-energize")

    def test_eg_abbreviation(self):
        text = "Use a standard tool e.g. a multimeter to measure the voltage. Done."
        result = _find_sentence_boundary(text, 20)
        assert result is not None
        assert text[result:].startswith("Done")


class TestSentenceOverlap:
    """Unit tests for sentence-based overlap extraction."""

    def test_extracts_last_sentence(self):
        text = "First sentence here. Second sentence here. Third sentence here."
        overlap = _last_sentence_overlap(text, max_overlap=200)
        assert "Third sentence" in overlap

    def test_caps_at_max_overlap(self):
        text = "Short. " + "X" * 300 + "."
        overlap = _last_sentence_overlap(text, max_overlap=200)
        assert len(overlap) <= 200


class TestSentenceAwareChunking:
    """Integration tests for sentence-aware chunking via chunk_blocks."""

    def test_splits_at_sentence_boundary(self):
        """Prose with clear sentences splits at period, not mid-word."""
        sentences = [
            f"Sentence number {i} with enough content to fill the chunk. "
            for i in range(30)
        ]
        text = "".join(sentences)
        blocks = [{"text": text, "page_num": 1, "section": "Test"}]
        result = chunk_blocks(blocks, max_chars=500, min_chars=100)

        assert len(result) > 1
        for chunk in result[:-1]:  # Last chunk may not end at boundary
            stripped = chunk["text"].rstrip()
            # Should end at a sentence boundary (period)
            assert stripped[-1] in ".?!", (
                f"Chunk does not end at sentence boundary: ...{stripped[-30:]}"
            )

    def test_abbreviation_not_split(self):
        """Text with abbreviation 'approx.' should not split there."""
        text = (
            "The motor runs at approx. 1750 RPM under normal load conditions. "
            "Check the nameplate for exact speed rating. "
            "Verify the voltage is within the rated tolerance. "
        ) * 5
        blocks = [{"text": text, "page_num": 1, "section": "Specs"}]
        result = chunk_blocks(blocks, max_chars=300, min_chars=50)
        for chunk in result:
            # No chunk should start with "1750 RPM" (which would mean split at "approx.")
            assert not chunk["text"].lstrip().startswith("1750"), (
                f"Split at abbreviation: {chunk['text'][:60]}"
            )

    def test_fallback_on_no_boundary(self):
        """Long text with no periods falls back to char split."""
        text = "A" * 3000  # No sentence boundaries at all
        blocks = [{"text": text, "page_num": 1, "section": ""}]
        result = chunk_blocks(blocks, max_chars=800, min_chars=100)
        assert len(result) > 1
        # All chunks except possibly the last (remainder) should be fallback
        fallback_count = sum(
            1 for c in result if c["chunk_quality"] == "fallback_char_split"
        )
        assert fallback_count >= len(result) - 1

    def test_table_chunks_unaffected(self):
        """Tables still use row-boundary splitting, chunk_quality='table'."""
        table = (
            "| Parameter | Value |\n"
            "|---|---|\n"
            "| Voltage | 480V |\n"
            "| Current | 15A |"
        )
        blocks = [{"text": table, "page_num": 1, "section": "Specs"}]
        result = chunk_blocks(blocks, max_chars=2000, min_chars=50)
        assert result[0]["chunk_type"] == "table"
        assert result[0]["chunk_quality"] == "table"

    def test_chunk_quality_metadata(self):
        """Every chunk has a chunk_quality field."""
        sentences = "This is a test sentence. " * 50
        blocks = [{"text": sentences, "page_num": 1, "section": ""}]
        result = chunk_blocks(blocks, max_chars=200, min_chars=50)
        for chunk in result:
            assert "chunk_quality" in chunk
            assert chunk["chunk_quality"] in (
                "sentence_split", "fallback_char_split", "table", "token_truncated"
            )

    def test_sentence_aware_false_uses_old_logic(self):
        """When sentence_aware=False, character-based splitting is used."""
        text = "A" * 3000
        blocks = [{"text": text, "page_num": 1, "section": ""}]
        result = chunk_blocks(
            blocks, max_chars=800, min_chars=100, sentence_aware=False,
        )
        assert len(result) > 1
        for chunk in result:
            assert chunk["chunk_quality"] == "fallback_char_split"

    def test_small_block_passes_through_with_quality(self):
        """Small blocks that don't need splitting get sentence_split quality."""
        blocks = [{"text": "Short text here. With a sentence.", "page_num": 1, "section": ""}]
        result = chunk_blocks(blocks, max_chars=2000, min_chars=10)
        assert len(result) == 1
        assert result[0]["chunk_quality"] == "sentence_split"
