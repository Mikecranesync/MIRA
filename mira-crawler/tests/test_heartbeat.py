"""Tests for the append-only per-job heartbeat recorder.

CI-safe: stdlib-only import, synthetic tmp logs, no wall-clock in assertions
(``now`` is injected). Mirrors the ``metrics/latency.py`` discipline — the
heartbeat is the SAME kind of append-only JSONL evidence, one row per job run,
so ``health.py`` can answer "did this job actually fire, and did it succeed?"
rather than the old "registration != success" healthcheck.

Self-inserts mira-crawler/ on sys.path."""

from __future__ import annotations

import json
import sys
from pathlib import Path

_CRAWLER = Path(__file__).resolve().parent.parent  # mira-crawler/
if str(_CRAWLER) not in sys.path:
    sys.path.insert(0, str(_CRAWLER))

from metrics import heartbeat as hb  # noqa: E402


# --- classification of crawl stats -----------------------------------------


def test_zero_urls_discovered_is_healthy_no_new():
    # Phase 0: manufacturer/curriculum crawls routinely discover 0 URLs
    # (sources exhausted / gated). That is HEALTHY, not a failure.
    stats = {"total_urls": 0, "fetched": 0, "skipped": 0, "stored_chunks": 0, "errors": 0}
    assert hb.classify_crawl_stats(stats) == hb.STATUS_NO_NEW


def test_stored_chunks_means_ok():
    stats = {"total_urls": 5, "fetched": 5, "skipped": 0, "stored_chunks": 12, "errors": 0}
    assert hb.classify_crawl_stats(stats) == hb.STATUS_OK


def test_all_discovered_urls_errored_is_failed():
    # discovered work but stored nothing and every URL errored → real failure
    stats = {"total_urls": 3, "fetched": 0, "skipped": 0, "stored_chunks": 0, "errors": 3}
    assert hb.classify_crawl_stats(stats) == hb.STATUS_FAILED


def test_fetched_but_all_deduped_is_no_new():
    # fetched pages, but every one was already indexed (skipped), nothing stored
    stats = {"total_urls": 4, "fetched": 0, "skipped": 4, "stored_chunks": 0, "errors": 0}
    assert hb.classify_crawl_stats(stats) == hb.STATUS_NO_NEW


def test_non_dict_stats_defaults_to_ok():
    # jobs that don't return crawl stats (report) but completed without raising
    assert hb.classify_crawl_stats(None) == hb.STATUS_OK


# --- recording --------------------------------------------------------------


def test_record_job_appends_one_json_line(tmp_path):
    log = tmp_path / "hb.jsonl"
    hb.record_job("crawl_abb", hb.STATUS_NO_NEW, log_path=log, now=1_700_000_000.0)
    lines = log.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    row = json.loads(lines[0])
    assert row["job_id"] == "crawl_abb"
    assert row["status"] == hb.STATUS_NO_NEW
    assert row["epoch"] == 1_700_000_000
    assert row["schema_version"] == 1
    assert "ts" in row


def test_record_job_is_append_only(tmp_path):
    log = tmp_path / "hb.jsonl"
    hb.record_job("crawl_abb", hb.STATUS_OK, log_path=log, now=1.0)
    hb.record_job("crawl_abb", hb.STATUS_FAILED, log_path=log, now=2.0)
    assert len(log.read_text().strip().splitlines()) == 2


def test_record_job_carries_detail(tmp_path):
    log = tmp_path / "hb.jsonl"
    stats = {"total_urls": 5, "stored_chunks": 3, "errors": 0}
    hb.record_job("crawl_abb", hb.STATUS_OK, detail=stats, log_path=log, now=1.0)
    row = json.loads(log.read_text().strip())
    assert row["detail"]["stored_chunks"] == 3


# --- reading (fail-soft) ----------------------------------------------------


def test_read_records_missing_file_returns_empty(tmp_path):
    assert hb.read_records(tmp_path / "nope.jsonl") == []


def test_read_records_skips_malformed_lines(tmp_path):
    log = tmp_path / "hb.jsonl"
    log.write_text(
        '{"job_id":"crawl_abb","status":"ok","epoch":1}\n'
        "{ this is not json\n"
        '{"job_id":"crawl_fanuc","status":"failed","epoch":2}\n',
        encoding="utf-8",
    )
    records = hb.read_records(log)
    assert [r["job_id"] for r in records] == ["crawl_abb", "crawl_fanuc"]


def test_default_log_path_is_absolute_and_not_cwd_doubled(monkeypatch, tmp_path):
    # The daemon runs with cwd = mira-crawler/ (run.sh does `cd $SCRIPT_DIR`) and
    # does NOT export MIRA_JOB_HEARTBEAT_LOG. A cwd-relative default like
    # "mira-crawler/data/..." would resolve to mira-crawler/mira-crawler/data/...
    # (doubled) — the daemon would write there while the watchdog reads the real
    # data/, so health would forever report no_evidence_yet. The default MUST be
    # absolute, resolved from the module location, cwd-independent.
    monkeypatch.delenv("MIRA_JOB_HEARTBEAT_LOG", raising=False)
    monkeypatch.chdir(tmp_path)
    p = hb._default_log_path()
    assert p.is_absolute()
    assert "mira-crawler/mira-crawler" not in str(p)
    assert str(tmp_path) not in str(p)
    assert p == Path(hb.__file__).resolve().parent.parent / "data" / "job_heartbeat.jsonl"


def test_env_override_still_wins_over_the_absolute_default(monkeypatch, tmp_path):
    override = tmp_path / "custom" / "hb.jsonl"
    monkeypatch.setenv("MIRA_JOB_HEARTBEAT_LOG", str(override))
    assert hb._default_log_path() == override


def test_latest_by_job_keeps_the_newest_row_per_job(tmp_path):
    log = tmp_path / "hb.jsonl"
    hb.record_job("crawl_abb", hb.STATUS_OK, log_path=log, now=1.0)
    hb.record_job("crawl_fanuc", hb.STATUS_NO_NEW, log_path=log, now=2.0)
    hb.record_job("crawl_abb", hb.STATUS_FAILED, log_path=log, now=3.0)
    latest = hb.latest_by_job(hb.read_records(log))
    assert latest["crawl_abb"]["status"] == hb.STATUS_FAILED
    assert latest["crawl_abb"]["epoch"] == 3
    assert latest["crawl_fanuc"]["status"] == hb.STATUS_NO_NEW
