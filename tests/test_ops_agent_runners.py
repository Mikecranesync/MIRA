"""Tests for the container ops-agent runners (pm_escalation, safety_alert) shipped
2026-07-09 after they were found dead in prod (Dockerfile didn't COPY agents/, and
2 of 3 runner files never existed). Covers the pure message-building + date logic;
the Telegram send + DB/NeonDB reads are integration-only."""

from __future__ import annotations

import importlib.util
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


# ── pm_escalation ─────────────────────────────────────────────────────────────


def test_pm_empty_is_all_clear():
    assert pm.build_message([]) == "✓ No PMs due right now."


def test_pm_lists_and_counts_critical():
    pms = [
        {"manufacturer": "Allen-Bradley", "model_number": "PowerFlex 525", "task": "Inspect DC bus",
         "criticality": "critical", "next_due_at": None, "trigger_type": "calendar"},
        {"manufacturer": "SEW", "model_number": "", "task": "Grease bearings",
         "criticality": "medium", "next_due_at": None, "trigger_type": "calendar"},
    ]
    msg = pm.build_message(pms)
    assert "2 PMs due" in msg
    assert "1 critical" in msg
    assert "🔴 " in msg  # the critical one is flagged
    assert "PowerFlex 525" in msg and "Grease bearings" in msg


def test_pm_truncates_and_counts_remainder():
    pms = [{"task": f"t{i}", "criticality": "low", "next_due_at": None} for i in range(15)]
    msg = pm.build_message(pms, max_list=10)
    assert "…and 5 more" in msg
    assert msg.count("• ") == 10


def test_pm_overdue_days():
    past = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    assert pm._overdue_days(past) == 3
    assert pm._overdue_days(None) is None
    future = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
    assert pm._overdue_days(future) == 0  # clamped, not negative


def test_pm_due_label_meter_trigger():
    label = pm._due_label(
        {"next_due_at": None, "trigger_type": "meter", "meter_threshold": 500, "meter_current": 620}
    )
    assert label == "meter 620/500"


# ── safety_alert ──────────────────────────────────────────────────────────────


def test_safety_empty_is_all_clear():
    assert sa.build_message([], 24) == "✓ No safety events in the last 24h."


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
    assert "…and 4 more" in msg


def test_both_resolve_alert_channel_first():
    # Both runners must prefer the alert bot token over the prod token — same
    # guard as tests/test_telegram_alert_routing.py, at the runner level.
    for mod in (pm, sa):
        src = (_AGENTS / f"{mod.__name__}.py").read_text()
        assert "TELEGRAM_ALERT_BOT_TOKEN" in src
        assert src.index("TELEGRAM_ALERT_BOT_TOKEN") < src.index('TELEGRAM_BOT_TOKEN", ""')
