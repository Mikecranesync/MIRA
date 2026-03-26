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
