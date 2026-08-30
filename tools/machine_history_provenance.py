"""Shared fail-closed provenance contract for Machine Memory observations."""

from __future__ import annotations

from dataclasses import dataclass

PHYSICAL_SOURCES = frozenset({"ignition", "plc_bridge", "relay"})
SYNTHETIC_SOURCES = frozenset({"simulator", "simlab", "synthetic", "demo_simulator"})
CV101_SOURCE = "ignition"
CV101_CONNECTION = "cv101-bench-gw"


@dataclass(frozen=True)
class ProvenanceResult:
    provenance: str
    admissible: bool
    bad_quality: bool
    cv101_approved: bool


def classify_event(row: dict[str, object]) -> ProvenanceResult:
    """Classify one raw tag-event without trusting a denylist or caller claims."""
    source = row.get("source_system")
    connection = row.get("source_connection_id")
    simulated = row.get("simulated")
    source_name = source.strip().lower() if isinstance(source, str) else ""
    has_connection = isinstance(connection, str) and bool(connection.strip())

    # Synthetic source names are authoritative: `simulated: false` is spoofable.
    if simulated is True or source_name in SYNTHETIC_SOURCES:
        provenance = "simulated"
    elif source_name in PHYSICAL_SOURCES and simulated is False and has_connection:
        provenance = "physical"
    else:
        provenance = "unknown"

    quality = row.get("quality")
    physical = provenance == "physical"
    return ProvenanceResult(
        provenance=provenance,
        admissible=physical and quality == "good",
        bad_quality=physical and quality != "good",
        cv101_approved=(
            physical and source_name == CV101_SOURCE and connection == CV101_CONNECTION
        ),
    )


def summarize_fixture(fixture: dict[str, object]) -> dict[str, object]:
    """Count raw event observations; presentation-only diffs never enter a partition."""
    events = fixture["events"]
    assert isinstance(events, list)
    results = [classify_event(row) for row in events if isinstance(row, dict)]
    timestamps = [row["event_timestamp"] for row in events if isinstance(row, dict)]
    return {
        "returnedRowCount": len(events) + len(fixture["diffs"]),
        "observationCount": len(events),
        "admissibleObservationCount": sum(result.admissible for result in results),
        "physicalObservationCount": sum(result.provenance == "physical" for result in results),
        "simulatedObservationCount": sum(result.provenance == "simulated" for result in results),
        "badQualityObservationCount": sum(result.bad_quality for result in results),
        "unknownProvenanceCount": sum(result.provenance == "unknown" for result in results),
        "firstObservedAt": min(timestamps),
        "lastObservedAt": max(timestamps),
    }
