"""Ties the running scheduler to the job registry.

``main._setup_scheduler`` must register EXACTLY the jobs in ``job_registry`` —
same ids, same trigger kinds — so the schedule that fires and the schedule
``health.py`` judges can never drift apart.

This test imports ``main`` (which top-level-imports docling/apscheduler). Those
heavy deps are present in the crawler's own venv but NOT on the minimal-deps CI
job, so the test SKIPS cleanly when they're missing — the CI-safe
``test_job_registry`` already pins the nine ids independently. It never starts
the scheduler, so no crawl or network runs.

Self-inserts mira-crawler/ on sys.path."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_CRAWLER = Path(__file__).resolve().parent.parent  # mira-crawler/
if str(_CRAWLER) not in sys.path:
    sys.path.insert(0, str(_CRAWLER))

import job_registry as jr  # noqa: E402

try:
    import main  # noqa: E402  (heavy imports: docling/apscheduler)
    from config import CrawlerConfig  # noqa: E402

    _IMPORT_ERROR: str | None = None
except Exception as exc:  # pragma: no cover - env-dependent
    main = None  # type: ignore[assignment]
    CrawlerConfig = None  # type: ignore[assignment,misc]
    _IMPORT_ERROR = f"{type(exc).__name__}: {exc}"

pytestmark = pytest.mark.skipif(
    _IMPORT_ERROR is not None,
    reason=f"crawler runtime deps not installed here ({_IMPORT_ERROR})",
)


def _build_scheduler():
    # schedule_enabled default is env-driven; _setup_scheduler builds jobs
    # regardless. Never .start() — construction only, no crawl, no network.
    return main._setup_scheduler(CrawlerConfig())


def test_scheduler_registers_exactly_the_registry_ids():
    # never .start()ed, so no shutdown needed (no threads spawned)
    scheduler = _build_scheduler()
    registered = {job.id for job in scheduler.get_jobs()}
    assert registered == set(jr.job_ids())


def test_scheduler_registers_nine_jobs():
    scheduler = _build_scheduler()
    assert len(scheduler.get_jobs()) == 9


def test_every_registered_job_carries_a_registry_name():
    scheduler = _build_scheduler()
    names = {job.id: job.name for job in scheduler.get_jobs()}
    for spec in jr.JOBS:
        assert names[spec.id] == spec.name


# --- heartbeat emission (the new behaviour) ---------------------------------


def _read_hb(log_path):
    import json

    return [json.loads(line) for line in Path(log_path).read_text().splitlines() if line.strip()]


def test_manufacturer_job_emits_no_new_heartbeat_when_nothing_discovered(tmp_path, monkeypatch):
    monkeypatch.setenv("MIRA_JOB_HEARTBEAT_LOG", str(tmp_path / "hb.jsonl"))
    monkeypatch.setattr(
        main,
        "_run_manufacturer_crawl",
        lambda config, mfrs: {"total_urls": 0, "stored_chunks": 0, "errors": 0, "fetched": 0},
    )
    spec = jr.get("crawl_abb")
    main._run_registered_job(CrawlerConfig(), spec)
    rows = _read_hb(tmp_path / "hb.jsonl")
    assert len(rows) == 1
    assert rows[0]["job_id"] == "crawl_abb"
    assert rows[0]["status"] == "no_new"


def test_manufacturer_job_emits_ok_heartbeat_when_chunks_stored(tmp_path, monkeypatch):
    monkeypatch.setenv("MIRA_JOB_HEARTBEAT_LOG", str(tmp_path / "hb.jsonl"))
    monkeypatch.setattr(
        main,
        "_run_manufacturer_crawl",
        lambda config, mfrs: {"total_urls": 2, "stored_chunks": 7, "errors": 0, "fetched": 2},
    )
    main._run_registered_job(CrawlerConfig(), jr.get("crawl_siemens"))
    rows = _read_hb(tmp_path / "hb.jsonl")
    assert rows[0]["status"] == "ok"
    assert rows[0]["detail"]["stored_chunks"] == 7


def test_job_that_raises_emits_failed_heartbeat_and_reraises(tmp_path, monkeypatch):
    monkeypatch.setenv("MIRA_JOB_HEARTBEAT_LOG", str(tmp_path / "hb.jsonl"))

    def _boom(config, mfrs):
        raise RuntimeError("crawl exploded")

    monkeypatch.setattr(main, "_run_manufacturer_crawl", _boom)
    with pytest.raises(RuntimeError, match="crawl exploded"):
        main._run_registered_job(CrawlerConfig(), jr.get("crawl_kuka"))
    rows = _read_hb(tmp_path / "hb.jsonl")
    assert rows[0]["status"] == "failed"
    assert "crawl exploded" in rows[0]["detail"]["error"]


def test_healthcheck_job_emits_ok_when_config_loads(tmp_path, monkeypatch):
    monkeypatch.setenv("MIRA_JOB_HEARTBEAT_LOG", str(tmp_path / "hb.jsonl"))
    monkeypatch.setattr(main, "healthcheck", lambda: True)
    main._run_registered_job(CrawlerConfig(), jr.get("healthcheck"))
    rows = _read_hb(tmp_path / "hb.jsonl")
    assert rows[0]["job_id"] == "healthcheck"
    assert rows[0]["status"] == "ok"


def test_healthcheck_job_emits_failed_when_config_broken(tmp_path, monkeypatch):
    monkeypatch.setenv("MIRA_JOB_HEARTBEAT_LOG", str(tmp_path / "hb.jsonl"))
    monkeypatch.setattr(main, "healthcheck", lambda: False)
    main._run_registered_job(CrawlerConfig(), jr.get("healthcheck"))
    rows = _read_hb(tmp_path / "hb.jsonl")
    assert rows[0]["status"] == "failed"
