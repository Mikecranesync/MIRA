"""Sparkplug B decode layer — session state machine → canonical tag entries.

This is the Sparkplug half of the Lane 3 ``decode`` contract: it takes a parsed
MQTT ``(topic, payload_bytes)`` and produces **canonical tag entries**
(``ingest_contract.build_tag_entry`` output) plus lifecycle signals. It owns the
Sparkplug session state — the per-edge/device **alias → (name, datatype)** table
built from NBIRTH/DBIRTH — so NDATA/DDATA (which carry aliases + values only) can
be resolved.

It does NOT persist, normalize for the allowlist, or check the allowlist — that
is ``tag_ingest.ingest_batch`` (the one pipeline). The subscriber feeds these
entries straight into ``ingest_batch`` (Lane 3 thesis: transport+decode only).

Spec: docs/design/2026-06-23-lane3-mqtt-subscriber-design.md §1–§3.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from ingest_contract import build_tag_entry

from .codecs import sparkplug_b as spb

logger = logging.getLogger("mira-relay.mqtt_ingest.decode")

# (group_id, edge_node_id, device_id|None) — one Sparkplug session.
NodeKey = tuple[str, str, Optional[str]]


def metric_to_tag_path(topic: spb.SparkplugTopic, metric_name: str) -> str:
    """Build the raw tag path for a metric: ``group/edge[/device]/metric``.

    This raw path is what ``normalize_tag_path`` (in ingest_batch) collapses to
    the ``approved_tags`` match key — so the Sparkplug allowlist seed MUST be
    generated from the SAME construction (the §5 fail-closed contract). Kept
    deterministic + importable so a seed generator can reuse it verbatim."""
    parts = [topic.group_id, topic.edge_node_id]
    if topic.device_id:
        parts.append(topic.device_id)
    parts.append(metric_name)
    return "/".join(p for p in parts if p)


def _ms_to_iso(ms: Optional[int]) -> Optional[str]:
    if ms is None:
        return None
    try:
        return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).isoformat()
    except (ValueError, OverflowError, OSError):
        return None


@dataclass
class DecodeResult:
    """Outcome of decoding one Sparkplug message.

    ``entries`` are canonical tag entries ready for ``build_ingest_batch`` →
    ``ingest_batch``. ``offline_tag_paths`` (from N/DDEATH) tell the consumer to
    mark those tags stale. ``discovered`` are metric tag paths first seen in this
    message (for the seen/proposed discovery path). ``dropped`` counts metrics we
    could not resolve (e.g. DATA before BIRTH) — observability, never fatal."""

    entries: list[dict] = field(default_factory=list)
    offline_tag_paths: list[str] = field(default_factory=list)
    discovered: list[str] = field(default_factory=list)
    dropped: int = 0
    ignored_reason: Optional[str] = None


class SparkplugDecoder:
    """Stateful per-subscriber Sparkplug B decoder.

    Holds the BIRTH alias tables and the set of known tag paths per session so
    DATA can be resolved and DEATH can mark the right tags stale. One instance
    per subscriber process (one tenant/broker)."""

    def __init__(self) -> None:
        # node_key -> {alias: (metric_name, datatype)}
        self._aliases: dict[NodeKey, dict[int, tuple[str, Optional[int]]]] = {}
        # node_key -> {metric_name: datatype}  (name-keyed, for DATA without alias)
        self._datatypes: dict[NodeKey, dict[str, Optional[int]]] = {}
        # node_key -> set[raw tag_path]  (everything we've seen, for DEATH staling)
        self._known: dict[NodeKey, set[str]] = {}

    def handle(self, topic_str: str, payload_bytes: bytes) -> DecodeResult:
        """Decode one MQTT message. Never raises — a bad message yields an
        ``ignored``/``dropped`` result so the subscriber loop survives it."""
        topic = spb.parse_topic(topic_str)
        if topic is None:
            return DecodeResult(ignored_reason="not_sparkplug")
        if topic.is_command:
            # Read-only: never ingest or act on NCMD/DCMD.
            return DecodeResult(ignored_reason="command_topic")
        if topic.message_type == "STATE":
            return DecodeResult(ignored_reason="state_topic")

        try:
            payload = spb.decode_payload(payload_bytes)
        except spb.DecodeError as exc:
            logger.warning("sparkplug decode failed (%s): %s", topic_str, exc)
            return DecodeResult(ignored_reason="decode_error")

        node_key: NodeKey = (topic.group_id, topic.edge_node_id, topic.device_id)

        if topic.is_death:
            return self._handle_death(node_key)
        if topic.is_birth:
            return self._handle_birth(topic, node_key, payload)
        if topic.is_data:
            return self._handle_data(topic, node_key, payload)
        return DecodeResult(ignored_reason="unhandled_type")

    # ── BIRTH: (re)build the alias table; emit any initial values ────────────
    def _handle_birth(
        self, topic: spb.SparkplugTopic, node_key: NodeKey, payload: spb.SparkplugPayload
    ) -> DecodeResult:
        # Rebirth replaces the prior table (idempotent for repeated BIRTHs).
        aliases: dict[int, tuple[str, Optional[int]]] = {}
        datatypes: dict[str, Optional[int]] = {}
        known = self._known.setdefault(node_key, set())
        result = DecodeResult()

        for metric in payload.metrics:
            if not metric.name:
                continue  # BIRTH metrics must be named to seed the alias table
            if metric.alias is not None:
                aliases[metric.alias] = (metric.name, metric.datatype)
            datatypes[metric.name] = metric.datatype
            tag_path = metric_to_tag_path(topic, metric.name)
            if tag_path not in known:
                known.add(tag_path)
                result.discovered.append(tag_path)
            entry = self._metric_to_entry(topic, metric, metric.name, metric.datatype, payload)
            if entry is not None:
                result.entries.append(entry)

        self._aliases[node_key] = aliases
        self._datatypes[node_key] = datatypes
        return result

    # ── DATA: resolve aliases/names against the BIRTH table ──────────────────
    def _handle_data(
        self, topic: spb.SparkplugTopic, node_key: NodeKey, payload: spb.SparkplugPayload
    ) -> DecodeResult:
        aliases = self._aliases.get(node_key, {})
        datatypes = self._datatypes.get(node_key, {})
        result = DecodeResult()

        for metric in payload.metrics:
            name = metric.name
            datatype = metric.datatype
            if name is None and metric.alias is not None:
                resolved = aliases.get(metric.alias)
                if resolved is None:
                    # DATA before BIRTH (or unknown alias) — cannot resolve.
                    result.dropped += 1
                    continue
                name, birth_dt = resolved
                if datatype is None:
                    datatype = birth_dt
            if name is None:
                result.dropped += 1
                continue
            if datatype is None:
                datatype = datatypes.get(name)
            entry = self._metric_to_entry(topic, metric, name, datatype, payload)
            if entry is not None:
                result.entries.append(entry)
        return result

    # ── DEATH: mark every known tag for this session stale ───────────────────
    def _handle_death(self, node_key: NodeKey) -> DecodeResult:
        known = self._known.get(node_key, set())
        return DecodeResult(offline_tag_paths=sorted(known))

    # ── one metric → canonical tag entry (or None to skip) ───────────────────
    def _metric_to_entry(
        self,
        topic: spb.SparkplugTopic,
        metric: spb.Metric,
        name: str,
        datatype: Optional[int],
        payload: spb.SparkplugPayload,
    ) -> Optional[dict]:
        if metric.is_null or metric.value is None:
            return None  # null metric carries no value to ingest
        if datatype in spb.UNSUPPORTED_DATATYPES:
            return None  # DataSet/Template — not a scalar tag value
        value_type = spb.datatype_to_value_type(datatype)
        ts_iso = _ms_to_iso(metric.timestamp) or _ms_to_iso(payload.timestamp)
        tag_path = metric_to_tag_path(topic, name)
        metadata: dict[str, Any] = {
            "source_protocol": "sparkplug_b",
            "transport": "mqtt",
            "group_id": topic.group_id,
            "edge_node": topic.edge_node_id,
            "device": topic.device_id,
            "metric_name": name,
            "topic": (
                f"{topic.namespace}/{topic.group_id}/{topic.message_type}/"
                f"{topic.edge_node_id}" + (f"/{topic.device_id}" if topic.device_id else "")
            ),
        }
        if metric.alias is not None:
            metadata["alias"] = metric.alias
        if datatype is not None:
            metadata["sparkplug_datatype"] = spb.DATATYPE_NAMES.get(datatype, str(datatype))
        if payload.seq is not None:
            metadata["seq"] = payload.seq
        return build_tag_entry(
            tag_path,
            metric.value,
            value_type=value_type,
            quality="good",
            ts=ts_iso,
            metadata=metadata,
        )
