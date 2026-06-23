"""In-process MQTT transport — local, deterministic, real topic/wildcard semantics.

A synchronous loopback broker: `publish` immediately delivers to every subscriber whose topic filter
matches (MQTT `+` single-level and `#` multi-level wildcards). No network, no threads, no clock ->
fully deterministic and testable. The `Transport` shape (publish / subscribe) is exactly what a real
paho/aiomqtt client exposes, so a live broker can be swapped in later without touching the brain.
"""
from __future__ import annotations


def topic_matches(topic_filter: str, topic: str) -> bool:
    """MQTT topic matching with `+` (single level) and `#` (multi level, trailing only)."""
    f = topic_filter.split("/")
    t = topic.split("/")
    for i, seg in enumerate(f):
        if seg == "#":
            return True
        if i >= len(t):
            return False
        if seg == "+":
            continue
        if seg != t[i]:
            return False
    return len(f) == len(t)


class InMemoryBroker:
    """Deterministic local broker. `log` records every published (topic, payload) for inspection."""

    def __init__(self) -> None:
        self._subs: list = []                 # (topic_filter, callback)
        self.log: list = []                   # [(topic, payload)] in publish order

    def subscribe(self, topic_filter: str, callback) -> None:
        self._subs.append((topic_filter, callback))

    def publish(self, topic: str, payload: str) -> int:
        """Deliver to all matching subscribers (in subscription order). Returns # of deliveries."""
        self.log.append((topic, payload))
        delivered = 0
        for filt, cb in self._subs:
            if topic_matches(filt, topic):
                cb(topic, payload)
                delivered += 1
        return delivered
