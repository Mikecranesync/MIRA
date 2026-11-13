"""Mission control v2 (#4737): the SQLite store — idempotent events, upserted reports."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

MC = Path(__file__).resolve().parents[1] / "tools" / "mission-control"


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


store = _load("mission_control_store", MC / "store.py")


def event(delivery_id="d1", source="webhook", **over):
    row = {
        "delivery_id": delivery_id,
        "source": source,
        "kind": "pull_request",
        "repo": "o/r",
        "number": 12,
        "actor": "someone",
        "action": "opened",
        "head_sha": "0123456789abcdef0123456789abcdef01234567",
        "url": "https://github.com/o/r/pull/12",
        "received_at": "2026-11-12T23:00:00Z",
        "payload": {"a": 1},
    }
    row.update(over)
    return row


def report(comment_id=1, updated_at="2026-11-12T23:00:00Z", **over):
    row = {
        "id": comment_id,
        "lane": "BRAVO-CLAUDE",
        "author": "owner",
        "trusted": 1,
        "updated_at": updated_at,
        "url": "https://github.com/o/r/issues/5232#issuecomment-1",
        "raw": "[DELIVERY-UPDATE: BRAVO-CLAUDE]\nUpdated: x\n",
        "parsed": {"state": "ACTIVE", "items": [1]},
    }
    row.update(over)
    return row


def test_store_opens_in_wal_mode_at_the_given_path(tmp_path):
    s = store.Store(tmp_path / "mc.sqlite")
    assert (tmp_path / "mc.sqlite").exists()
    assert s.journal_mode() == "wal"


def test_duplicate_delivery_id_is_a_no_op(tmp_path):
    s = store.Store(tmp_path / "mc.sqlite")
    assert s.add_event(event()) is True
    assert s.add_event(event(action="closed")) is False  # same delivery id, ignored
    rows = s.events()
    assert len(rows) == 1 and rows[0]["action"] == "opened"


def test_events_come_back_newest_first_with_payload_decoded(tmp_path):
    s = store.Store(tmp_path / "mc.sqlite")
    s.add_event(event("a", received_at="2026-11-12T22:00:00Z"))
    s.add_event(event("b", received_at="2026-11-12T23:00:00Z", source="poll"))
    rows = s.events(limit=5)
    assert [r["delivery_id"] for r in rows] == ["b", "a"]
    assert rows[0]["payload"] == {"a": 1} and rows[0]["source"] == "poll"


def test_report_upsert_replaces_an_edited_comment_by_id(tmp_path):
    s = store.Store(tmp_path / "mc.sqlite")
    s.put_report(report(1, "2026-11-12T22:00:00Z"))
    s.put_report(report(1, "2026-11-12T23:00:00Z", parsed={"state": "BLOCKED", "items": []}))
    rows = s.reports()
    assert len(rows) == 1
    assert rows[0]["updated_at"] == "2026-11-12T23:00:00Z"
    assert rows[0]["parsed"]["state"] == "BLOCKED"


def test_reports_keep_one_row_per_comment_across_lanes(tmp_path):
    s = store.Store(tmp_path / "mc.sqlite")
    s.put_report(report(1, lane="BRAVO-CLAUDE"))
    s.put_report(report(2, lane="CHARLIE-CODEX", trusted=0))
    rows = {r["lane"]: r for r in s.reports()}
    assert set(rows) == {"BRAVO-CLAUDE", "CHARLIE-CODEX"}
    assert rows["CHARLIE-CODEX"]["trusted"] == 0 and rows["BRAVO-CLAUDE"]["trusted"] == 1


def test_env_version_is_one_row_per_environment(tmp_path):
    s = store.Store(tmp_path / "mc.sqlite")
    s.put_env("production", {"git_sha": "aaa", "built_at": "t1", "ok": 1, "fetched_at": "f1"})
    s.put_env("production", {"git_sha": "bbb", "built_at": "t2", "ok": 1, "fetched_at": "f2"})
    s.put_env("staging", {"git_sha": None, "built_at": None, "ok": 0, "fetched_at": "f2"})
    envs = s.envs()
    assert envs["production"]["git_sha"] == "bbb"
    assert envs["staging"]["ok"] == 0 and envs["staging"]["git_sha"] is None


def test_counts_reflect_rows(tmp_path):
    s = store.Store(tmp_path / "mc.sqlite")
    assert s.counts() == {"events": 0, "reports": 0}
    s.add_event(event())
    s.put_report(report())
    assert s.counts() == {"events": 1, "reports": 1}


# --- Codex round 1 (PR #5455) findings -------------------------------------------------


def test_an_older_report_version_never_overwrites_a_newer_one(tmp_path):  # F5
    s = store.Store(tmp_path / "mc.sqlite")
    assert s.put_report(report(1, "2026-11-12T23:00:00Z", parsed={"state": "BLOCKED"})) is True
    assert s.put_report(report(1, "2026-11-12T22:00:00Z", parsed={"state": "COMPLETE"})) is False
    assert s.reports()[0]["parsed"]["state"] == "BLOCKED"
    assert s.put_report(report(1, "2026-11-12T23:30:00Z", parsed={"state": "COMPLETE"})) is True


def test_deleted_reports_are_tombstoned_against_late_deliveries(tmp_path):  # F9
    s = store.Store(tmp_path / "mc.sqlite")
    s.put_report(report(1))
    s.delete_report(1, permanent=True)  # the comment itself is gone
    assert s.reports() == []
    assert s.put_report(report(1, "2026-11-12T23:59:00Z")) is False  # a replay cannot resurrect it
    assert s.reports() == []
    assert s.put_report(report(2)) is True  # control: a new comment id is unaffected


# --- Codex round 2 (PR #5455) F10: withdrawals are versioned; only deletions are final --------


def test_a_withdrawn_report_comes_back_when_the_comment_is_edited_newer(tmp_path):
    s = store.Store(tmp_path / "mc.sqlite")
    s.put_report(report(1, "2026-11-12T22:00:00Z"))
    s.delete_report(1, after="2026-11-12T23:00:00Z")  # marker edited away at 23:00
    assert s.put_report(report(1, "2026-11-12T22:30:00Z")) is False  # older than the withdrawal
    assert s.put_report(report(1, "2026-11-12T23:30:00Z")) is True  # restored later: accepted
    assert s.reports()[0]["updated_at"] == "2026-11-12T23:30:00Z"


def test_a_deleted_comment_is_final_whatever_arrives_later(tmp_path):
    s = store.Store(tmp_path / "mc.sqlite")
    s.put_report(report(1))
    s.delete_report(1, permanent=True)
    assert s.put_report(report(1, "2099-01-01T00:00:00Z")) is False
