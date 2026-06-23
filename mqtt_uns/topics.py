"""UNS-shaped MQTT topics, generated from the Phase 1 context model's UNS paths.

A UNS path `enterprise.site.area.line.asset` becomes the topic stem `enterprise/site/area/line/asset`,
with a kind suffix (`events` / `state` / `faults` / `maintenance`). The objective is event transport,
not perfect topic taxonomy.
"""
from __future__ import annotations

KINDS = ("events", "state", "faults", "maintenance")


def stem(uns_path: str) -> str:
    return uns_path.replace(".", "/")


def topic(uns_path: str, kind: str = "events") -> str:
    return "%s/%s" % (stem(uns_path), kind)


def topic_for_event(event) -> str:
    return topic(event.asset_uns, "events")


def enterprise_filter(uns_path: str) -> str:
    """A `#` subscription rooted at the enterprise of a UNS path (covers the whole tree)."""
    return "%s/#" % uns_path.split(".", 1)[0]
