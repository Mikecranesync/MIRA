"""Workstream C (PRD §9.4) — the CV-101 Machine Memory observer.

READ-ONLY by construction: it only ever GETs public Hub APIs and writes its
own report files. Offline here: a fake Hub answers the three GETs; the series
evaluator is pure. Pins every recorded field, the two defect detectors
(misleading-live, unavailable-as-empty), the physical/simulated/stale
classification, and that "seven consecutive scheduled days" is counted from
DISTINCT scheduled days and never from a single run.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from agents.machine_memory_observer import (
    ObserverConfig,
    classify_rows,
    evaluate_observation,
    evaluate_series,
    observe_once,
)

NOW = datetime(2026, 8, 30, 6, 15, 0, tzinfo=timezone.utc)
ASSET = "ee715d08-4ea6-4b7a-b99b-958a33c39ea8"


class FakeHub:
    def __init__(
        self, *, history: dict | None = None, history_status: int = 200, memory: dict | None = None
    ):
        self.calls: list[tuple[str, str]] = []
        self.history = history
        self.history_status = history_status
        self.memory = memory or {
            "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
            "live_tags": [
                {
                    "tag_path": "cv101/photo_eye",
                    "freshness": "live",
                    "last_seen_at": NOW.isoformat(),
                }
            ],
            "latest_window": {
                "window_id": "w-9",
                "state": "faulted",
                "started_at": (NOW - timedelta(hours=1)).isoformat(),
                "ended_at": None,
            },
            "current_state": {"state": "faulted", "since": None, "fresh": True},
        }

    def get(self, path: str) -> tuple[int, dict]:
        self.calls.append(("GET", path))
        if path.startswith("/api/version"):
            return 200, {"version": "3.310.0", "gitSha": "abc1234"}
        if "/history/" in path:
            return self.history_status, self.history or {}
        if "/machine-memory/" in path:
            return 200, self.memory
        return 404, {"error": "not_found"}

    # any non-GET must be impossible to reach
    def post(self, *_a, **_k):  # pragma: no cover - guard
        raise AssertionError("observer must never POST")


def _history(
    rows: int,
    *,
    reason: str | None = None,
    overall: str = "live",
    simulated: bool = False,
    quality: str = "good",
):
    return {
        "anchor": {
            "at": (NOW - timedelta(hours=1)).isoformat(),
            "source": "state_window",
            "windowId": "w-9",
        },
        "window": {"from": "x", "to": "y", "pre": 60, "post": 10},
        "coverage": {
            "recorded": rows,
            "historyAvailable": reason != "unavailable",
            "admissible": rows > 0 and reason != "unavailable",
            "earliest": None,
            "latest": None,
            "ingestLagMaxMs": 0,
        },
        "rows": [
            {
                "event_timestamp": NOW.isoformat(),
                "ingested_at": NOW.isoformat(),
                "tag": "cv101/fault_alarm",
                "value": "true",
                "quality": quality,
                "kind": "event",
                "simulated": simulated,
                "source_system": "simulator" if simulated else "plc_bridge",
            }
            for _ in range(rows)
        ],
        "freshness": {
            "overall": overall,
            "live": 1 if overall == "live" else 0,
            "stale": 0,
            "simulated": 0,
            "unknown": 0,
        },
        "summary": {"summary": "Active fault: E-stop wiring fault."},
        **({"reason": reason} if reason else {}),
    }


def _cfg(tmp_path: Path) -> ObserverConfig:
    return ObserverConfig(
        enabled=True,
        hub_base="http://hub.test",
        asset_id=ASSET,
        report_dir=str(tmp_path),
        cookie="next-auth.session-token=x",
    )


def test_records_every_required_field_and_only_gets(tmp_path):
    hub = FakeHub(history=_history(12))
    rec = observe_once(_cfg(tmp_path), hub, now=NOW)
    for key in (
        "observed_at",
        "deployed_version",
        "current_connection",
        "historian_heartbeat",
        "fault_window",
        "row_count",
        "window_bounds",
        "quality",
        "classification",
        "api_state_consistent",
        "defects",
    ):
        assert key in rec, key
    assert rec["deployed_version"] == "3.310.0"
    assert rec["current_connection"] == "live"
    assert rec["fault_window"]["id"] == "w-9"
    assert rec["row_count"] == 12
    assert rec["classification"] == "physical"
    assert rec["api_state_consistent"] is True
    assert rec["defects"] == []
    assert all(m == "GET" for m, _ in hub.calls)
    # one file per scheduled day, JSON, redacted
    files = list(Path(tmp_path).glob("machine-memory-observer/*.json"))
    assert files and "session-token" not in files[0].read_text(encoding="utf-8")


def test_empty_window_is_recorded_honestly_and_never_as_live_evidence(tmp_path):
    rec = observe_once(_cfg(tmp_path), FakeHub(history=_history(0, overall="live")), now=NOW)
    assert rec["row_count"] == 0
    assert rec["current_connection"] == "live"  # a separate fact, recorded separately
    assert rec["classification"] == "unknown"
    assert rec["api_state_consistent"] is True
    assert "misleading_live" not in rec["defects"]


def test_defect_when_api_calls_an_empty_window_admissible():
    h = _history(0)
    h["coverage"]["admissible"] = True  # a Hub regression: the CTA would render
    defects = evaluate_observation(h, memory=None)
    assert "misleading_live" in defects or "admissible_without_rows" in defects


def test_defect_when_unavailable_is_presented_as_empty():
    h = _history(0, reason="unavailable")
    h["coverage"]["historyAvailable"] = (
        True  # contradiction: reason says no source, coverage says available
    )
    assert "unavailable_as_empty" in evaluate_observation(h, memory=None)


def test_classification_physical_simulated_stale_unknown():
    assert classify_rows(_history(3)["rows"]) == "physical"
    assert classify_rows(_history(3, simulated=True)["rows"]) == "simulated"
    assert classify_rows(_history(3, quality="stale")["rows"]) == "stale"
    assert classify_rows([]) == "unknown"


def test_no_fault_window_404_is_an_observation_not_a_crash(tmp_path):
    rec = observe_once(
        _cfg(tmp_path),
        FakeHub(
            history={"error": "no_fault_window", "windowsAvailable": True, "latestWindow": None},
            history_status=404,
        ),
        now=NOW,
    )
    assert rec["fault_window"] is None
    assert rec["row_count"] == 0
    assert rec["historian_heartbeat"]["windows_available"] is True
    assert rec["defects"] == []


def test_series_needs_seven_distinct_consecutive_days_and_a_real_fault_window():
    def rec(day: int, rows: int = 5, classification: str = "physical", defects=()):
        return {
            "observed_at": (NOW + timedelta(days=day)).isoformat(),
            "row_count": rows,
            "classification": classification,
            "fault_window": {"id": f"w-{day}"} if rows else None,
            "defects": list(defects),
            "historian_heartbeat": {"age_s": 60},
        }

    ok = evaluate_series([rec(d) for d in range(7)], now=NOW + timedelta(days=6))
    assert ok["consecutive_days"] == 7
    assert ok["real_fault_window_with_rows"] is True
    assert ok["operational"] is True

    # the same day observed 7 times is ONE day
    one = evaluate_series([rec(0) for _ in range(7)], now=NOW)
    assert one["consecutive_days"] == 1 and one["operational"] is False
    assert "SEVEN_DAYS_NOT_ACCRUED" in one["reasons"]

    # a gap breaks the streak
    gap = evaluate_series([rec(d) for d in (0, 1, 2, 4, 5, 6, 7)], now=NOW + timedelta(days=7))
    assert gap["consecutive_days"] == 4

    # simulated rows never satisfy the real-fault requirement
    sim = evaluate_series(
        [rec(d, classification="simulated") for d in range(7)], now=NOW + timedelta(days=6)
    )
    assert sim["real_fault_window_with_rows"] is False and sim["operational"] is False
    assert "NO_REAL_FAULT_WINDOW" in sim["reasons"]

    # one misleading-live defect anywhere fails the series
    bad = evaluate_series(
        [rec(d, defects=("misleading_live",) if d == 3 else ()) for d in range(7)],
        now=NOW + timedelta(days=6),
    )
    assert bad["operational"] is False and "DEFECT_OBSERVED" in bad["reasons"]


def test_disabled_config_is_inert(tmp_path):
    cfg = ObserverConfig(
        enabled=False,
        hub_base="http://hub.test",
        asset_id=ASSET,
        report_dir=str(tmp_path),
        cookie=None,
    )
    hub = FakeHub(history=_history(1))
    rec = observe_once(cfg, hub, now=NOW)
    assert rec["enabled"] is False
    assert hub.calls == []
    assert not list(Path(tmp_path).glob("**/*.json"))


def test_series_file_is_rewritten_from_daily_records(tmp_path):
    cfg = _cfg(tmp_path)
    observe_once(cfg, FakeHub(history=_history(4)), now=NOW)
    observe_once(cfg, FakeHub(history=_history(4)), now=NOW + timedelta(days=1))
    series = json.loads(
        (Path(tmp_path) / "machine-memory-observer" / "series.json").read_text(encoding="utf-8")
    )
    assert series["days_observed"] == 2
    assert series["operational"] is False
    assert series["code_ready"] is True


def test_task_is_registered_on_the_worker_and_beat_entry_is_flag_gated(monkeypatch):
    """Review finding: a beat entry for an unregistered task is a daily
    'unregistered task' error, and an always-scheduled entry publishes even
    when disabled. Both are pinned here."""
    import importlib
    import sys

    import celery_app

    assert "tasks.machine_memory_observer.observe_cv101_machine_memory" in celery_app.app.tasks

    monkeypatch.setenv("CELERY_BEAT_PROFILE", "synthetic-dogfood")
    monkeypatch.delenv("MACHINE_MEMORY_OBSERVER_ENABLED", raising=False)
    sys.modules.pop("celeryconfig", None)
    cfg = importlib.import_module("celeryconfig")
    assert "machine-memory-observer-daily" not in cfg.beat_schedule

    monkeypatch.setenv("MACHINE_MEMORY_OBSERVER_ENABLED", "1")
    sys.modules.pop("celeryconfig", None)
    cfg = importlib.import_module("celeryconfig")
    entry = cfg.beat_schedule["machine-memory-observer-daily"]
    assert entry["task"] == "tasks.machine_memory_observer.observe_cv101_machine_memory"
    assert entry["options"]["queue"] == "synthetic"
    sys.modules.pop("celeryconfig", None)


def test_observer_client_never_follows_redirects_with_the_session():
    import inspect

    import tasks.machine_memory_observer as t

    assert "follow_redirects=False" in inspect.getsource(t.HttpxHub)
