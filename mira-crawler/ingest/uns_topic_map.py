"""Reconcile flat bench / MQTT topics to ISA-95 UNS paths (Phase 6).

The garage bench (and the demo MQTT broker) name tags flatly:

    Mira_Monitored/conveyor_demo/Motor_Current_A      (Ignition tag path)
    demo/cell1/conveyor/cv101/motor_current           (flat MQTT topic)

The UNS requires the ISA-95 type-marker form built by mira-crawler/ingest/uns.py:

    enterprise.home_garage.site.lake_wales.area.conveyor_lab.line.line_1
        .work_cell.conveyor_cell.equipment.gs10_vfd.datapoint.motor_current

This module is the mapping layer: a config that maps a SOURCE topic to a UNS
PLACEMENT (which company/site/area/line/work_cell/equipment it lives on, and
what subnode the trailing tag becomes), and `resolve_topic_to_uns()` which
applies it.

CRITICAL: every path segment is produced by the uns.py builders
(`assigned_equipment_path`, `equipment_subnode_path`, `slug`) — NEVER by
hand-formatting `f"enterprise.{...}"`. That is the whole point of Phase 6: the
bench stops inventing path strings and routes through the one builder, so bench
paths are byte-identical to the paths the ingest pipeline builds for a real
customer plant (uns-compliance.md rule #1).

The resolver is config-driven (JSON), so adding the GS10 / Micro820 / sensor
tags is data, not code. Two match modes:
  - exact   : the source topic equals `match` verbatim.
  - prefix  : the source topic starts with `match_prefix`; the remaining
              topic segments become the subnode tail (so a whole device's tags
              map with one rule).

Integration point (documented follow-up, not wired here): the resolved
uns_path is what `approved_tags.uns_path` / `tag_events.uns_path` should carry.
A seeding step can walk `bench_uns_map.json` through this resolver to populate
`approved_tags` for the bench tenant. See PLAN.md P6 / HANDOFF.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from . import uns

logger = logging.getLogger("mira-crawler.uns_topic_map")

# Topic separators we split on to derive trailing segments (Ignition uses '/',
# MQTT '/', Sparkplug '/', some sources '.').
_TOPIC_SPLIT = re.compile(r"[\/.]+")


@dataclass
class TopicRule:
    """One mapping rule: where a source topic lands in the UNS.

    Exactly one of `match` (exact) or `match_prefix` (prefix) is set.
    `equipment` is the equipment instance id; `line` / `work_cell` are optional
    (equipment can attach on a line or directly in an area — see
    uns.assigned_equipment_path). `subnode` is the literal+instance tail under
    the equipment (e.g. ["datapoint", "motor_current"] or ["component",
    "photoeye_1"]). For prefix rules, `subnode_prefix` is prepended to the
    slugified remainder of the topic.
    """

    equipment: str
    company: str
    site: str
    area: str
    line: Optional[str] = None
    work_cell: Optional[str] = None
    match: Optional[str] = None
    match_prefix: Optional[str] = None
    subnode: list[str] = field(default_factory=list)
    subnode_prefix: list[str] = field(default_factory=lambda: ["datapoint"])

    def equipment_path(self) -> str:
        return uns.assigned_equipment_path(
            self.company,
            self.site,
            self.area,
            self.equipment,
            line=self.line,
            work_cell=self.work_cell,
        )


@dataclass
class TopicMap:
    rules_exact: dict[str, TopicRule] = field(default_factory=dict)
    rules_prefix: list[TopicRule] = field(default_factory=list)

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "TopicMap":
        defaults = raw.get("defaults") or {}
        exact: dict[str, TopicRule] = {}
        prefix: list[TopicRule] = []
        for entry in raw.get("topics") or []:
            merged = {**defaults, **entry}
            rule = TopicRule(
                equipment=merged["equipment"],
                company=merged["company"],
                site=merged["site"],
                area=merged["area"],
                line=merged.get("line"),
                work_cell=merged.get("work_cell"),
                match=merged.get("match"),
                match_prefix=merged.get("match_prefix"),
                subnode=list(merged.get("subnode") or []),
                subnode_prefix=list(merged.get("subnode_prefix") or ["datapoint"]),
            )
            if rule.match:
                exact[rule.match] = rule
            elif rule.match_prefix:
                prefix.append(rule)
            else:
                raise ValueError(
                    f"topic rule for equipment={rule.equipment!r} has neither "
                    "'match' nor 'match_prefix'"
                )
        # Longest prefix first so the most specific rule wins.
        prefix.sort(key=lambda r: len(r.match_prefix or ""), reverse=True)
        return cls(rules_exact=exact, rules_prefix=prefix)


def load_topic_map(path: str | Path) -> TopicMap:
    """Load a topic map from a JSON file."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return TopicMap.from_dict(data)


def _remainder_segments(topic: str, prefix: str) -> list[str]:
    """Trailing topic segments after `prefix`, slugified, empties dropped."""
    tail = topic[len(prefix):]
    return [s for s in (uns.slug(p) for p in _TOPIC_SPLIT.split(tail)) if s]


def resolve_topic_to_uns(topic: str, topic_map: TopicMap) -> Optional[str]:
    """Resolve a flat source topic to a canonical UNS path, or None if no rule
    matches.

    The returned string is built entirely by uns.py builders — never
    hand-formatted. None means "no mapping" (the caller must NOT invent a path;
    an unmapped tag stays unresolved, same contract as the ingest allowlist).
    """
    if not topic:
        return None

    rule = topic_map.rules_exact.get(topic)
    if rule is not None:
        eq_path = rule.equipment_path()
        path = uns.equipment_subnode_path(eq_path, *rule.subnode) if rule.subnode else eq_path
        return _validated(path, topic)

    for rule in topic_map.rules_prefix:
        prefix = rule.match_prefix or ""
        # Match on a segment boundary so "demo/cell1/conveyor/cv101" does not
        # also swallow "demo/cell1/conveyor/cv1010".
        if topic == prefix or topic.startswith(prefix.rstrip("/.") + "/") or topic.startswith(
            prefix.rstrip("/.") + "."
        ):
            eq_path = rule.equipment_path()
            tail = _remainder_segments(topic, prefix.rstrip("/."))
            segments = [*rule.subnode_prefix, *tail] if tail else list(rule.subnode)
            path = uns.equipment_subnode_path(eq_path, *segments) if segments else eq_path
            return _validated(path, topic)

    logger.debug("UNS_TOPIC_MAP no rule for topic=%r", topic)
    return None


def _validated(path: str, topic: str) -> Optional[str]:
    if not uns.is_valid_path(path):
        logger.warning("UNS_TOPIC_MAP built invalid path %r from topic=%r", path, topic)
        return None
    return path
