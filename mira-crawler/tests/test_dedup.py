"""Tests for MD5-based document deduplication."""

from __future__ import annotations

from pathlib import Path

from ingest.dedup import DedupStore, _file_hash


class TestFileHash:
    def test_deterministic(self):
        """Same content always produces same hash."""
        data = b"test content"
        assert _file_hash(data) == _file_hash(data)

    def test_different_content_different_hash(self):
        """Different content produces different hashes."""
        assert _file_hash(b"content a") != _file_hash(b"content b")


class TestDedupStore:
    def test_new_document_not_indexed(self, tmp_path):
        """Fresh document is not already indexed."""
        store = DedupStore(db_path=tmp_path / "dedup.db")
        assert store.is_already_indexed(b"new document") is False

    def test_mark_then_check(self, tmp_path):
        """After marking, document shows as indexed."""
        store = DedupStore(db_path=tmp_path / "dedup.db")
        data = b"some pdf content"
        store.mark_indexed(data, source_url="https://example.com/doc.pdf")
        assert store.is_already_indexed(data) is True

    def test_rerun_blocked(self, tmp_path):
        """Re-running same file returns indexed=True (dedup blocks rerun)."""
        store = DedupStore(db_path=tmp_path / "dedup.db")
        data = b"duplicate document"
        store.mark_indexed(data, source_url="https://example.com/a.pdf")
        assert store.is_already_indexed(data) is True

    def test_url_indexed_check(self, tmp_path):
        """is_url_indexed checks by source URL."""
        store = DedupStore(db_path=tmp_path / "dedup.db")
        url = "https://example.com/manual.pdf"
        assert store.is_url_indexed(url) is False
        store.mark_indexed(b"data", source_url=url)
        assert store.is_url_indexed(url) is True

    def test_metadata_stored(self, tmp_path):
        """Metadata is stored and retrievable."""
        store = DedupStore(db_path=tmp_path / "dedup.db")
        store.mark_indexed(
            b"data",
            source_url="https://example.com/doc.pdf",
            source_type="equipment_manual",
            equipment_id="IRB6700",
            chunk_count=42,
            metadata={"manufacturer": "ABB"},
        )
        stats = store.stats()
        assert stats["total_documents"] == 1
        assert stats["total_chunks"] == 42
        assert stats["by_source_type"].get("equipment_manual") == 1

    def test_stats_empty(self, tmp_path):
        """Stats on empty store returns zeros."""
        store = DedupStore(db_path=tmp_path / "dedup.db")
        stats = store.stats()
        assert stats["total_documents"] == 0
        assert stats["total_chunks"] == 0

    def test_thread_safe_connections(self, tmp_path):
        """Multiple DedupStore instances on same DB don't corrupt."""
        db = tmp_path / "shared.db"
        store_a = DedupStore(db_path=db)
        store_b = DedupStore(db_path=db)
        store_a.mark_indexed(b"doc1", source_url="url1")
        assert store_b.is_already_indexed(b"doc1") is True
