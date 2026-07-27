"""Tests for the dependency-free crawler job registry.

CI-safe: imports ONLY ``job_registry`` (stdlib-only) — never ``main`` (which
top-level-imports docling/apscheduler and would error at collection on the
minimal-deps CI job). The registry is the single source of truth both
``main._setup_scheduler`` (writes the schedule) and ``health.py`` (judges the
schedule) consume, so this test pins the shape that ties them together.

Self-inserts mira-crawler/ on sys.path (the crawler tests have no shared
conftest that guarantees it)."""

from __future__ import annotations

import sys
from pathlib import Path

_CRAWLER = Path(__file__).resolve().parent.parent  # mira-crawler/
if str(_CRAWLER) not in sys.path:
    sys.path.insert(0, str(_CRAWLER))

import job_registry as jr  # noqa: E402

# The nine jobs Phase 0 verified live (docs/ops/2026-07-27-crawler-runtime-hardening-phase0.md).
EXPECTED_IDS = {
    "crawl_abb",
    "crawl_fanuc",
    "crawl_kuka",
    "crawl_siemens",
    "crawl_rockwell",
    "crawl_automationdirect",
    "crawl_curriculum",
    "generate_report",
    "healthcheck",
}


def test_registry_defines_exactly_nine_jobs():
    assert len(jr.JOBS) == 9


def test_registry_ids_match_the_live_nine():
    assert set(jr.job_ids()) == EXPECTED_IDS


def test_job_ids_are_unique():
    ids = jr.job_ids()
    assert len(ids) == len(set(ids))


def test_six_manufacturer_crawls_each_carry_their_own_name_arg():
    mfr_jobs = [j for j in jr.JOBS if j.kind == "manufacturer"]
    assert len(mfr_jobs) == 6
    for j in mfr_jobs:
        assert j.target == "manufacturer_crawl"
        # one manufacturer name per job, so a heartbeat can be attributed
        assert len(j.args) == 1 and isinstance(j.args[0], str)
        assert j.id == f"crawl_{j.args[0]}"


def test_manufacturer_crawls_are_daily_cron_jobs():
    for j in (j for j in jr.JOBS if j.kind == "manufacturer"):
        assert j.trigger_type == "cron"
        assert "hour" in j.trigger_kwargs and "minute" in j.trigger_kwargs
        assert "day_of_week" not in j.trigger_kwargs  # daily, not weekly


def test_curriculum_and_report_are_weekly_cron_jobs():
    curriculum = jr.get("crawl_curriculum")
    report = jr.get("generate_report")
    assert curriculum.kind == "curriculum" and curriculum.target == "curriculum_crawl"
    assert report.kind == "report" and report.target == "report"
    for j in (curriculum, report):
        assert j.trigger_type == "cron"
        assert j.trigger_kwargs.get("day_of_week") in ("sun", "mon")


def test_healthcheck_is_a_30_minute_interval_job():
    hc = jr.get("healthcheck")
    assert hc.kind == "healthcheck" and hc.target == "healthcheck"
    assert hc.trigger_type == "interval"
    assert hc.trigger_kwargs == {"minutes": 30}


def test_every_job_has_a_positive_cadence_and_larger_stale_window():
    # health.py judges staleness against these; stale_after must exceed cadence
    # so a job that merely ran on time is never wrongly flagged stale.
    for j in jr.JOBS:
        assert j.cadence_seconds > 0
        assert j.stale_after_seconds > j.cadence_seconds


def test_healthcheck_is_the_tightest_liveness_sentinel():
    # The 30-min healthcheck is the daemon-liveness sentinel — its stale window
    # must be far tighter than any crawl job so a dead scheduler is caught in
    # under an hour, not days.
    hc = jr.get("healthcheck")
    crawl_windows = [j.stale_after_seconds for j in jr.JOBS if j.kind != "healthcheck"]
    assert hc.stale_after_seconds < min(crawl_windows)
    assert hc.stale_after_seconds <= 3600  # caught within the hour


def test_get_unknown_job_raises_keyerror():
    try:
        jr.get("no_such_job")
    except KeyError:
        return
    raise AssertionError("expected KeyError for unknown job id")
