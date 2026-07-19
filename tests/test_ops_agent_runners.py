"""Tests for the container ops-agent runners.

These runners are scheduled via ``scripts/install_crons.sh`` and execute inside
the Telegram bot container. The tests stay on pure message/query/ledger behavior;
Telegram sends and live DB reads are integration-only.
"""

from __future__ import annotations

import importlib.util
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

_AGENTS = Path(__file__).resolve().parents[1] / "mira-bots" / "agents"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, _AGENTS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


pm = _load("pm_escalation_runner")
sa = _load("safety_alert_runner")
mb = _load("morning_brief_runner")
ledger = _load("runner_ledger")


# -- pm_escalation ---------------------------------------------------------


def test_pm_empty_is_all_clear():
    assert pm.build_message([]) == "OK: No PMs due right now."


def test_pm_source_error_is_not_all_clear():
    msg = pm.build_message([], source_error="get_due_pms failed: timeout")
    assert "Unable to inspect PM schedule" in msg
    assert "timeout" in msg
    assert "No PMs due" not in msg


def test_pm_lists_and_counts_critical():
    pms = [
        {
            "manufacturer": "Allen-Bradley",
            "model_number": "PowerFlex 525",
            "task": "Inspect DC bus",
            "criticality": "critical",
            "next_due_at": None,
            "trigger_type": "calendar",
        },
        {
            "manufacturer": "SEW",
            "model_number": "",
            "task": "Grease bearings",
            "criticality": "medium",
            "next_due_at": None,
            "trigger_type": "calendar",
        },
    ]
    msg = pm.build_message(pms)
    assert "2 PMs due" in msg
    assert "1 critical" in msg
    assert "CRITICAL" in msg
    assert "PowerFlex 525" in msg and "Grease bearings" in msg


def test_pm_truncates_and_counts_remainder():
    pms = [{"task": f"t{i}", "criticality": "low", "next_due_at": None} for i in range(15)]
    msg = pm.build_message(pms, max_list=10)
    assert "...and 5 more" in msg
    assert msg.count("- ") == 10


def test_pm_overdue_days():
    past = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    assert pm._overdue_days(past) == 3
    assert pm._overdue_days(None) is None
    future = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
    assert pm._overdue_days(future) == 0


def test_pm_due_label_meter_trigger():
    label = pm._due_label(
        {"next_due_at": None, "trigger_type": "meter", "meter_threshold": 500, "meter_current": 620}
    )
    assert label == "meter 620/500"


# -- safety_alert ----------------------------------------------------------


def test_safety_empty_is_all_clear():
    assert sa.build_message([], 24) == "OK: Checked interactions; no safety events in the last 24h."


def test_safety_source_error_is_not_all_clear():
    msg = sa.build_message([], 24, source_error="DB not found at /data/mira.db")
    assert "Unable to inspect safety events" in msg
    assert "/data/mira.db" in msg
    assert "No safety events" not in msg


def test_safety_counts_events_and_techs():
    events = [
        {"chat_id": "111222", "intent": "safety", "created_at": "2026-07-09T09:15:00"},
        {"chat_id": "111222", "intent": "safety", "created_at": "2026-07-09T08:00:00"},
        {"chat_id": "333444", "fsm_state": "SAFETY_ALERT", "created_at": "2026-07-09T07:00:00"},
    ]
    msg = sa.build_message(events, 24)
    assert "3 safety events" in msg
    assert "2 techs" in msg
    assert "Review in CMMS" in msg


def test_safety_truncates():
    events = [{"chat_id": str(i), "created_at": "2026-07-09T09:00:00"} for i in range(12)]
    msg = sa.build_message(events, 24, max_list=8)
    assert "...and 4 more" in msg


def test_safety_sqlite_current_timestamp_rows_are_in_window():
    db = sqlite3.connect(":memory:")
    db.execute(
        "CREATE TABLE interactions (chat_id TEXT, intent TEXT, fsm_state TEXT, created_at TEXT)"
    )
    db.executemany(
        "INSERT INTO interactions VALUES (?, ?, ?, ?)",
        [
            ("111222", "safety", "", "2026-07-19 11:00:00"),
            ("333444", "", "SAFETY_ALERT", "2026-07-19T10:30:00+00:00"),
            ("999999", "safety", "", "2026-07-18 00:00:00"),
        ],
    )
    events, err = sa.inspect_safety_events(
        db, 2, now=datetime(2026, 7, 19, 12, 0, tzinfo=timezone.utc)
    )
    assert err is None
    assert [e["chat_id"] for e in events] == ["111222", "333444"]


def test_both_resolve_alert_channel_first():
    for mod in (pm, sa):
        src = (_AGENTS / f"{mod.__name__}.py").read_text()
        assert "TELEGRAM_ALERT_BOT_TOKEN" in src
        assert src.index("TELEGRAM_ALERT_BOT_TOKEN") < src.index('TELEGRAM_BOT_TOKEN", ""')


# -- morning_brief ---------------------------------------------------------


def test_morning_brief_counts_distinct_sessions_and_sqlite_timestamps():
    db = sqlite3.connect(":memory:")
    db.execute(
        "CREATE TABLE interactions (chat_id TEXT, intent TEXT, fsm_state TEXT, created_at TEXT)"
    )
    db.executemany(
        "INSERT INTO interactions VALUES (?, ?, ?, ?)",
        [
            ("chat-a", "safety", "", "2026-07-19 11:00:00"),
            ("chat-a", "", "WORK_ORDER_OPEN", "2026-07-19T10:45:00+00:00"),
            ("chat-b", "", "WO_SUBMITTED", "2026-07-19 10:00:00"),
            ("old-chat", "safety", "", "2026-07-18 00:00:00"),
        ],
    )
    data, err = mb.inspect_overnight(
        db, since_hours=4, now=datetime(2026, 7, 19, 12, 0, tzinfo=timezone.utc)
    )
    assert err is None
    assert data["total_sessions"] == 2
    assert len(data["safety_events"]) == 1
    assert len(data["work_orders"]) == 2


def test_morning_brief_source_error_is_not_no_actions():
    data = mb.empty_overnight_data(source_error="DB not found at /data/mira.db")
    msg = mb.build_brief(data)
    assert "Unable to inspect overnight activity" in msg
    assert "/data/mira.db" in msg
    assert "No actions needed" not in msg


# -- runner ledger ---------------------------------------------------------


def test_runner_ledger_appends_jsonl_event(tmp_path):
    path = tmp_path / "runner-ledger.jsonl"
    written = ledger.append_event(
        runner="safety_alert",
        status="infra",
        checked=["interactions"],
        evidence_path="/data/mira.db",
        counts={"events": 0},
        unable_sources=["/data/mira.db"],
        next_action="fix DB mount",
        path=path,
        run_id="test-run",
    )
    assert written == path
    row = json.loads(path.read_text().strip())
    assert row["runner"] == "safety_alert"
    assert row["status"] == "infra"
    assert row["checked"] == ["interactions"]
    assert row["unable_sources"] == ["/data/mira.db"]
