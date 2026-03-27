"""Tests for section-aware document chunker."""

from __future__ import annotations

from ingest.chunker import _extract_equipment_id, chunk_blocks


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
        blocks = [{"text": "word " * 500, "page_num": 1, "section": "Theory"}]
        result = chunk_blocks(blocks, max_chars=500, min_chars=100)
        assert len(result) > 1
        for chunk in result:
            assert len(chunk["text"]) <= 500

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
