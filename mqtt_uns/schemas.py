"""The MQTT event schema.

A `MaintenanceEvent` carries exactly enough for the explanation engine to reconstruct the SAME answer
card on the far side of the wire: the cause type, the asset/line UNS, the symptom, and the observed
abnormal/healthy signal sets (which ARE the Phase 3 observation). Serialization is deterministic
(sorted keys, sorted signal lists, no wall-clock) so the same event is the same bytes every run.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field

SCHEMA_VERSION = "1"

# External event-type names (the user's vocabulary) <-> internal Phase 2 mode ids. The engine uses the
# internal id; this alias keeps the wire vocabulary friendly without changing the brain.
EVENT_TYPE_ALIASES = {
    "interlock_failure": "failed_interlock",
    "communication_loss": "comm_loss",
}


def normalize_event_type(name: str) -> str:
    return EVENT_TYPE_ALIASES.get(name, name)


@dataclass(frozen=True)
class MaintenanceEvent:
    event_type: str                 # internal mode id (photoeye_blocked, ...)
    asset_uns: str
    line_uns: str
    symptom: str
    abnormal_signals: list = field(default_factory=list)
    healthy_signals: list = field(default_factory=list)
    conflicting: bool = False
    schema_version: str = SCHEMA_VERSION

    def to_json(self) -> str:
        d = asdict(self)
        d["abnormal_signals"] = sorted(d["abnormal_signals"])
        d["healthy_signals"] = sorted(d["healthy_signals"])
        return json.dumps(d, sort_keys=True, ensure_ascii=False)

    @staticmethod
    def from_json(payload: str) -> "MaintenanceEvent":
        d = json.loads(payload)
        return MaintenanceEvent(
            event_type=normalize_event_type(d["event_type"]),
            asset_uns=d["asset_uns"], line_uns=d["line_uns"], symptom=d["symptom"],
            abnormal_signals=list(d.get("abnormal_signals", [])),
            healthy_signals=list(d.get("healthy_signals", [])),
            conflicting=bool(d.get("conflicting", False)),
            schema_version=d.get("schema_version", SCHEMA_VERSION),
        )
