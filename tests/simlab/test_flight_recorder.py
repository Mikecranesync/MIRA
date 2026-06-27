"""Local deterministic flight-recorder contract tests for SimLab."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from simlab.engine import BASE_EPOCH, SimEngine, _epoch_to_iso
from simlab.lines.juice_bottling import build_line
from simlab.scenarios import get_scenario
from simlab.uns import tag_path


def _fresh_engine() -> SimEngine:
    return SimEngine(build_line(), seed=42)


def test_engine_does_not_record_until_recorder_is_attached() -> None:
    from simlab.flight_recorder import InMemoryFlightRecorder

    recorder = InMemoryFlightRecorder()
    engine = _fresh_engine()

    engine.load_scenario(get_scenario("filler_underfill_low_bowl_pressure"))
    engine.advance(2)

    assert recorder.events() == []


def test_load_scenario_records_one_scenario_loaded_event_at_tick_zero() -> None:
    from simlab.flight_recorder import InMemoryFlightRecorder

    recorder = InMemoryFlightRecorder()
    engine = _fresh_engine()
    engine.add_flight_recorder(recorder)

    engine.load_scenario(get_scenario("filler_underfill_low_bowl_pressure"))

    assert recorder.events() == [
        {
            "event_type": "scenario_loaded",
            "tick": 0,
            "ts": _epoch_to_iso(BASE_EPOCH),
            "scenario_id": "filler_underfill_low_bowl_pressure",
            "reading_count": len(engine.snapshot()),
            "active_alarms": [],
            "changed_paths": [
                tag_path("filler01", "process", "fill_level_variance"),
            ],
        }
    ]


def test_advance_records_one_tick_event_per_internal_tick() -> None:
    from simlab.flight_recorder import InMemoryFlightRecorder

    recorder = InMemoryFlightRecorder()
    engine = _fresh_engine()
    engine.add_flight_recorder(recorder)
    engine.load_scenario(get_scenario("filler_underfill_low_bowl_pressure"))

    engine.advance(2)

    events = recorder.events()
    tick_events = [event for event in events if event["event_type"] == "tick"]
    assert [event["tick"] for event in tick_events] == [1, 2]
    assert [event["ts"] for event in tick_events] == [
        _epoch_to_iso(BASE_EPOCH + 1),
        _epoch_to_iso(BASE_EPOCH + 2),
    ]
    assert all(event["scenario_id"] == "filler_underfill_low_bowl_pressure" for event in tick_events)
    assert all(event["reading_count"] == len(engine.snapshot()) for event in tick_events)
    assert all(isinstance(event["active_alarms"], list) for event in tick_events)
    assert all(event["changed_paths"] for event in tick_events)


fastapi = pytest.importorskip("fastapi", reason="fastapi not installed - skipping API tests")
httpx = pytest.importorskip("httpx", reason="httpx not installed - skipping API tests")


@pytest.fixture()
def client(tmp_path: Path) -> Any:
    from fastapi.testclient import TestClient

    from simlab.api import build_app
    from simlab.approval import ApprovalStore

    engine = _fresh_engine()
    approvals = ApprovalStore(str(tmp_path / "approvals.db"))
    return TestClient(build_app(engine=engine, approvals=approvals))


def test_api_start_and_tick_expose_recorder_events(client: Any) -> None:
    sid = "filler_underfill_low_bowl_pressure"

    start = client.post(f"/simlab/scenario/{sid}/start")
    assert start.status_code == 200
    tick = client.post("/simlab/scenario/tick?n=2")
    assert tick.status_code == 200

    response = client.get("/simlab/flight-recorder/events")
    assert response.status_code == 200
    events = response.json()["events"]

    assert [event["event_type"] for event in events] == ["scenario_loaded", "tick", "tick"]
    assert [event["tick"] for event in events] == [0, 1, 2]
    assert all(event["scenario_id"] == sid for event in events)


def test_api_clear_empties_recorder(client: Any) -> None:
    sid = "filler_underfill_low_bowl_pressure"
    client.post(f"/simlab/scenario/{sid}/start")
    assert client.get("/simlab/flight-recorder/events").json()["events"]

    response = client.post("/simlab/flight-recorder/clear")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "cleared": True}
    assert client.get("/simlab/flight-recorder/events").json() == {"events": []}
