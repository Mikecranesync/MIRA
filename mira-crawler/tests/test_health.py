"""Tests for the crawler ``health`` CLI (read side of the heartbeat evidence).

CI-safe: imports ``health`` which imports only ``job_registry`` +
``metrics.heartbeat`` (stdlib-only) — never ``main``/docling/apscheduler. All
judgments take an injected ``now_epoch`` so there is no wall-clock in the
assertions.

The three behaviours the task demands are pinned here:
* cold start (no heartbeats) → "no evidence yet", NEVER "unhealthy", exit 0;
* ran-0-new is healthy, distinct from failed and from never-started;
* the 30-minute healthcheck going silent is the daemon-dead signal.

Self-inserts mira-crawler/ on sys.path."""

from __future__ import annotations

import json
import sys
from pathlib import Path

_CRAWLER = Path(__file__).resolve().parent.parent  # mira-crawler/
if str(_CRAWLER) not in sys.path:
    sys.path.insert(0, str(_CRAWLER))

import health  # noqa: E402
import job_registry as jr  # noqa: E402
from metrics import heartbeat as hb  # noqa: E402

_NOW = 1_700_000_000  # fixed reference epoch


# --- per-job judgment -------------------------------------------------------


def test_never_recorded_job_is_never_ran_not_failed():
    spec = jr.get("crawl_abb")
    v = health.judge_job(spec, None, now_epoch=_NOW)
    assert v["verdict"] == health.NEVER_RAN


def test_recent_no_new_run_is_healthy_no_new():
    spec = jr.get("crawl_abb")
    latest = {"status": hb.STATUS_NO_NEW, "epoch": _NOW - 60}
    v = health.judge_job(spec, latest, now_epoch=_NOW)
    assert v["verdict"] == health.HEALTHY_NO_NEW


def test_recent_ok_run_is_healthy():
    spec = jr.get("crawl_abb")
    latest = {"status": hb.STATUS_OK, "epoch": _NOW - 60}
    v = health.judge_job(spec, latest, now_epoch=_NOW)
    assert v["verdict"] == health.HEALTHY


def test_failed_run_is_failed_regardless_of_recency():
    spec = jr.get("crawl_abb")
    latest = {"status": hb.STATUS_FAILED, "epoch": _NOW - 5}
    v = health.judge_job(spec, latest, now_epoch=_NOW)
    assert v["verdict"] == health.FAILED


def test_daily_job_silent_beyond_stale_window_is_stale():
    spec = jr.get("crawl_abb")  # stale_after = 2 days
    latest = {"status": hb.STATUS_NO_NEW, "epoch": _NOW - (3 * 86_400)}
    v = health.judge_job(spec, latest, now_epoch=_NOW)
    assert v["verdict"] == health.STALE


def test_weekly_report_silent_four_days_is_still_healthy():
    # a weekly job silent for less than its 9-day stale window is NOT stale
    spec = jr.get("generate_report")
    latest = {"status": hb.STATUS_OK, "epoch": _NOW - (4 * 86_400)}
    v = health.judge_job(spec, latest, now_epoch=_NOW)
    assert v["verdict"] == health.HEALTHY


def test_healthcheck_silent_40_minutes_is_stale_daemon_dead():
    spec = jr.get("healthcheck")  # stale_after = 40 min
    latest = {"status": hb.STATUS_OK, "epoch": _NOW - (41 * 60)}
    v = health.judge_job(spec, latest, now_epoch=_NOW)
    assert v["verdict"] == health.STALE


# --- overall roll-up --------------------------------------------------------


def test_cold_start_no_heartbeats_is_no_evidence_yet_not_unhealthy():
    report = health.build_health([], now_epoch=_NOW)
    assert report["overall"] == health.NO_EVIDENCE_YET
    # every job present and judged NEVER_RAN — nothing reported as failed/unhealthy
    assert set(report["jobs"]) == set(jr.job_ids())
    assert all(j["verdict"] == health.NEVER_RAN for j in report["jobs"].values())
    assert health.exit_code(report) == 0


def test_all_jobs_recently_ok_is_healthy():
    records = [
        {"job_id": jid, "status": hb.STATUS_OK, "epoch": _NOW - 60} for jid in jr.job_ids()
    ]
    report = health.build_health(records, now_epoch=_NOW)
    assert report["overall"] == health.HEALTHY
    assert health.exit_code(report) == 0


def test_one_failed_job_makes_overall_degraded():
    records = [
        {"job_id": jid, "status": hb.STATUS_OK, "epoch": _NOW - 60} for jid in jr.job_ids()
    ]
    records.append({"job_id": "crawl_abb", "status": hb.STATUS_FAILED, "epoch": _NOW - 30})
    report = health.build_health(records, now_epoch=_NOW)
    assert report["overall"] == health.DEGRADED
    assert report["jobs"]["crawl_abb"]["verdict"] == health.FAILED
    assert health.exit_code(report) == 1


def test_stale_healthcheck_makes_overall_degraded():
    records = [
        {"job_id": jid, "status": hb.STATUS_OK, "epoch": _NOW - 60}
        for jid in jr.job_ids()
        if jid != "healthcheck"
    ]
    records.append({"job_id": "healthcheck", "status": hb.STATUS_OK, "epoch": _NOW - (2 * 3600)})
    report = health.build_health(records, now_epoch=_NOW)
    assert report["overall"] == health.DEGRADED
    assert health.exit_code(report) == 1


def test_never_ran_weekly_job_does_not_degrade_overall():
    # a fresh deploy where dailies + healthcheck have run but the weekly report
    # simply hasn't come due yet is HEALTHY, not degraded
    records = [
        {"job_id": jid, "status": hb.STATUS_OK, "epoch": _NOW - 60}
        for jid in jr.job_ids()
        if jid != "generate_report"
    ]
    report = health.build_health(records, now_epoch=_NOW)
    assert report["jobs"]["generate_report"]["verdict"] == health.NEVER_RAN
    assert report["overall"] == health.HEALTHY


# --- CLI --------------------------------------------------------------------


def test_cli_json_on_cold_start_exits_zero(tmp_path, capsys):
    missing = tmp_path / "no_heartbeats.jsonl"
    rc = health.main(["--json", "--heartbeat-log", str(missing), "--now", str(_NOW)])
    out = json.loads(capsys.readouterr().out)
    assert rc == 0
    assert out["overall"] == health.NO_EVIDENCE_YET


def test_cli_reports_failed_job_and_exits_one(tmp_path, capsys):
    log = tmp_path / "hb.jsonl"
    for jid in jr.job_ids():
        hb.record_job(jid, hb.STATUS_OK, log_path=log, now=_NOW - 60)
    hb.record_job("crawl_siemens", hb.STATUS_FAILED, log_path=log, now=_NOW - 10)
    rc = health.main(["--json", "--heartbeat-log", str(log), "--now", str(_NOW)])
    out = json.loads(capsys.readouterr().out)
    assert rc == 1
    assert out["overall"] == health.DEGRADED
    assert out["jobs"]["crawl_siemens"]["verdict"] == health.FAILED
