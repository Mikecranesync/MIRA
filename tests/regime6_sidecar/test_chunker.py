"""Tests for document chunking — regime 6."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "mira-sidecar"))


class TestChunker:
    def test_chunk_txt_file(self, sample_txt_path):
        from rag.chunker import chunk_document

        chunks = chunk_document(str(sample_txt_path), chunk_size=50, overlap=10)
        assert len(chunks) > 0
        assert all(c.source_file == "test_sop.txt" for c in chunks)
        assert all(c.chunk_index >= 0 for c in chunks)

    def test_chunk_preserves_content(self, sample_txt_path):
        from rag.chunker import chunk_document

        chunks = chunk_document(str(sample_txt_path), chunk_size=2000, overlap=0)
        # With large chunk size, should get 1 chunk with all content
        full_text = " ".join(c.text for c in chunks)
        assert "Overcurrent" in full_text
        assert "Overvoltage" in full_text

    def test_chunk_respects_size(self, sample_txt_path):
        from rag.chunker import chunk_document

        chunks = chunk_document(str(sample_txt_path), chunk_size=20, overlap=5)
        # Each chunk's token count should be roughly <= chunk_size
        for chunk in chunks:
            # Rough token estimate: words / 0.75
            word_count = len(chunk.text.split())
            assert word_count <= 30  # generous margin for 20-token chunks

    def test_chunk_overlap_works(self, sample_txt_path):
        from rag.chunker import chunk_document

        chunks = chunk_document(str(sample_txt_path), chunk_size=30, overlap=10)
        if len(chunks) >= 2:
            # Last words of chunk N should appear in first words of chunk N+1
            words_0 = chunks[0].text.split()
            words_1 = chunks[1].text.split()
            # Some overlap should exist
            overlap_words = set(words_0[-15:]) & set(words_1[:15])
            assert len(overlap_words) > 0

    def test_chunk_empty_file(self, tmp_path):
        from rag.chunker import chunk_document

        empty = tmp_path / "empty.txt"
        empty.write_text("")
        chunks = chunk_document(str(empty))
        assert chunks == []

    def test_chunk_nonexistent_file(self):
        from rag.chunker import chunk_document

        # Chunker logs error and returns empty list for missing files
        chunks = chunk_document("/nonexistent/file.txt")
        assert chunks == []
