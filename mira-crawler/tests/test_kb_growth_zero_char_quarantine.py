"""Unit tests: quarantine scanned/image-only (0-char) PDFs instead of retrying.

Spec: docs/specs/kb-ingest-acceleration-spec.md
Module under test: mira-crawler/cron/kb_growth_cron.py

Scanned/image-only manuals have no text layer, so pdfplumber/pypdf extract 0
characters. Before this change, that entry either retried forever
(``failed_retryable``) or was eventually promoted to a hard ``failed`` after
burning ``MAX_ATTEMPTS`` — wasting a cron cycle every hour. It should instead
land on a distinct terminal status (``needs_ocr``) on the FIRST 0-char run and
never be scheduled for retry.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# Make the cron file importable. It's not a package, so we add its dir.
_CRON_DIR = Path(__file__).resolve().parent.parent / "cron"
sys.path.insert(0, str(_CRON_DIR))

import kb_growth_cron as cron  # noqa: E402

# The exact error line `full_ingest_pipeline.step_extract` appends to
# `PipelineReport.errors` for a real (pdfplumber/pypdf) 0-char extraction,
# as it appears in the printed report's "Errors (N):" section — this is what
# the subprocess tail actually contains for a scanned/image-only manual.
_ZERO_CHAR_TAIL = (
    "INFO mira.full_ingest: Downloaded: scanned.pdf (512 KB)\n"
    "══════════════════════════════════════════════════\n"
    "INGEST PIPELINE REPORT\n"
    "══════════════════════════════════════════════════\n"
    "PDF:          scanned.pdf (0.5 MB)\n"
    "Extract:      pypdf (empty) → 0 chars extracted\n"
    "KB Chunks:    0 chunks created (2000 char, 200 overlap)\n"
    "KG Entities:  0 equipment, 0 fault codes\n"
    "KG Relations: 0 verified, 0 proposed (pending human review)\n"
    "KG Triples:   0 logged (source: manual_ingest)\n"
    "Quality Gate: skipped\n"
    "\n"
    "Errors (1):\n"
    "  • Extract: pypdf produced 0 chars\n"
    "══════════════════════════════════════════════════\n"
)


@pytest.fixture
def queue_file(tmp_path, monkeypatch):
    qf = tmp_path / "manual_queue.json"
    qf.write_text("[]")
    monkeypatch.setattr(cron, "QUEUE_FILE", qf)
    return qf


@pytest.fixture
def make_entry():
    def _make(**overrides):
        base = {
            "url": "https://example.com/scanned.pdf",
            "manufacturer": "Allen-Bradley",
            "model": "1606-XLS",
            "type": "installation_manual",
            "status": "pending",
        }
        base.update(overrides)
        return base
    return _make


@pytest.fixture
def patch_io(monkeypatch):
    """Mock NeonDB dedup + Telegram + report so tests are pure."""
    monkeypatch.setattr(cron, "url_already_ingested", lambda url: False)
    monkeypatch.setattr(cron, "_tg_notify", lambda *a, **k: True)
    monkeypatch.setattr(cron, "_REPORT_AVAILABLE", False)
    return monkeypatch


# ─── marker detection ──────────────────────────────────────────────────────────


class TestIsZeroCharExtraction:
    def test_detects_the_report_marker(self):
        assert cron._is_zero_char_extraction(_ZERO_CHAR_TAIL) is True

    def test_pdfplumber_variant_detected(self):
        assert cron._is_zero_char_extraction(
            "  • Extract: pdfplumber produced 0 chars"
        ) is True

    def test_download_failure_not_zero_char(self):
        assert cron._is_zero_char_extraction("Download failed: HTTP 404") is False

    def test_generic_exception_not_zero_char(self):
        # step_extract's exception path appends "Extract: {exc}" — a real
        # error, not the "produced 0 chars" no-text-layer case.
        assert cron._is_zero_char_extraction(
            "Extract: PdfReadError: EOF marker not found"
        ) is False

    def test_transient_timeout_not_zero_char(self):
        assert cron._is_zero_char_extraction("TIMEOUT after 900s") is False

    def test_empty_tail_not_zero_char(self):
        assert cron._is_zero_char_extraction("") is False
        assert cron._is_zero_char_extraction(None) is False


# ─── batch processing: 0-char result quarantines, does not retry ─────────────


class TestZeroCharQuarantine:
    def test_zero_char_result_sets_needs_ocr_no_retry(
        self, queue_file, make_entry, patch_io, monkeypatch
    ):
        queue_file.write_text(json.dumps([make_entry()]))
        monkeypatch.setattr(
            cron, "run_pipeline",
            lambda entry: (False, _ZERO_CHAR_TAIL, 0),
        )

        cron.run_batch()

        post = json.loads(queue_file.read_text())[0]
        assert post["status"] == "needs_ocr"
        assert "next_retry_at" not in post
        assert post["attempts"] == 1

    def test_needs_ocr_entry_not_eligible_for_next_run(self, make_entry):
        # Once quarantined, the janitor/eligibility check must never
        # re-select it — this is what actually stops the hourly retry.
        assert not cron._eligible_for_run(
            make_entry(status="needs_ocr"), cron._now()
        )

    def test_needs_ocr_not_re_processed_on_subsequent_batch(
        self, queue_file, make_entry, patch_io, monkeypatch
    ):
        queue_file.write_text(json.dumps([make_entry(status="needs_ocr")]))
        called = {"n": 0}

        def fake_pipeline(entry):
            called["n"] += 1
            return True, "KB Chunks: 5 chunks created", 5

        monkeypatch.setattr(cron, "run_pipeline", fake_pipeline)

        cron.run_batch()

        assert called["n"] == 0  # pipeline never re-invoked
        post = json.loads(queue_file.read_text())[0]
        assert post["status"] == "needs_ocr"  # untouched

    def test_needs_ocr_counted_in_queue_stats(self, make_entry):
        queue = [
            make_entry(status="needs_ocr"),
            make_entry(status="needs_ocr"),
            make_entry(status="pending"),
        ]
        stats = cron._queue_stats(queue)
        assert stats["needs_ocr"] == 2
        assert stats["total"] == 3
        # Quarantined entries are terminal — they don't count as "remaining".
        assert stats["remaining"] == 1


# ─── regression: normal (text-layer) extraction is unaffected ───────────────


class TestNormalExtractionUnaffected:
    def test_successful_text_layer_extraction_still_succeeds(
        self, queue_file, make_entry, patch_io, monkeypatch
    ):
        queue_file.write_text(json.dumps([make_entry()]))
        monkeypatch.setattr(
            cron, "run_pipeline",
            lambda entry: (True, "KB Chunks: 16 chunks created", 16),
        )

        cron.run_batch()

        post = json.loads(queue_file.read_text())[0]
        assert post["status"] == "done"
        assert post["chunks_inserted"] == 16

    def test_genuine_transient_failure_still_retries(
        self, queue_file, make_entry, patch_io, monkeypatch
    ):
        queue_file.write_text(json.dumps([make_entry()]))
        monkeypatch.setattr(
            cron, "run_pipeline",
            lambda entry: (False, "Docling failed: HTTP 504 timeout", 0),
        )

        cron.run_batch()

        post = json.loads(queue_file.read_text())[0]
        assert post["status"] == "failed_retryable"
        assert "next_retry_at" in post

    def test_genuine_hard_failure_still_hard_fails(
        self, queue_file, make_entry, patch_io, monkeypatch
    ):
        queue_file.write_text(json.dumps([make_entry()]))
        monkeypatch.setattr(
            cron, "run_pipeline",
            lambda entry: (False, "HTTP 404 not found", 0),
        )

        cron.run_batch()

        post = json.loads(queue_file.read_text())[0]
        assert post["status"] == "failed"
        assert "next_retry_at" not in post
