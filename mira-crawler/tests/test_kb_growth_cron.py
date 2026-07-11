"""Unit tests for the accelerated KB growth cron.

Spec: docs/specs/kb-ingest-acceleration-spec.md
Module under test: mira-crawler/cron/kb_growth_cron.py
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

import pytest

# Make the cron file importable. It's not a package, so we add its dir.
_CRON_DIR = Path(__file__).resolve().parent.parent / "cron"
sys.path.insert(0, str(_CRON_DIR))

import kb_growth_cron as cron  # noqa: E402

# ─── fixtures ─────────────────────────────────────────────────────────────────


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
            "url": "https://example.com/a.pdf",
            "manufacturer": "Allen-Bradley",
            "model": "1606-XLS",
            "type": "installation_manual",
            "status": "pending",
        }
        base.update(overrides)
        return base
    return _make


# ─── error classification ─────────────────────────────────────────────────────


class TestClassifyError:
    @pytest.mark.parametrize("err", [
        "Docling failed: HTTP 504 timeout",
        "httpx.ReadTimeout: timed out",
        "ConnectionError: nothing listening",
        "psycopg2.OperationalError: server closed",
        "TIMEOUT after 900s",
    ])
    def test_transient_classified_retryable(self, err):
        assert cron._classify_error(err) == "retryable"

    @pytest.mark.parametrize("err", [
        "HTTP 404 not found",
        "Downloaded file is not a valid PDF (bad magic bytes)",
        "Download aborted: exceeds 50 MB cap",
    ])
    def test_hard_failures_classified_hard(self, err):
        assert cron._classify_error(err) == "hard"

    def test_unknown_default_retryable(self):
        # Unknown errors retry — bounded by MAX_ATTEMPTS so they can't loop forever.
        assert cron._classify_error("something weird went wrong") == "retryable"

    def test_empty_error_retryable(self):
        assert cron._classify_error("") == "retryable"


# ─── backoff schedule ─────────────────────────────────────────────────────────


class TestBackoff:
    def test_first_retry_uses_base(self):
        assert cron._backoff_seconds(1) == cron.RETRY_BASE_SEC

    def test_second_retry_doubles(self):
        assert cron._backoff_seconds(2) == cron.RETRY_BASE_SEC * 2

    def test_caps_at_retry_cap(self):
        assert cron._backoff_seconds(99) == cron.RETRY_CAP_SEC

    def test_monotonically_increasing_until_cap(self):
        prev = 0
        for n in range(1, 8):
            cur = cron._backoff_seconds(n)
            assert cur >= prev
            prev = cur


# ─── eligibility / due-for-retry ──────────────────────────────────────────────


class TestEligibility:
    def test_pending_entry_is_eligible(self, make_entry):
        assert cron._eligible_for_run(make_entry(status="pending"), cron._now())

    def test_done_entry_not_eligible(self, make_entry):
        assert not cron._eligible_for_run(make_entry(status="done"), cron._now())

    def test_failed_entry_not_eligible(self, make_entry):
        assert not cron._eligible_for_run(make_entry(status="failed"), cron._now())

    def test_skipped_entry_not_eligible(self, make_entry):
        assert not cron._eligible_for_run(make_entry(status="skipped_dedup"), cron._now())

    def test_retryable_due_now_is_eligible(self, make_entry):
        past = (cron._now() - timedelta(minutes=1)).isoformat(timespec="seconds")
        e = make_entry(status="failed_retryable", next_retry_at=past)
        assert cron._eligible_for_run(e, cron._now())

    def test_retryable_in_future_not_eligible(self, make_entry):
        future = (cron._now() + timedelta(hours=1)).isoformat(timespec="seconds")
        e = make_entry(status="failed_retryable", next_retry_at=future)
        assert not cron._eligible_for_run(e, cron._now())

    def test_retryable_with_no_next_retry_is_eligible(self, make_entry):
        # Defensive: missing next_retry_at means "ASAP".
        e = make_entry(status="failed_retryable")
        e.pop("next_retry_at", None)
        assert cron._eligible_for_run(e, cron._now())


# ─── janitor: stuck states ───────────────────────────────────────────────────


class TestJanitor:
    def test_stale_processing_revived(self, make_entry):
        old = (cron._now() - timedelta(hours=2)).isoformat(timespec="seconds")
        queue = [make_entry(status="processing", started_at=old)]
        revived = cron.revive_stale(queue)
        assert revived == 1
        assert queue[0]["status"] == "failed_retryable"
        assert queue[0]["last_error"] == "stale_state_reset"

    def test_stale_downloading_revived(self, make_entry):
        old = (cron._now() - timedelta(hours=2)).isoformat(timespec="seconds")
        queue = [make_entry(status="downloading", started_at=old)]
        assert cron.revive_stale(queue) == 1
        assert queue[0]["status"] == "failed_retryable"

    def test_recent_processing_not_revived(self, make_entry):
        recent = (cron._now() - timedelta(minutes=5)).isoformat(timespec="seconds")
        queue = [make_entry(status="processing", started_at=recent)]
        assert cron.revive_stale(queue) == 0
        assert queue[0]["status"] == "processing"

    def test_processing_with_no_started_at_revived(self, make_entry):
        # If we somehow lost started_at, treat as stale and reset.
        e = make_entry(status="processing")
        e.pop("started_at", None)
        queue = [e]
        assert cron.revive_stale(queue) == 1


# ─── milestone helper ────────────────────────────────────────────────────────


class TestMilestoneCrossed:
    def test_crossing_100(self):
        assert cron._milestone_crossed(98, 103, 100) == 100

    def test_no_crossing(self):
        assert cron._milestone_crossed(50, 75, 100) is None

    def test_exactly_on_milestone(self):
        assert cron._milestone_crossed(99, 100, 100) == 100

    def test_no_progress(self):
        assert cron._milestone_crossed(150, 150, 100) is None

    def test_crosses_two_then_returns_higher(self):
        # Run jumped two milestones; reporting the higher one is fine.
        assert cron._milestone_crossed(95, 215, 100) == 200


# ─── queue stats ─────────────────────────────────────────────────────────────


class TestQueueStats:
    def test_counts_each_state(self, make_entry):
        queue = [
            make_entry(status="pending"),
            make_entry(status="pending"),
            make_entry(status="done"),
            make_entry(status="failed"),
            make_entry(status="failed_retryable"),
            make_entry(status="skipped_dedup"),
        ]
        stats = cron._queue_stats(queue)
        assert stats["pending"] == 2
        assert stats["done"] == 1
        assert stats["failed"] == 1
        assert stats["failed_retryable"] == 1
        assert stats["skipped_dedup"] == 1
        # remaining = pending + failed_retryable
        assert stats["remaining"] == 3
        assert stats["total"] == 6


# ─── missing queue file (fresh box / just-untracked) ─────────────────────────
# manual_queue.json is runtime state, not version-controlled (see .gitignore) —
# a fresh box, or this file right after being untracked, may not have one yet.


class TestMissingQueueFile:
    def test_load_queue_returns_empty_list_when_missing(self, tmp_path, monkeypatch):
        missing = tmp_path / "manual_queue.json"
        assert not missing.exists()
        monkeypatch.setattr(cron, "QUEUE_FILE", missing)
        assert cron.load_queue() == []

    def test_run_batch_self_heals_when_missing(self, tmp_path, monkeypatch):
        missing = tmp_path / "manual_queue.json"
        monkeypatch.setattr(cron, "QUEUE_FILE", missing)
        summary = cron.run_batch()
        assert summary["processed"] == []
        assert summary["stats"]["total"] == 0
        assert summary["stats"]["remaining"] == 0

    def test_status_sane_when_missing(self, tmp_path, monkeypatch, capsys):
        missing = tmp_path / "manual_queue.json"
        monkeypatch.setattr(cron, "QUEUE_FILE", missing)
        monkeypatch.setattr(sys, "argv", ["kb_growth_cron.py", "--status"])
        cron.main()
        stats = json.loads(capsys.readouterr().out)
        assert stats["total"] == 0
        assert stats["remaining"] == 0


# ─── batch processing (with mocked pipeline + dedup) ──────────────────────────


@pytest.fixture
def patch_io(monkeypatch):
    """Mock NeonDB dedup + Telegram + report so tests are pure."""
    monkeypatch.setattr(cron, "url_already_ingested", lambda url: False)
    monkeypatch.setattr(cron, "_tg_notify", lambda *a, **k: True)
    monkeypatch.setattr(cron, "_REPORT_AVAILABLE", False)
    return monkeypatch


class TestBatchProcessing:
    def test_batch_processes_multiple_entries(
        self, queue_file, make_entry, patch_io, monkeypatch
    ):
        queue = [make_entry(url=f"https://x/{i}.pdf") for i in range(7)]
        queue_file.write_text(json.dumps(queue))
        monkeypatch.setattr(cron, "BATCH_SIZE", 5)
        monkeypatch.setattr(
            cron, "run_pipeline",
            lambda entry: (True, "KB Chunks: 12 chunks created", 12),
        )

        summary = cron.run_batch()

        assert len(summary["processed"]) == 5
        post = json.loads(queue_file.read_text())
        assert sum(1 for e in post if e["status"] == "done") == 5
        assert sum(1 for e in post if e["status"] == "pending") == 2
        for e in post[:5]:
            assert e["chunks_inserted"] == 12

    def test_dedup_skips_existing_url(
        self, queue_file, make_entry, patch_io, monkeypatch
    ):
        queue_file.write_text(json.dumps([make_entry()]))
        monkeypatch.setattr(cron, "url_already_ingested", lambda url: True)
        called = {"n": 0}

        def fake_pipeline(entry):
            called["n"] += 1
            return True, "", 0

        monkeypatch.setattr(cron, "run_pipeline", fake_pipeline)
        cron.run_batch()

        assert called["n"] == 0  # pipeline never invoked
        post = json.loads(queue_file.read_text())
        assert post[0]["status"] == "skipped_dedup"

    def test_retryable_error_schedules_backoff(
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
        assert post["attempts"] == 1
        assert "next_retry_at" in post
        assert "504" in post["last_error"]

    def test_hard_error_no_retry(
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

    def test_max_attempts_promotes_to_hard_failed(
        self, queue_file, make_entry, patch_io, monkeypatch
    ):
        # An entry that has already failed MAX_ATTEMPTS - 1 times — one more
        # transient error should flip it to permanent failed.
        e = make_entry(
            status="pending",
            attempts=cron.MAX_ATTEMPTS - 1,
        )
        queue_file.write_text(json.dumps([e]))
        monkeypatch.setattr(
            cron, "run_pipeline",
            lambda entry: (False, "timeout", 0),
        )
        cron.run_batch()
        post = json.loads(queue_file.read_text())[0]
        assert post["status"] == "failed"
        assert post["attempts"] == cron.MAX_ATTEMPTS

    def test_success_clears_retry_state(
        self, queue_file, make_entry, patch_io, monkeypatch
    ):
        # An entry mid-retry that finally succeeds should drop next_retry_at.
        past = (cron._now() - timedelta(minutes=1)).isoformat(timespec="seconds")
        e = make_entry(
            status="failed_retryable",
            attempts=2,
            next_retry_at=past,
            last_error="timeout",
        )
        queue_file.write_text(json.dumps([e]))
        monkeypatch.setattr(
            cron, "run_pipeline",
            lambda entry: (True, "KB Chunks: 9 chunks created", 9),
        )
        cron.run_batch()
        post = json.loads(queue_file.read_text())[0]
        assert post["status"] == "done"
        assert "next_retry_at" not in post
        assert "last_error" not in post
        assert post["chunks_inserted"] == 9

    def test_milestones_fire_on_thresholds(
        self, queue_file, make_entry, patch_io, monkeypatch
    ):
        # Pre-load 99 done; one new success crosses the 100 milestone.
        done_entries = [make_entry(url=f"https://done/{i}", status="done")
                        for i in range(99)]
        pending = make_entry(url="https://x/100.pdf")
        queue_file.write_text(json.dumps(done_entries + [pending]))
        monkeypatch.setattr(
            cron, "run_pipeline",
            lambda entry: (True, "KB Chunks: 4 chunks created", 4),
        )
        sent: list[tuple] = []
        monkeypatch.setattr(
            cron, "_tg_notify",
            lambda *args, **kwargs: sent.append(args) or True,
        )

        summary = cron.run_batch()
        cron._emit_run_report(summary)

        assert any("100 manuals ingested" in a[1] for a in sent), \
            f"expected milestone message in {sent}"


# ─── pipeline output parsing ─────────────────────────────────────────────────


class TestRunPipelineParsing:
    """run_pipeline parses the chunk count from the report tail."""

    def test_parses_kb_chunks_line(self, monkeypatch, make_entry):
        fake = mock.Mock()
        fake.returncode = 0
        fake.stdout = (
            "INFO foo: bar\n"
            "═════════════\n"
            "INGEST PIPELINE REPORT\n"
            "═════════════\n"
            "PDF:          x.pdf (1.0 MB)\n"
            "Docling:      sync → 5,000 chars extracted\n"
            "KB Chunks:    23 chunks created (2000 char, 200 overlap)\n"
        )
        fake.stderr = ""
        monkeypatch.setattr(cron.subprocess, "run", lambda *a, **k: fake)

        ok, _, chunks = cron.run_pipeline(make_entry())
        assert ok is True
        assert chunks == 23

    def test_no_kb_chunks_line_returns_zero(self, monkeypatch, make_entry):
        fake = mock.Mock()
        fake.returncode = 0
        fake.stdout = "boring output\n"
        fake.stderr = ""
        monkeypatch.setattr(cron.subprocess, "run", lambda *a, **k: fake)

        ok, _, chunks = cron.run_pipeline(make_entry())
        assert ok is True
        assert chunks == 0


# ─── parse_iso ────────────────────────────────────────────────────────────────


class TestParseIso:
    def test_parses_ts_with_offset(self):
        s = "2026-05-06T12:34:56+00:00"
        assert cron._parse_iso(s) == datetime(2026, 5, 6, 12, 34, 56, tzinfo=timezone.utc)

    def test_invalid_returns_none(self):
        assert cron._parse_iso("not a date") is None

    def test_none_returns_none(self):
        assert cron._parse_iso(None) is None
