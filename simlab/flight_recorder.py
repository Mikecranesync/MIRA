"""Local deterministic flight recorder for SimLab.

Phase 1 is intentionally headless and process-local: record compact scenario and
tick events from the deterministic engine, serialize them as plain dictionaries,
and do not introduce any external transport or wall-clock source.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from simlab.models import Reading

DEFAULT_RUN_ID = "simlab-local-run"


@dataclass(frozen=True)
class FlightEvent:
    """One deterministic recorder event emitted by the SimLab engine."""

    event_type: str
    run_id: str
    seed: int
    line_id: str
    tick: int
    ts: str
    scenario_id: str | None
    reading_count: int
    active_alarms: list[dict[str, Any]] = field(default_factory=list)
    changed_paths: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        event = {
            "event_type": self.event_type,
            "run_id": self.run_id,
            "seed": self.seed,
            "line_id": self.line_id,
            "tick": self.tick,
            "ts": self.ts,
            "scenario_id": self.scenario_id,
            "reading_count": self.reading_count,
            "active_alarms": self.active_alarms,
            "changed_paths": self.changed_paths,
        }
        if self.details:
            event["details"] = self.details
        return event


class InMemoryFlightRecorder:
    """Process-local recorder storage for deterministic tests and demos."""

    def __init__(self, run_id: str = DEFAULT_RUN_ID) -> None:
        self.run_id = run_id
        self._events: list[FlightEvent] = []

    def record(
        self,
        *,
        event_type: str,
        seed: int,
        line_id: str,
        tick: int,
        readings: list[Reading],
        scenario_id: str | None,
        active_alarms: list[dict[str, Any]],
        changed_paths: list[str],
        details: dict[str, Any] | None = None,
    ) -> None:
        ts = readings[0].ts if readings else ""
        self._events.append(
            FlightEvent(
                event_type=event_type,
                run_id=self.run_id,
                seed=seed,
                line_id=line_id,
                tick=tick,
                ts=ts,
                scenario_id=scenario_id,
                reading_count=len(readings),
                active_alarms=[dict(alarm) for alarm in active_alarms],
                changed_paths=list(changed_paths),
                details=dict(details or {}),
            )
        )

    def events(self) -> list[dict[str, Any]]:
        return [event.to_dict() for event in self._events]

    def export_ndjson(self) -> str:
        return "\n".join(
            json.dumps(event, separators=(",", ":")) for event in self.events()
        )

    def clear(self) -> None:
        self._events.clear()


class NoopFlightRecorder:
    """Recorder implementation that deliberately drops all events."""

    def record(self, **_kwargs: Any) -> None:
        return None

    def events(self) -> list[dict[str, Any]]:
        return []

    def export_ndjson(self) -> str:
        return ""

    def clear(self) -> None:
        return None
