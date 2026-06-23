"""Receive maintenance events from the broker and deserialize them back into MaintenanceEvents."""
from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import schemas  # noqa: E402


class Subscriber:
    def __init__(self, transport, topic_filter: str = "#") -> None:
        self.received: list = []      # [(topic, MaintenanceEvent)]
        self.raw: list = []           # [(topic, payload)]
        transport.subscribe(topic_filter, self._on_message)

    def _on_message(self, topic: str, payload: str) -> None:
        self.raw.append((topic, payload))
        self.received.append((topic, schemas.MaintenanceEvent.from_json(payload)))
