"""Local deterministic flight recorder for SimLab.

Phase 1 is intentionally headless and process-local: record compact scenario and
tick events from the deterministic engine, serialize them as plain dictionaries,
and do not introduce any external transport or wall-clock source.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from simlab.models import Reading


@dataclass(frozen=True)
class FlightEvent:
    """One deterministic recorder event emitted by the SimLab engine."""

    event_type: str
    tick: int
    ts: str
    scenario_id: str | None
    reading_count: int
    active_alarms: list[dict[str, Any]] = field(default_factory=list)
    changed_paths: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_type": self.event_type,
            "tick": self.tick,
            "ts": self.ts,
            "scenario_id": self.scenario_id,
            "reading_count": self.reading_count,
            "active_alarms": self.active_alarms,
            "changed_paths": self.changed_paths,
        }


class InMemoryFlightRecorder:
    """Process-local recorder storage for deterministic tests and demos."""

    def __init__(self) -> None:
        self._events: list[FlightEvent] = []

    def record(
        self,
        *,
        event_type: str,
        tick: int,
        readings: list[Reading],
        scenario_id: str | None,
        active_alarms: list[dict[str, Any]],
        changed_paths: list[str],
    ) -> None:
        ts = readings[0].ts if readings else ""
        self._events.append(
            FlightEvent(
                event_type=event_type,
                tick=tick,
                ts=ts,
                scenario_id=scenario_id,
                reading_count=len(readings),
                active_alarms=[dict(alarm) for alarm in active_alarms],
                changed_paths=list(changed_paths),
            )
        )

    def events(self) -> list[dict[str, Any]]:
        return [event.to_dict() for event in self._events]

    def clear(self) -> None:
        self._events.clear()


class NoopFlightRecorder:
    """Recorder implementation that deliberately drops all events."""

    def record(self, **_kwargs: Any) -> None:
        return None

    def events(self) -> list[dict[str, Any]]:
        return []

    def clear(self) -> None:
        return None
