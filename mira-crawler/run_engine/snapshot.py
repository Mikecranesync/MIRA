"""Build A0–A12 rule-input snapshots from tag_events rows.

``run_engine.anomaly_rules`` (the vendored rules_core) reads a ``snap`` dict
keyed by UNS-relative topics (e.g. ``vfd/vfd101/comm_ok``). tag_events rows
carry *normalized tag paths* (the fail-closed ``approved_tags`` match key, e.g.
``default_conveyor_vfd_comm_ok``). This module owns the explicit mapping between
the two, the value coercion (tag_events stores TEXT + value_type), and the
derived temporal facts (``max_stale_s``, ``cmd_run_for_s``) the rules read.

The mapping is CONFIG — one explicit dict constant per asset, derived from the
approved signal model — never string surgery scattered in logic:

  * topics/signals: ``plc/conv_simple_anomaly/context_model.cv101.json``
    (the human-approved CV-101 context model) + the topic constants in
    ``anomaly_rules.py``.
  * normalized tag paths: ``tools/seeds/approved_tags_conveyor.sql``
    (``normalized_tag_path`` column — the exact allowlist key).

Unmapped/unapproved tag paths are EXCLUDED and counted; they never enter a
snapshot. Mission rule: an unapproved tag must not become trusted context.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Union

from .anomaly_rules import DEFAULT_CFG

# ─── CV-101 mapping: normalized_tag_path -> rules topic ────────────────────
# Sources: context_model.cv101.json "signals" (topic column) x
# approved_tags_conveyor.sql (normalized_tag_path column). Multiple raw tags
# may feed one topic (Conveyor/, Mira_Monitored/, MIRA_IOCheck/ folders expose
# overlapping signals); the snapshot keeps the latest value per topic.
#
# Deliberately EXCLUDED (approved but not rule inputs in engineering units):
# *_Raw register mirrors, Cycle_Counter/Item_Count/Uptime_Seconds, Conv_State,
# Heartbeat, System_Ready, Speed_Cmd, Raw_I*/Raw_O*, VFD_Poll_*. NOTE: no
# approved tag exposes DI_03 (e-stop NO channel), so A3's dual-channel-mismatch
# arm cannot be fed from tag_events yet — only its wiring-fault-flag arm.
CV101_TAG_TOPIC_MAP: dict[str, str] = {
    # motor
    "default_conveyor_motor_running": "motor/m101/running",
    "default_mira_monitored_conveyor_demo_motor_running": "motor/m101/running",
    # VFD comm trust gate
    "default_conveyor_vfd_comm_ok": "vfd/vfd101/comm_ok",
    "default_mira_iocheck_vfd_vfd_comm_ok": "vfd/vfd101/comm_ok",
    # safety
    "default_conveyor_estop_active": "safety/estop",
    "default_mira_monitored_conveyor_demo_estop_active": "safety/estop",
    "default_conveyor_estop_wiring_fault": "safety/wiring",
    "default_mira_iocheck_inputs_di_02": "plc/di/di02_estop_nc",
    "default_mira_iocheck_inputs_di_05": "plc/di/di05_photoeye",
    "default_mira_iocheck_vfd_pe_latched": "safety/pe_latched",
    # direction
    "default_conveyor_dir_fwd": "plc/di/di00_fwd",
    "default_conveyor_dir_rev": "plc/di/di01_rev",
    # VFD telemetry
    "default_conveyor_vfd_hz": "vfd/vfd101/freq",
    "default_mira_monitored_conveyor_demo_vfd_hz": "vfd/vfd101/freq",
    "default_mira_iocheck_vfd_vfd_frequency": "vfd/vfd101/freq",
    "default_conveyor_vfd_amps": "vfd/vfd101/current_a",
    "default_mira_monitored_conveyor_demo_motor_current_a": "vfd/vfd101/current_a",
    "default_mira_iocheck_vfd_vfd_current": "vfd/vfd101/current_a",
    "default_conveyor_vfd_dcbus_v": "vfd/vfd101/dc_bus_v",
    "default_mira_iocheck_vfd_vfd_dc_bus": "vfd/vfd101/dc_bus_v",
    "default_conveyor_vfd_cmdword": "vfd/vfd101/cmd_word",
    "default_mira_iocheck_vfd_vfd_cmd_word": "vfd/vfd101/cmd_word",
    "default_conveyor_vfd_faultcode": "vfd/vfd101/fault_code",
    "default_mira_iocheck_vfd_vfd_fault_code": "vfd/vfd101/fault_code",
    "default_conveyor_vfd_setpoint_hz": "vfd/vfd101/freq_setpoint",
    "default_mira_iocheck_vfd_vfd_freq_sp": "vfd/vfd101/freq_setpoint",
    "default_mira_iocheck_vfd_vfd_status_word": "vfd/vfd101/status_word",
}

_BOOL_TRUE = {"true", "t", "1", "on", "yes"}
_BOOL_FALSE = {"false", "f", "0", "off", "no"}


@dataclass
class MappedEvent:
    """One tag_events row translated into rules-topic space."""

    topic: str
    value: object  # bool | float | str per value_type coercion
    event_timestamp: float  # epoch seconds
    event_id: Optional[str] = None
    tag_path: str = ""


def parse_event_timestamp(raw: Union[float, int, str]) -> float:
    """Epoch seconds from a tag_events event_timestamp (epoch or ISO-8601)."""
    if isinstance(raw, (int, float)):
        return float(raw)
    text = str(raw).strip()
    try:
        return float(text)
    except ValueError:
        pass
    # ISO-8601 (what JSON fixtures / DB extracts carry).
    return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()


def coerce_value(raw: object, value_type: str) -> object:
    """tag_events stores value as TEXT + value_type; rules need typed values.

    bool -> Python bool (rules test ``is False`` / ``is True``); int/float ->
    float (``18.0 in (18, 34)`` is True, so cmd-word membership still works);
    string/enum -> str. Unparseable values return None (rules degrade silently
    on None, same as an absent signal).
    """
    if raw is None:
        return None
    if value_type == "bool":
        if isinstance(raw, bool):
            return raw
        text = str(raw).strip().lower()
        if text in _BOOL_TRUE:
            return True
        if text in _BOOL_FALSE:
            return False
        return None
    if value_type in ("int", "float"):
        try:
            return float(raw)
        except (TypeError, ValueError):
            return None
    return str(raw)


_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def normalize_tag_path(raw: str) -> str:
    """Mirror of mira-relay/ingest_contract.normalize_tag_path (the
    approved_tags match key): lowercase, runs of non-alphanumerics -> '_',
    trimmed. Inlined rather than imported because the run_engine cannot depend
    on the relay package (same precedent as the relay inlining uns.slug).

    tag_events rows store the RAW source path (e.g.
    ``[default]MIRA_IOCheck/VFD/vfd_comm_ok``) while CV101_TAG_TOPIC_MAP keys
    are normalized — without this, every prod row counted as unmapped and no
    state window ever derived (found on the 2026-07-03 CV-101 live proof).
    Normalized input is a fixed point, so pre-normalized fixtures still match.
    """
    return _NON_ALNUM.sub("_", raw.strip().lower()).strip("_")


def map_events(
    rows: list[dict], mapping: dict[str, str]
) -> tuple[list[MappedEvent], dict[str, int]]:
    """Translate tag_events-shaped rows into MappedEvents, oldest first.

    Rows are matched by ``normalize_tag_path(tag_path)`` so both raw source
    paths (what the relay stores in tag_events) and pre-normalized paths map.

    Returns ``(mapped_events, unmapped_tags)`` where ``unmapped_tags`` counts
    the rows whose tag_path is not in the approved mapping — those rows are
    EXCLUDED and never reach a snapshot.
    """
    mapped: list[MappedEvent] = []
    unmapped: dict[str, int] = {}
    for row in rows:
        tag_path = row.get("tag_path", "")
        topic = mapping.get(normalize_tag_path(tag_path))
        if topic is None:
            unmapped[tag_path] = unmapped.get(tag_path, 0) + 1
            continue
        mapped.append(
            MappedEvent(
                topic=topic,
                value=coerce_value(row.get("value"), row.get("value_type", "string")),
                event_timestamp=parse_event_timestamp(row.get("event_timestamp", 0.0)),
                event_id=row.get("event_id"),
                tag_path=tag_path,
            )
        )
    mapped.sort(key=lambda e: e.event_timestamp)
    return mapped, unmapped


def build_snapshot(events: list[MappedEvent]) -> dict:
    """Latest value per topic — the ``snap`` dict rules_core.evaluate reads."""
    snap: dict = {}
    for e in events:  # events are oldest-first; later values win
        snap[e.topic] = e.value
    return snap


def derived_facts(
    events: list[MappedEvent], *, now: Optional[float] = None, cfg: Optional[dict] = None
) -> dict:
    """Temporal facts the rules read: ``max_stale_s`` and ``cmd_run_for_s``.

    ``cmd_run_for_s`` = seconds since the cmd word last transitioned INTO a
    RUN value (18/34) and stayed there through the end of the window; 0 when
    the latest cmd word is not a RUN value.
    """
    merged = dict(DEFAULT_CFG)
    if cfg:
        merged.update(cfg)
    run_values = merged["run_cmd_values"]

    if not events:
        return {"max_stale_s": 0.0, "cmd_run_for_s": 0.0}
    end = now if now is not None else events[-1].event_timestamp

    max_stale_s = max(0.0, end - events[-1].event_timestamp)

    cmd_run_since: Optional[float] = None
    cmd_is_run = False
    for e in events:
        if e.topic != "vfd/vfd101/cmd_word":
            continue
        is_run = isinstance(e.value, (int, float)) and e.value in run_values
        if is_run and not cmd_is_run:
            cmd_run_since = e.event_timestamp
        elif not is_run:
            cmd_run_since = None
        cmd_is_run = is_run
    cmd_run_for_s = (end - cmd_run_since) if (cmd_is_run and cmd_run_since is not None) else 0.0

    return {"max_stale_s": max_stale_s, "cmd_run_for_s": max(0.0, cmd_run_for_s)}
