"""Tests for the ingest_url Celery task — particularly scheme handling (M8)."""
from __future__ import annotations

from unittest.mock import patch


class TestIngestUrlFileScheme:
    """Verify ingest_url handles file:// URLs correctly (M8)."""

    def test_file_scheme_reads_local_pdf(self, tmp_path, monkeypatch):
        """ingest_url succeeds when given a file:// URL pointing to a real file."""
        pdf_path = tmp_path / "test.pdf"
        pdf_path.write_bytes(b"%PDF-1.4\n...")  # minimal fake PDF content
        # Use Path.as_uri() to produce a valid file:// URL on all platforms
        # (handles Windows drive letters correctly: file:///C:/...)
        file_url = pdf_path.as_uri()

        monkeypatch.setenv("MIRA_TENANT_ID", "test-tenant")
        monkeypatch.setenv("OLLAMA_BASE_URL", "http://localhost:11434")
        monkeypatch.setenv("EMBED_MODEL", "nomic-embed-text:latest")

        fake_blocks = [
            {"text": "hello world from pdf", "page_num": 1, "section": "", "source_url": file_url}
        ]
        fake_chunks = [
            {
                "text": "hello world chunk with enough content to pass filters.",
                "chunk_index": 0,
                "page_num": 1,
                "section": "",
                "chunk_type": "text",
            }
        ]

        # ingest_url imports these lazily inside the function body.
        # Patch at their source modules so the function picks up the mocks.
        with patch("ingest.converter.extract_from_pdf_with_fallback", return_value=fake_blocks), \
             patch("ingest.chunker.chunk_blocks", return_value=fake_chunks), \
             patch("ingest.embedder.embed_text", return_value=[0.1] * 768), \
             patch("ingest.store.chunk_exists", return_value=False), \
             patch("ingest.store.insert_chunk", return_value="fake-id") as mock_insert, \
             patch("ingest.quality.quality_gate", return_value=(True, "")):
            from tasks.ingest import ingest_url

            result = ingest_url.run(url=file_url)

        assert result.get("error") is None or not result.get("error")
        assert mock_insert.called

    def test_file_scheme_missing_file_returns_error(self, monkeypatch):
        """ingest_url returns a local_read_failed error for non-existent file:// paths."""
        monkeypatch.setenv("MIRA_TENANT_ID", "test-tenant")
        monkeypatch.setenv("OLLAMA_BASE_URL", "http://localhost:11434")
        monkeypatch.setenv("EMBED_MODEL", "nomic-embed-text:latest")

        from tasks.ingest import ingest_url

        result = ingest_url.run(url="file:///nonexistent/path/missing.pdf")
        assert "error" in result
        assert "local_read_failed" in result["error"]

    def test_file_scheme_no_tenant_id_returns_error(self, tmp_path, monkeypatch):
        """ingest_url returns no_tenant_id error when MIRA_TENANT_ID is unset."""
        monkeypatch.delenv("MIRA_TENANT_ID", raising=False)
        pdf_path = tmp_path / "test.pdf"
        pdf_path.write_bytes(b"%PDF-1.4\n...")
        file_url = f"file://{pdf_path}"

        from tasks.ingest import ingest_url

        result = ingest_url.run(url=file_url)
        assert result.get("error") == "no_tenant_id"

    def test_http_scheme_still_works(self, monkeypatch):
        """Ensure the http:// path was not broken by the file:// changes."""

        monkeypatch.setenv("MIRA_TENANT_ID", "test-tenant")
        monkeypatch.setenv("OLLAMA_BASE_URL", "http://localhost:11434")
        monkeypatch.setenv("EMBED_MODEL", "nomic-embed-text:latest")

        fake_blocks = [
            {"text": "VFD fault E007 overcurrent detected", "page_num": 1, "section": ""}
        ]
        fake_chunks = [
            {
                "text": "VFD fault E007 overcurrent detected in drive.",
                "chunk_index": 0,
                "page_num": 1,
                "section": "",
                "chunk_type": "text",
            }
        ]

        mock_resp = type("R", (), {
            "content": b"%PDF-1.4",
            "headers": {"content-type": "application/pdf"},
            "raise_for_status": lambda self: None,
        })()

        with patch("tasks.ingest.httpx.get", return_value=mock_resp), \
             patch("ingest.converter.extract_from_pdf_with_fallback", return_value=fake_blocks), \
             patch("ingest.chunker.chunk_blocks", return_value=fake_chunks), \
             patch("ingest.embedder.embed_text", return_value=[0.1] * 768), \
             patch("ingest.store.chunk_exists", return_value=False), \
             patch("ingest.store.insert_chunk", return_value="fake-id") as mock_insert, \
             patch("ingest.quality.quality_gate", return_value=(True, "")):
            from tasks.ingest import ingest_url

            ingest_url.run(
                url="https://cdn.automationdirect.com/manuals/gs20.pdf"
            )

        assert mock_insert.called
