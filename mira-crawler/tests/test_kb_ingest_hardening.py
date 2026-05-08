"""Tests for KB ingest hardening — the contract from
docs/specs/kb-ingest-hardening-spec.md must hold.

These tests are pure-Python and require no live Ollama / Docling / NeonDB.
They cover §6 (URL allowlist), §7 (fallback extraction), and the
pipeline_runs helper used by §4 observability.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

# ─── path bootstrap so tests can import the cron module ──────────────────────
_REPO_ROOT = Path(__file__).resolve().parents[2]
_CRON_DIR = _REPO_ROOT / "mira-crawler" / "cron"
_TASKS_DIR = _REPO_ROOT / "mira-crawler" / "tasks"
for p in (str(_CRON_DIR), str(_TASKS_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)


# ─── §6 URL allowlist ─────────────────────────────────────────────────────────


class TestUrlAllowlist:
    """Spec §6.1 — only allowlisted hosts may be downloaded."""

    def _import_host_allowed(self):
        from kb_growth_cron import _host_allowed
        return _host_allowed

    def test_exact_host_allowed(self):
        host_allowed = self._import_host_allowed()
        allowlist = {"automationdirect.com", "manualslib.com"}
        assert host_allowed("https://automationdirect.com/manuals/x.pdf", allowlist) is True

    def test_subdomain_allowed_via_suffix(self):
        host_allowed = self._import_host_allowed()
        allowlist = {"automationdirect.com"}
        assert host_allowed(
            "https://cdn.automationdirect.com/manuals/x.pdf", allowlist
        ) is True

    def test_unknown_host_rejected(self):
        host_allowed = self._import_host_allowed()
        allowlist = {"automationdirect.com"}
        assert host_allowed("https://evil.com/x.pdf", allowlist) is False

    def test_lookalike_domain_not_matched_by_substring(self):
        """Spec §6.1: 'foo.com' allows 'cdn.foo.com' but NOT 'fakefoo.com'."""
        host_allowed = self._import_host_allowed()
        allowlist = {"foo.com"}
        assert host_allowed("https://fakefoo.com/x.pdf", allowlist) is False
        assert host_allowed("https://foo.com.evil.com/x.pdf", allowlist) is False

    def test_empty_allowlist_means_open(self):
        """When no allowlist file exists (None), all URLs pass — dev mode."""
        host_allowed = self._import_host_allowed()
        assert host_allowed("https://anything.com/x.pdf", None) is True

    def test_malformed_url_rejected(self):
        host_allowed = self._import_host_allowed()
        allowlist = {"automationdirect.com"}
        assert host_allowed("not-a-url", allowlist) is False
        assert host_allowed("", allowlist) is False


# ─── §7 fallback extraction ───────────────────────────────────────────────────


class TestFallbackExtract:
    """Spec §7 — when Docling is down, pdfplumber/pypdf must keep the pipeline alive."""

    def test_missing_file_returns_empty(self, tmp_path):
        from extract_fallback import fallback_extract
        text, method = fallback_extract(tmp_path / "does-not-exist.pdf")
        assert text == ""
        assert method == "fallback_failed"

    def test_empty_file_returns_empty(self, tmp_path):
        from extract_fallback import fallback_extract
        empty = tmp_path / "empty.pdf"
        empty.write_bytes(b"")
        text, method = fallback_extract(empty)
        assert text == ""
        assert method == "fallback_failed"

    def test_pdfplumber_used_when_available(self, tmp_path):
        """If pdfplumber returns text, fallback_extract uses it (preferred path)."""
        from extract_fallback import fallback_extract

        fake_pdf = tmp_path / "ok.pdf"
        fake_pdf.write_bytes(b"%PDF-1.4 stub")

        class FakePage:
            def extract_text(self):
                return "fallback page text"

        class FakePdf:
            pages = [FakePage(), FakePage()]
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return False

        fake_module = type("FakeModule", (), {"open": lambda _: FakePdf()})
        with patch.dict(sys.modules, {"pdfplumber": fake_module}):
            text, method = fallback_extract(fake_pdf)

        assert "fallback page text" in text
        assert method == "pdfplumber"


# ─── pipeline_runs helper (§4) ────────────────────────────────────────────────


class TestPipelineRunsHelper:
    """Helper must remain DB-down safe — never raise to caller."""

    def test_open_run_returns_object_when_db_unreachable(self, monkeypatch):
        from pipeline_runs import open_run
        monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
        monkeypatch.delenv("DATABASE_URL", raising=False)
        run = open_run(pdf_url="https://x.com/a.pdf", manufacturer="Test", model="X")
        assert run.pdf_url == "https://x.com/a.pdf"
        assert run.manufacturer == "Test"
        assert run.status == "running"
        assert run.id  # uuid string

    def test_close_run_truncates_long_errors(self, monkeypatch):
        from pipeline_runs import open_run, close_run
        monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
        monkeypatch.delenv("DATABASE_URL", raising=False)
        run = open_run(pdf_url="https://x.com/a.pdf")
        long_err = "x" * 5000
        close_run(run, status="failed", step_failed="embed", error=long_err)
        assert run.error is not None
        assert len(run.error) <= 500
        assert run.duration_ms is not None and run.duration_ms >= 0

    def test_close_run_preserves_chunks_count(self, monkeypatch):
        from pipeline_runs import open_run, close_run
        monkeypatch.delenv("NEON_DATABASE_URL", raising=False)
        monkeypatch.delenv("DATABASE_URL", raising=False)
        run = open_run(pdf_url="https://x.com/a.pdf")
        close_run(run, status="ok", chunks_created=42)
        assert run.chunks_created == 42
        assert run.status == "ok"


# ─── §4.1 structured logging ─────────────────────────────────────────────────


class TestStructuredLogging:
    def test_jlog_emits_valid_json_with_required_fields(self, capsys):
        import json as _json
        from kb_growth_cron import jlog
        jlog("ingest", "ok", duration_ms=1234, chunks=10)
        out = capsys.readouterr().out.strip()
        rec = _json.loads(out)
        assert rec["step"] == "ingest"
        assert rec["status"] == "ok"
        assert rec["duration_ms"] == 1234
        assert rec["chunks"] == 10
        assert "ts" in rec  # spec §4.1 — every record has a timestamp

    def test_jlog_truncates_error(self, capsys):
        import json as _json
        from kb_growth_cron import jlog
        jlog("download", "failed", error="x" * 1000)
        rec = _json.loads(capsys.readouterr().out.strip())
        assert len(rec["error"]) <= 500


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
