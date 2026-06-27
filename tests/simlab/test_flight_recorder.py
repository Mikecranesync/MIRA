"""Local deterministic flight-recorder contract tests for SimLab."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from simlab.engine import BASE_EPOCH, SimEngine, _epoch_to_iso
from simlab.lines.juice_bottling import build_line
from simlab.scenarios import get_scenario
from simlab.uns import tag_path


def _fresh_engine() -> SimEngine:
    return SimEngine(build_line(), seed=42)


def _start_underfill_and_tick(client: Any, ticks: int = 2) -> list[dict[str, Any]]:
    sid = "filler_underfill_low_bowl_pressure"
    assert client.post(f"/simlab/scenario/{sid}/start").status_code == 200
    assert client.post(f"/simlab/scenario/tick?n={ticks}").status_code == 200
    return client.get("/simlab/flight-recorder/events").json()["events"]


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
            "run_id": "simlab-local-run",
            "seed": 42,
            "line_id": "line01",
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


def test_recorder_run_id_is_included_in_every_event() -> None:
    from simlab.flight_recorder import InMemoryFlightRecorder

    recorder = InMemoryFlightRecorder(run_id="demo-run-01")
    engine = _fresh_engine()
    engine.add_flight_recorder(recorder)

    engine.load_scenario(get_scenario("filler_underfill_low_bowl_pressure"))
    engine.advance(2)

    assert {event["run_id"] for event in recorder.events()} == {"demo-run-01"}


def test_engine_events_include_seed_and_line_metadata() -> None:
    from simlab.flight_recorder import InMemoryFlightRecorder

    recorder = InMemoryFlightRecorder()
    engine = _fresh_engine()
    engine.add_flight_recorder(recorder)

    engine.load_scenario(get_scenario("filler_underfill_low_bowl_pressure"))
    engine.advance(1)

    assert all(event["seed"] == 42 for event in recorder.events())
    assert all(event["line_id"] == "line01" for event in recorder.events())


fastapi = pytest.importorskip("fastapi", reason="fastapi not installed - skipping API tests")
httpx = pytest.importorskip("httpx", reason="httpx not installed - skipping API tests")


def _build_client(tmp_path: Path, flight_recorder: Any | None = None) -> Any:
    from fastapi.testclient import TestClient

    from simlab.api import build_app
    from simlab.approval import ApprovalStore

    tmp_path.mkdir(parents=True, exist_ok=True)
    engine = _fresh_engine()
    approvals = ApprovalStore(str(tmp_path / "approvals.db"))
    return TestClient(build_app(engine=engine, approvals=approvals, flight_recorder=flight_recorder))


@pytest.fixture()
def client(tmp_path: Path) -> Any:
    return _build_client(tmp_path)


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


def test_api_events_use_default_run_id(client: Any) -> None:
    events = _start_underfill_and_tick(client, ticks=1)

    assert {event["run_id"] for event in events} == {"simlab-local-run"}


def test_api_events_preserve_injected_recorder_run_id(tmp_path: Path) -> None:
    from simlab.flight_recorder import InMemoryFlightRecorder

    client = _build_client(tmp_path, flight_recorder=InMemoryFlightRecorder(run_id="demo-run-02"))
    events = _start_underfill_and_tick(client, ticks=1)

    assert {event["run_id"] for event in events} == {"demo-run-02"}


def test_api_exports_events_as_ordered_ndjson(client: Any) -> None:
    events = _start_underfill_and_tick(client, ticks=2)

    response = client.get("/simlab/flight-recorder/export.ndjson")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    lines = response.text.splitlines()
    assert [json.loads(line) for line in lines] == events
    assert all("events" not in json.loads(line) for line in lines)
    assert client.get("/simlab/flight-recorder/events").json()["events"] == events


def test_api_ndjson_export_is_byte_identical_for_fresh_same_seed_runs(tmp_path: Path) -> None:
    first_client = _build_client(tmp_path / "first")
    second_client = _build_client(tmp_path / "second")

    _start_underfill_and_tick(first_client, ticks=3)
    _start_underfill_and_tick(second_client, ticks=3)

    first_export = first_client.get("/simlab/flight-recorder/export.ndjson").content
    second_export = second_client.get("/simlab/flight-recorder/export.ndjson").content

    assert first_export == second_export


def test_api_clear_empties_recorder(client: Any) -> None:
    sid = "filler_underfill_low_bowl_pressure"
    client.post(f"/simlab/scenario/{sid}/start")
    assert client.get("/simlab/flight-recorder/events").json()["events"]

    response = client.post("/simlab/flight-recorder/clear")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "cleared": True}
    assert client.get("/simlab/flight-recorder/events").json() == {"events": []}
