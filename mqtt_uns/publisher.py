"""Publish a deterministic maintenance event onto its UNS-shaped MQTT topic."""
from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import topics  # noqa: E402


class Publisher:
    def __init__(self, transport) -> None:
        self._t = transport

    def publish_event(self, event):
        """Serialize + publish. Returns (topic, payload, delivered_count)."""
        topic = topics.topic_for_event(event)
        payload = event.to_json()
        delivered = self._t.publish(topic, payload)
        return topic, payload, delivered
