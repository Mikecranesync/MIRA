"""Tests for the manual-discovery fleet-status evidence tool.

CI-safe: pure file readers over synthetic fixtures, no network/DB/wall-clock in
the assertions (now_epoch is passed explicitly). Self-inserts mira-crawler/ on
sys.path (the crawler tests have no shared conftest)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

_CRAWLER = Path(__file__).resolve().parent.parent  # mira-crawler/
if str(_CRAWLER) not in sys.path:
    sys.path.insert(0, str(_CRAWLER))

import fleet_status as fs  # noqa: E402


# --- queue parsing ----------------------------------------------------------


def _write(p: Path, obj) -> Path:
    p.write_text(json.dumps(obj), encoding="utf-8")
    return p


def test_summarize_queue_counts_by_status(tmp_path):
    q = _write(
        tmp_path / "q.json",
        [
            {"status": "done", "done_at": "2026-07-06T01:00:00+00:00"},
            {"status": "done", "done_at": "2026-07-06T02:00:00+00:00"},
            {"status": "pending"},
            {"status": "failed"},
        ],
    )
    s = fs.summarize_queue(q)
    assert s["exists"] and s["total"] == 4
    assert s["counts_by_status"] == {"done": 2, "failed": 1, "pending": 1}
    assert s["newest_done_at"] == "2026-07-06T02:00:00+00:00"


def test_summarize_queue_missing_file_is_soft(tmp_path):
    s = fs.summarize_queue(tmp_path / "nope.json")
    assert s == {"exists": False, "path": str(tmp_path / "nope.json")}


def test_summarize_queue_malformed_does_not_crash(tmp_path):
    p = tmp_path / "bad.json"
    p.write_text("{ not json", encoding="utf-8")
    s = fs.summarize_queue(p)
    assert s["exists"] and "error" in s


# NOTE: the old `test_shipped_manual_queue_parses` was removed with #2531 —
# manual_queue.json is now runtime-only (untracked, gitignored), so there is no
# committed queue to parse. summarize_queue() parsing is covered by the synthetic
# tests above (counts_by_status / missing_file_is_soft / malformed).


# --- STOP_INGEST kill switch ------------------------------------------------


def test_stop_ingest_absent(tmp_path):
    assert fs.check_stop_ingest(tmp_path / "STOP_INGEST") == {"present": False}


def test_stop_ingest_auto_paused_by_guardrails(tmp_path):
    p = tmp_path / "STOP_INGEST"
    p.write_text(fs.STOP_SENTINEL + " disk>92%\n", encoding="utf-8")
    r = fs.check_stop_ingest(p)
    assert r["present"] and r["auto_paused"] is True


def test_stop_ingest_operator_set_has_no_sentinel(tmp_path):
    p = tmp_path / "STOP_INGEST"
    p.write_text("paused by mike\n", encoding="utf-8")
    r = fs.check_stop_ingest(p)
    assert r["present"] and r["auto_paused"] is False


# --- hunter dry-run vs live -------------------------------------------------


def test_hunter_defaults_to_dry_run():
    cfg = fs.hunter_config(env={})
    assert cfg["live"] is False and cfg["mode"] == "DRY-RUN" and cfg["max_new_per_run"] == 3


def test_hunter_live_when_flag_set():
    cfg = fs.hunter_config(env={"MIRA_AB_HUNTER_LIVE": "1", "AB_HUNTER_MAX_NEW": "5"})
    assert cfg["live"] is True and cfg["mode"] == "LIVE" and cfg["max_new_per_run"] == 5


# --- run report reader ------------------------------------------------------


def test_read_latest_run_report_picks_newest(tmp_path):
    d = tmp_path / "ab-hunter"
    d.mkdir()
    (d / "run-20260706T010000.json").write_text(
        json.dumps({"overall": "ok", "at": "early"}), encoding="utf-8"
    )
    (d / "run-20260706T090000.json").write_text(
        json.dumps({"overall": "ok", "at": "late"}), encoding="utf-8"
    )
    r = fs.read_latest_run_report(d)
    assert r["file"] == "run-20260706T090000.json"
    assert r["report"]["at"] == "late"


def test_read_latest_run_report_absent(tmp_path):
    assert fs.read_latest_run_report(tmp_path / "nope") is None


# --- judgments: no "firing" claim without a local artifact ------------------


def test_queue_fresh_is_firing():
    # Judged on the queue's OWN newest activity timestamp, not file mtime.
    q = {"exists": True, "newest_done_at": "2026-07-06T00:00:00+00:00"}
    now = fs._iso_to_epoch("2026-07-06T00:30:00+00:00")  # 30 min later
    j = fs.judge_queue(q, now_epoch=now)
    assert j["verdict"] == fs.BUILT_AND_FIRING


def test_queue_stale_needs_proof():
    q = {"exists": True, "newest_done_at": "2026-04-29T01:00:00+00:00"}
    now = fs._iso_to_epoch("2026-07-06T00:00:00+00:00")  # months later
    j = fs.judge_queue(q, now_epoch=now)
    assert j["verdict"] == fs.BUILT_NEEDS_RUNTIME_PROOF


def test_queue_present_but_no_activity_needs_proof():
    j = fs.judge_queue({"exists": True, "counts_by_status": {"pending": 5}}, now_epoch=1_000_000)
    assert j["verdict"] == fs.BUILT_NEEDS_RUNTIME_PROOF


def test_queue_absent_is_unknown():
    j = fs.judge_queue({"exists": False}, now_epoch=1000)
    assert j["verdict"] == fs.UNKNOWN_NEEDS_OPERATOR


def test_hunter_dry_run_verdict():
    j = fs.judge_hunter({"live": False}, None)
    assert j["verdict"] == fs.BUILT_DRY_RUN_ONLY


def test_hunter_live_without_report_is_unknown():
    j = fs.judge_hunter({"live": True}, None)
    assert j["verdict"] == fs.UNKNOWN_NEEDS_OPERATOR


# --- report assembly + rendering never crash --------------------------------


def test_build_and_render_report_smoke(tmp_path):
    report = fs.build_report(
        queue=fs.summarize_queue(tmp_path / "none.json"),
        latest_run=None,
        guardrails=None,
        stop={"present": False},
        hunter=fs.hunter_config(env={}),
        now_epoch=1000,
    )
    text = fs.render_text(report)
    assert "FLEET STATUS" in text
    assert fs.UNKNOWN_NEEDS_OPERATOR in report["kb_growth_queue"]["verdict"]


def test_operator_commands_include_offbox_sources():
    cmds = fs.operator_commands()
    for token in [
        "ab-hunter",
        "kb_growth_cron.py --status",
        "mira:rss:seen_guids",
        "8003/health",
        "proj_mira-ingest",
    ]:
        assert token in cmds
