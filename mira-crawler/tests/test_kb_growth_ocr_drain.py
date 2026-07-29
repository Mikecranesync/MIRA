"""Unit tests: OCR-drain 0-char (scanned) PDFs via Tika before quarantine.

Spec: issue #2539 — Drive Commander 2/8, close the needs_ocr dead-letter.
Module under test: mira-crawler/cron/kb_growth_cron.py

Before #2539, a scanned/image-only PDF (0-char local extraction) was terminally
quarantined ``needs_ocr`` and never drained — so scanned drive manuals could
never become a pack. Now the cron re-runs the ingest pipeline with Tika OCR
(``--ocr``) BEFORE quarantining, and quarantines only when OCR is unavailable or
still empty (fail-safe). Existing ``needs_ocr`` entries drain on demand via
``--drain-needs-ocr``.

These tests mirror ``test_kb_growth_zero_char_quarantine.py`` — the cron drives
the pipeline as a subprocess, so ``run_pipeline`` is monkeypatched. The OCR
retry is a second ``run_pipeline(entry, ocr=True)`` call, so the fake branches
on the ``ocr`` kwarg.
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

# The exact 0-char extraction report tail (scanned/image-only manual), as it
# appears in the subprocess output for a real pdfplumber/pypdf empty extraction.
_ZERO_CHAR_TAIL = (
    "INFO mira.full_ingest: Downloaded: scanned.pdf (512 KB)\n"
    "PDF:          scanned.pdf (0.5 MB)\n"
    "Extract:      pypdf (empty) → 0 chars extracted\n"
    "KB Chunks:    0 chunks created (2000 char, 200 overlap)\n"
    "Errors (1):\n"
    "  • Extract: pypdf produced 0 chars\n"
)

# What the pipeline prints when OCR succeeded (Tika found a text layer).
_OCR_SUCCESS_TAIL = (
    "INFO mira.full_ingest: OCR (Tika) extracted 4200 chars from scanned.pdf\n"
    "Extract:      tika_ocr → 4,200 chars extracted\n"
    "KB Chunks:    9 chunks created (2000 char, 200 overlap)\n"
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
    """Mock NeonDB dedup + Telegram + report + drive-pack bridge so tests are pure."""
    monkeypatch.setattr(cron, "url_already_ingested", lambda url: False)
    monkeypatch.setattr(cron, "_tg_notify", lambda *a, **k: True)
    monkeypatch.setattr(cron, "_REPORT_AVAILABLE", False)
    monkeypatch.setattr(cron, "_run_drive_pack_bridge", lambda entry: None)
    return monkeypatch


# ─── fresh 0-char: OCR before quarantine ─────────────────────────────────────


class TestZeroCharOcrDrain:
    def test_zero_char_then_ocr_success_ingests_not_quarantined(
        self, queue_file, make_entry, patch_io, monkeypatch
    ):
        queue_file.write_text(json.dumps([make_entry()]))

        def fake_pipeline(entry, ocr=False):
            if ocr:  # the OCR retry — Tika found text
                return True, _OCR_SUCCESS_TAIL, 9
            return False, _ZERO_CHAR_TAIL, 0  # local extraction: 0 chars

        monkeypatch.setattr(cron, "run_pipeline", fake_pipeline)

        cron.run_batch()

        post = json.loads(queue_file.read_text())[0]
        assert post["status"] == "done"
        assert post["chunks_inserted"] == 9
        assert post["ocr_used"] is True
        assert "needs_ocr_at" not in post
        assert "next_retry_at" not in post

    def test_zero_char_then_ocr_empty_still_needs_ocr(
        self, queue_file, make_entry, patch_io, monkeypatch
    ):
        queue_file.write_text(json.dumps([make_entry()]))

        def fake_pipeline(entry, ocr=False):
            # Both local extraction and OCR find no text.
            return False, _ZERO_CHAR_TAIL, 0

        monkeypatch.setattr(cron, "run_pipeline", fake_pipeline)

        cron.run_batch()

        post = json.loads(queue_file.read_text())[0]
        assert post["status"] == "needs_ocr"
        assert "next_retry_at" not in post

    def test_zero_char_then_tika_unreachable_still_needs_ocr(
        self, queue_file, make_entry, patch_io, monkeypatch
    ):
        # Fail-safe: OCR retry raises (Tika unreachable / subprocess error).
        # _attempt_ocr must swallow it and the cron must quarantine, not crash.
        queue_file.write_text(json.dumps([make_entry()]))

        def fake_pipeline(entry, ocr=False):
            if ocr:
                raise ConnectionError("Tika unreachable at http://mira-tika:9998")
            return False, _ZERO_CHAR_TAIL, 0

        monkeypatch.setattr(cron, "run_pipeline", fake_pipeline)

        cron.run_batch()  # must not raise

        post = json.loads(queue_file.read_text())[0]
        assert post["status"] == "needs_ocr"
        assert "next_retry_at" not in post

    def test_ocr_never_attempted_when_extraction_succeeds(
        self, queue_file, make_entry, patch_io, monkeypatch
    ):
        # Normal text-layer PDF: OCR (ocr=True) must never be invoked.
        queue_file.write_text(json.dumps([make_entry()]))
        calls = {"ocr": 0, "plain": 0}

        def fake_pipeline(entry, ocr=False):
            if ocr:
                calls["ocr"] += 1
            else:
                calls["plain"] += 1
            return True, "KB Chunks: 16 chunks created", 16

        monkeypatch.setattr(cron, "run_pipeline", fake_pipeline)

        cron.run_batch()

        assert calls["plain"] == 1
        assert calls["ocr"] == 0
        assert json.loads(queue_file.read_text())[0]["status"] == "done"


# ─── _attempt_ocr is fail-safe (never raises) ────────────────────────────────


class TestAttemptOcrFailSafe:
    def test_attempt_ocr_swallows_exception(self, make_entry, monkeypatch):
        def boom(entry, ocr=False):
            raise RuntimeError("boom")

        monkeypatch.setattr(cron, "run_pipeline", boom)
        ok, tail, chunks = cron._attempt_ocr(make_entry())
        assert ok is False
        assert chunks == 0
        assert "boom" in tail

    def test_attempt_ocr_passes_ocr_flag(self, make_entry, monkeypatch):
        seen = {}

        def fake(entry, ocr=False):
            seen["ocr"] = ocr
            return True, "KB Chunks: 3 chunks created", 3

        monkeypatch.setattr(cron, "run_pipeline", fake)
        cron._attempt_ocr(make_entry())
        assert seen["ocr"] is True


# ─── regression: normal + transient-failure behavior unchanged ───────────────


class TestUnchangedBehavior:
    def test_successful_text_layer_extraction_still_succeeds(
        self, queue_file, make_entry, patch_io, monkeypatch
    ):
        queue_file.write_text(json.dumps([make_entry()]))
        monkeypatch.setattr(
            cron, "run_pipeline",
            lambda entry, ocr=False: (True, "KB Chunks: 16 chunks created", 16),
        )

        cron.run_batch()

        post = json.loads(queue_file.read_text())[0]
        assert post["status"] == "done"
        assert post["chunks_inserted"] == 16
        assert "ocr_used" not in post

    def test_transient_download_failure_still_retries(
        self, queue_file, make_entry, patch_io, monkeypatch
    ):
        queue_file.write_text(json.dumps([make_entry()]))
        monkeypatch.setattr(
            cron, "run_pipeline",
            lambda entry, ocr=False: (False, "Docling failed: HTTP 504 timeout", 0),
        )

        cron.run_batch()

        post = json.loads(queue_file.read_text())[0]
        assert post["status"] == "failed_retryable"
        assert "next_retry_at" in post
        assert "needs_ocr_at" not in post

    def test_hard_failure_still_hard_fails(
        self, queue_file, make_entry, patch_io, monkeypatch
    ):
        queue_file.write_text(json.dumps([make_entry()]))
        monkeypatch.setattr(
            cron, "run_pipeline",
            lambda entry, ocr=False: (False, "HTTP 404 not found", 0),
        )

        cron.run_batch()

        post = json.loads(queue_file.read_text())[0]
        assert post["status"] == "failed"
        assert "next_retry_at" not in post


# ─── --drain-needs-ocr: one-time OCR retry of quarantined entries ────────────


class TestDrainNeedsOcr:
    def test_drain_ocr_success_marks_done(
        self, queue_file, make_entry, patch_io, monkeypatch
    ):
        queue_file.write_text(json.dumps([make_entry(status="needs_ocr")]))
        monkeypatch.setattr(
            cron, "run_pipeline",
            lambda entry, ocr=False: (True, _OCR_SUCCESS_TAIL, 7),
        )

        cron.drain_needs_ocr()

        post = json.loads(queue_file.read_text())[0]
        assert post["status"] == "done"
        assert post["chunks_inserted"] == 7
        assert post["ocr_used"] is True

    def test_drain_ocr_still_empty_stays_needs_ocr(
        self, queue_file, make_entry, patch_io, monkeypatch
    ):
        queue_file.write_text(json.dumps([make_entry(status="needs_ocr")]))
        monkeypatch.setattr(
            cron, "run_pipeline",
            lambda entry, ocr=False: (False, _ZERO_CHAR_TAIL, 0),
        )

        cron.drain_needs_ocr()

        post = json.loads(queue_file.read_text())[0]
        assert post["status"] == "needs_ocr"
        assert "last_ocr_attempt_at" in post

    def test_drain_tika_unreachable_stays_needs_ocr(
        self, queue_file, make_entry, patch_io, monkeypatch
    ):
        queue_file.write_text(json.dumps([make_entry(status="needs_ocr")]))

        def boom(entry, ocr=False):
            raise ConnectionError("Tika unreachable")

        monkeypatch.setattr(cron, "run_pipeline", boom)

        cron.drain_needs_ocr()  # must not raise

        post = json.loads(queue_file.read_text())[0]
        assert post["status"] == "needs_ocr"

    def test_drain_noop_when_no_needs_ocr(
        self, queue_file, make_entry, patch_io, monkeypatch
    ):
        queue_file.write_text(json.dumps([make_entry(status="pending")]))
        called = {"n": 0}

        def fake(entry, ocr=False):
            called["n"] += 1
            return True, "KB Chunks: 1 chunks created", 1

        monkeypatch.setattr(cron, "run_pipeline", fake)

        cron.drain_needs_ocr()

        assert called["n"] == 0  # pending entry untouched by the drain
        assert json.loads(queue_file.read_text())[0]["status"] == "pending"
