"""scrape_pdf_direct must extract PDFs in-process — never POST to docling.

Docling was removed 2026-06-06 (OOM — docs/known-issues/
2026-06-06-hub-upload-failures-docling-oom.md). `full_ingest_pipeline` was
repointed to the in-process `ingest.pdf_extract` on 2026-07-07, but
`tasks/manualslib_scraper.py::scrape_pdf_direct` kept POSTing every PDF to
`DOCLING_URL` (default `http://localhost:5001`) — Connection-refused on every
call since. These tests pin the local-extraction behavior (Machine Pack plan
Phase 0, PR-0.1).

Module under test: mira-crawler/tasks/manualslib_scraper.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

# Local layout import (same convention as test_celery_app_resilient_imports.py)
_CRAWLER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_CRAWLER_DIR))

from tasks import manualslib_scraper  # noqa: E402

_MODULE_SOURCE = (_CRAWLER_DIR / "tasks" / "manualslib_scraper.py").read_text(encoding="utf-8")

_FAKE_PDF = b"%PDF-1.4 fake bytes"
_FAKE_MD = "## Section 1\n\nGS20 drive fault codes: GFF ground fault."


class _FakeResponse:
    """Minimal httpx.Response stand-in for the download GET."""

    content = _FAKE_PDF

    def raise_for_status(self) -> None:  # pragma: no cover - never raises
        return None


class _DownloadOnlyClient:
    """httpx.Client stand-in: GET works, any POST is a test failure."""

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, url, **kwargs):
        return _FakeResponse()

    def post(self, url, **kwargs):  # pragma: no cover - the assertion target
        raise AssertionError(f"scrape_pdf_direct must not POST anywhere (attempted: {url})")


@pytest.fixture()
def local_extract(tmp_path, monkeypatch):
    """Patch the network client, the extractor seam, and the output dir."""
    monkeypatch.setattr(manualslib_scraper.httpx, "Client", _DownloadOnlyClient)
    monkeypatch.setattr(manualslib_scraper, "OUTPUT_DIR", tmp_path)
    calls: list[Path] = []

    def _fake_extract(pdf_path):
        calls.append(Path(pdf_path))
        return _FAKE_MD, "pdfplumber"

    monkeypatch.setattr(manualslib_scraper, "_extract_pdf_text", _fake_extract)
    return calls


def test_extracts_locally_without_posting(local_extract, tmp_path):
    result = manualslib_scraper.scrape_pdf_direct(
        pdf_url="https://cdn.example.com/manuals/gs20.pdf",
        manufacturer="AutomationDirect",
        model="GS20",
        manual_type="user_manual",
        ingest=False,
    )

    assert "error" not in result
    assert result["extracted_chars"] == len(_FAKE_MD)
    assert local_extract, "in-process extractor was never called"
    out = Path(result["output_file"])
    assert out.exists()
    assert "GS20 drive fault codes" in out.read_text(encoding="utf-8")


def test_empty_extraction_reports_error_not_crash(local_extract, tmp_path, monkeypatch):
    monkeypatch.setattr(manualslib_scraper, "_extract_pdf_text", lambda p: ("", "none"))
    result = manualslib_scraper.scrape_pdf_direct(
        pdf_url="https://cdn.example.com/manuals/empty.pdf",
        ingest=False,
    )
    assert result["extracted_chars"] == 0
    assert "error" in result


def test_no_docling_references_remain_in_module():
    """Structural regression pin: the dead service must not come back."""
    assert "5001" not in _MODULE_SOURCE
    assert "DOCLING_URL" not in _MODULE_SOURCE
    # Prose mentions of the removal history are fine; live URLs are not.
    assert not re.search(r"docling[^\n]*/v1/convert", _MODULE_SOURCE)


def test_deprecated_docling_url_param_is_ignored(local_extract):
    """Old callers passing docling_url= must still work (ignored, no POST)."""
    result = manualslib_scraper.scrape_pdf_direct(
        pdf_url="https://cdn.example.com/manuals/gs20.pdf",
        ingest=False,
        docling_url="http://localhost:5001",
    )
    assert "error" not in result
    assert result["extracted_chars"] > 0
