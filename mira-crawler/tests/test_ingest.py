"""Tests for the ingest_url Celery task — particularly scheme handling (M8)."""
from __future__ import annotations

import os
import shutil
from unittest.mock import patch

import pytest


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
        monkeypatch.setenv("INGEST_LOCAL_ALLOWED_DIR", str(tmp_path))
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
        # Inside the allowed dir so the curation gate passes and the READ fails.
        monkeypatch.setenv("INGEST_LOCAL_ALLOWED_DIR", "/nonexistent")
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

        # The download path streams via httpx.Client (OOM hardening) — mock
        # the streaming client, not httpx.get (the old mock silently missed
        # and this test hit the real network; pre-existing red fixed in CU-03).
        class _FakeStreamResp:
            status_code = 200
            headers = {"content-type": "application/pdf"}

            def raise_for_status(self):
                return None

            def iter_bytes(self, chunk_size):
                yield b"%PDF-1.4"

        class _FakeStreamCtx:
            def __enter__(self):
                return _FakeStreamResp()

            def __exit__(self, *exc):
                return False

        class _FakeClient:
            def __init__(self, *a, **k):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def stream(self, method, url):
                return _FakeStreamCtx()

        fake_head = type("H", (), {"headers": {"content-length": "100"}})()

        with patch("tasks.ingest.httpx.Client", _FakeClient), \
             patch("tasks.ingest.httpx.head", return_value=fake_head), \
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


_POSIX_ONLY = pytest.mark.skipif(
    os.name != "posix",
    reason="dir_fd/O_NOFOLLOW are POSIX-only; the Windows-dev plain-open "
    "residual is recorded in units/CU-03.md (production is Linux)",
)


class TestReadValidatedSymlinkWalk:
    """_read_validated must refuse a symlink swapped into ANY path component
    below the allowed base after validation (Gate 9 round-2 finding: the
    final-component-only O_NOFOLLOW left the parent-component swap open)."""

    @_POSIX_ONLY
    def test_parent_component_symlink_swap_is_refused(self, tmp_path, monkeypatch):
        base = tmp_path / "inbox"
        (base / "real").mkdir(parents=True)
        outside = tmp_path / "outside"
        outside.mkdir()
        (outside / "doc.pdf").write_bytes(b"%PDF-1.4 attacker payload")
        monkeypatch.setenv("INGEST_LOCAL_ALLOWED_DIR", str(base))

        (base / "real" / "doc.pdf").write_bytes(b"%PDF-1.4 legit")
        validated = (base / "real" / "doc.pdf").resolve()

        # Post-validation swap: the PARENT directory becomes a symlink out of base.
        shutil.rmtree(base / "real")
        (base / "real").symlink_to(outside)

        from tasks.ingest import _read_validated

        with pytest.raises(OSError):
            _read_validated(validated)

    @_POSIX_ONLY
    def test_final_component_symlink_swap_is_refused(self, tmp_path, monkeypatch):
        base = tmp_path / "inbox"
        base.mkdir()
        outside = tmp_path / "secret.pdf"
        outside.write_bytes(b"%PDF-1.4 attacker payload")
        monkeypatch.setenv("INGEST_LOCAL_ALLOWED_DIR", str(base))

        (base / "doc.pdf").write_bytes(b"%PDF-1.4 legit")
        validated = (base / "doc.pdf").resolve()

        (base / "doc.pdf").unlink()
        (base / "doc.pdf").symlink_to(outside)

        from tasks.ingest import _read_validated

        with pytest.raises(OSError):
            _read_validated(validated)

    def test_platform_guard_is_set_membership_and_reads_on_every_platform(
        self, tmp_path, monkeypatch
    ):
        """Gate 7 round-12 group A finding on #3268 claimed `os.supports_dir_fd` is
        a *boolean*, so `os.open not in os.supports_dir_fd` would raise TypeError
        and abort every local-file ingest. It is a set (the documented idiom is
        `os.stat in os.supports_dir_fd`). This test is deliberately NOT POSIX-only:
        the guard line executes here on Windows (plain-open branch) and on Linux
        CI (dir_fd walk), so a TypeError on either platform is a red test."""
        assert isinstance(os.supports_dir_fd, (set, frozenset))
        base = tmp_path / "inbox"
        base.mkdir()
        monkeypatch.setenv("INGEST_LOCAL_ALLOWED_DIR", str(base))
        (base / "doc.pdf").write_bytes(b"%PDF-1.4 legit")

        from tasks.ingest import _read_validated

        assert _read_validated((base / "doc.pdf").resolve()) == b"%PDF-1.4 legit"

    @_POSIX_ONLY
    def test_honest_nested_file_within_base_still_reads(self, tmp_path, monkeypatch):
        base = tmp_path / "inbox"
        (base / "sub").mkdir(parents=True)
        monkeypatch.setenv("INGEST_LOCAL_ALLOWED_DIR", str(base))
        (base / "sub" / "doc.pdf").write_bytes(b"%PDF-1.4 legit")

        from tasks.ingest import _read_validated

        assert _read_validated((base / "sub" / "doc.pdf").resolve()) == b"%PDF-1.4 legit"

    @_POSIX_ONLY
    def test_path_outside_base_is_refused_even_at_read_time(self, tmp_path, monkeypatch):
        base = tmp_path / "inbox"
        base.mkdir()
        monkeypatch.setenv("INGEST_LOCAL_ALLOWED_DIR", str(base))
        stray = tmp_path / "stray.pdf"
        stray.write_bytes(b"%PDF-1.4")

        from tasks.ingest import _read_validated

        with pytest.raises(ValueError):
            _read_validated(stray.resolve())
