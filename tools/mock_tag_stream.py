"""Mock tag stream — YAML-driven conveyor simulator for Phases 5/9/12.

Reads a YAML scenario file, maintains a prev/curr snapshot on a tick loop,
detects rising_edge / falling_edge / value_changed / fault_window_open /
fault_window_close events, and POSTs relay batches (``type:"tags"``) to
``mira-relay /ingest`` using the same payload shape as ``demo_plc_poller.py``.

This module is the conceptual successor to ``tools/demo_plc_simulator.py`` (a
Modbus server) for cases where no PLC is available. It is a pure event
emitter — it does NOT depend on pymodbus or psycopg.

CLI usage
=========
    python -m tools.mock_tag_stream \\
        --scenario tools/scenarios/conveyor_normal.yaml \\
        --relay-url http://localhost:8765 \\
        --tick-ms 200

    # Dry-run (no relay POST, print events to stdout) — for tests:
    python -m tools.mock_tag_stream \\
        --scenario tools/scenarios/conveyor_flicker.yaml \\
        --dry-run --once

Payload shape
=============
Each tick POSTs one batch matching ``demo_plc_poller._build_relay_payload``:

    {
      "type": "tags",
      "tenant_id": "<tenant>",
      "agent_id": "mock-tag-stream",
      "equipment": {
        "<equipment_id>": {
          "<tag_name>": {"v": <float>, "q": "Good", "t": "YYYY-MM-DD HH:MM:SS"}
        }
      }
    }

Events are computed locally (for dry-run output / logging).  They are NOT
posted to /ingest — the relay derives them via Phase 5 diff_logger.

Scenario schema is documented in ``tools/scenarios/conveyor_normal.yaml``.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import math
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx
import yaml

logger = logging.getLogger("mira-mock-stream")

AGENT_ID = "mock-tag-stream"
DEFAULT_TENANT_ID = "garage-demo"
DEFAULT_EQUIPMENT_ID = "CONV-001"

# ---------------------------------------------------------------------------
# Scenario data-classes
# ---------------------------------------------------------------------------


@dataclass
class TagDef:
    name: str
    type: str           # bool | int | float | fault
    uns_topic: str
    plc_tag: str
    # Behavior params (optional in YAML — defaults applied in _load_scenario)
    nominal: float = 0.0                    # steady-state value for bool/int/float
    ramp_start: float | None = None         # numeric: ramp from this value…
    ramp_end: float | None = None           # …to this value (over ramp_ticks ticks)
    ramp_ticks: int = 50                    # ticks to complete ramp
    cycle_period_ticks: int | None = None   # bool: toggle every N ticks
    noise_amplitude: float = 0.0            # float: ±noise on each tick
    fault_code: str = ""                    # fault: the F/CE code string
    severity: str = "warning"              # fault: initial severity


@dataclass
class FaultInjection:
    tag: str
    open_tick: int      # tick index when fault opens (tag → 1)
    close_tick: int     # tick index when fault clears (tag → 0)


@dataclass
class FlickerInjection:
    tag: str
    start_tick: int         # tick index of first drop
    drops: int              # number of falling edges to inject
    interval_ticks: int     # ticks between each drop/rise pair


@dataclass
class Scenario:
    name: str
    equipment_id: str
    tenant_id: str
    tags: list[TagDef]
    faults: list[FaultInjection]
    flickers: list[FlickerInjection]
    total_ticks: int        # 0 = infinite (use with --once to run to timeline end)


# ---------------------------------------------------------------------------
# YAML loading
# ---------------------------------------------------------------------------


def _load_scenario(path: str) -> Scenario:
    with open(path) as fh:
        raw = yaml.safe_load(fh)

    name = raw.get("name", os.path.basename(path))
    equipment_id = raw.get("equipment_id", DEFAULT_EQUIPMENT_ID)
    tenant_id = raw.get("tenant_id", DEFAULT_TENANT_ID)
    total_ticks = int(raw.get("total_ticks", 0))

    tags: list[TagDef] = []
    for t in raw.get("tags", []):
        td = TagDef(
            name=t["name"],
            type=t["type"],
            uns_topic=t.get("uns_topic", f"demo/training/conveyor001/{t['name']}"),
            plc_tag=t.get("plc_tag", t["name"]),
            nominal=float(t.get("nominal", 0.0)),
            ramp_start=float(t["ramp_start"]) if "ramp_start" in t else None,
            ramp_end=float(t["ramp_end"]) if "ramp_end" in t else None,
            ramp_ticks=int(t.get("ramp_ticks", 50)),
            cycle_period_ticks=int(t["cycle_period_ticks"]) if "cycle_period_ticks" in t else None,
            noise_amplitude=float(t.get("noise_amplitude", 0.0)),
            fault_code=str(t.get("fault_code", t["name"])),
            severity=str(t.get("severity", "warning")),
        )
        tags.append(td)

    faults: list[FaultInjection] = []
    for f in raw.get("faults", []):
        faults.append(FaultInjection(
            tag=f["tag"],
            open_tick=int(f["open_tick"]),
            close_tick=int(f["close_tick"]),
        ))

    flickers: list[FlickerInjection] = []
    for fl in raw.get("flickers", []):
        flickers.append(FlickerInjection(
            tag=fl["tag"],
            start_tick=int(fl["start_tick"]),
            drops=int(fl["drops"]),
            interval_ticks=int(fl["interval_ticks"]),
        ))

    return Scenario(
        name=name,
        equipment_id=equipment_id,
        tenant_id=tenant_id,
        tags=tags,
        faults=faults,
        flickers=flickers,
        total_ticks=total_ticks,
    )


# ---------------------------------------------------------------------------
# Value computation per tick
# ---------------------------------------------------------------------------


def _compute_values(
    scenario: Scenario,
    tick: int,
    fault_overrides: dict[str, float],
    flicker_overrides: dict[str, float],
) -> dict[str, float]:
    """Return {tag_name: float} for this tick based on scenario definitions."""
    values: dict[str, float] = {}

    for td in scenario.tags:
        if td.type == "fault":
            # Fault tags: override wins (1=open, 0=closed); default = nominal (0)
            if td.name in fault_overrides:
                values[td.name] = fault_overrides[td.name]
            else:
                values[td.name] = td.nominal
            continue

        if td.type == "bool":
            # Flicker override wins first, then fault_overrides (used to drive
            # mirror bools like fault_alarm alongside a fault-type tag), then
            # the normal cycle/nominal logic.
            if td.name in flicker_overrides:
                values[td.name] = flicker_overrides[td.name]
            elif td.name in fault_overrides:
                values[td.name] = fault_overrides[td.name]
            elif td.cycle_period_ticks is not None and td.cycle_period_ticks > 0:
                # Steady bool cycle: alternate on/off by period
                half = td.cycle_period_ticks // 2
                cycle_pos = tick % td.cycle_period_ticks
                values[td.name] = 1.0 if cycle_pos < half else 0.0
            else:
                values[td.name] = td.nominal
            continue

        # Numeric: int or float
        if td.ramp_start is not None and td.ramp_end is not None:
            # Linear ramp until ramp_ticks, then hold at ramp_end
            t = min(tick, td.ramp_ticks)
            frac = t / td.ramp_ticks if td.ramp_ticks > 0 else 1.0
            base = td.ramp_start + (td.ramp_end - td.ramp_start) * frac
        else:
            base = td.nominal

        # Add noise if configured (deterministic sine so output is reproducible)
        if td.noise_amplitude > 0.0:
            base += td.noise_amplitude * math.sin(tick * 0.7)

        values[td.name] = round(base, 4)

    return values


# ---------------------------------------------------------------------------
# Event detection (matches demo_plc_poller.detect_events + D4 fault events)
# ---------------------------------------------------------------------------


@dataclass
class Snapshot:
    timestamp: datetime
    values: dict[str, float] = field(default_factory=dict)


# Per-fault open-tick tracker (module-level for simplicity in a single run)
_fault_open_ts: dict[str, datetime] = {}


def detect_events(
    prev: Snapshot | None,
    curr: Snapshot,
    tag_by_name: dict[str, TagDef],
) -> list[dict[str, Any]]:
    """Emit events matching demo_plc_poller vocabulary + D4 fault_window types.

    Event dict keys: topic, plc_tag, equipment_id, event_type,
    prev_value, new_value, occurred_at (ISO string).
    Fault events also include: fault_code, severity, window_start.
    """
    if prev is None:
        return []

    events: list[dict[str, Any]] = []

    for name, new_val in curr.values.items():
        old_val = prev.values.get(name)
        if old_val is None or old_val == new_val:
            continue

        td = tag_by_name.get(name)
        if td is None:
            continue

        ts_str = curr.timestamp.isoformat()

        if td.type == "fault":
            if old_val == 0.0 and new_val != 0.0:
                # fault_window_open
                _fault_open_ts[name] = curr.timestamp
                events.append({
                    "topic": td.uns_topic,
                    "plc_tag": td.plc_tag,
                    "equipment_id": DEFAULT_EQUIPMENT_ID,  # overridden by caller
                    "event_type": "fault_window_open",
                    "prev_value": old_val,
                    "new_value": new_val,
                    "occurred_at": ts_str,
                    "fault_code": td.fault_code,
                    "severity": td.severity,
                    "window_start": ts_str,
                })
            elif old_val != 0.0 and new_val == 0.0:
                # fault_window_close
                open_ts = _fault_open_ts.pop(name, curr.timestamp)
                events.append({
                    "topic": td.uns_topic,
                    "plc_tag": td.plc_tag,
                    "equipment_id": DEFAULT_EQUIPMENT_ID,
                    "event_type": "fault_window_close",
                    "prev_value": old_val,
                    "new_value": new_val,
                    "occurred_at": ts_str,
                    "fault_code": td.fault_code,
                    "window_end": ts_str,
                    "window_start": open_ts.isoformat(),
                })
        elif td.type == "bool":
            event_type = "rising_edge" if new_val > old_val else "falling_edge"
            events.append({
                "topic": td.uns_topic,
                "plc_tag": td.plc_tag,
                "equipment_id": DEFAULT_EQUIPMENT_ID,
                "event_type": event_type,
                "prev_value": old_val,
                "new_value": new_val,
                "occurred_at": ts_str,
            })
        else:
            # int / float → value_changed
            events.append({
                "topic": td.uns_topic,
                "plc_tag": td.plc_tag,
                "equipment_id": DEFAULT_EQUIPMENT_ID,
                "event_type": "value_changed",
                "prev_value": old_val,
                "new_value": new_val,
                "occurred_at": ts_str,
            })

    return events


# ---------------------------------------------------------------------------
# Relay payload builder (matches demo_plc_poller._build_relay_payload exactly)
# ---------------------------------------------------------------------------


def _build_relay_payload(
    snapshot: Snapshot,
    scenario: Scenario,
) -> dict[str, Any]:
    t = snapshot.timestamp.strftime("%Y-%m-%d %H:%M:%S")
    tags: dict[str, dict[str, Any]] = {}
    for name, val in snapshot.values.items():
        tags[name] = {"v": val, "q": "Good", "t": t}
    return {
        "type": "tags",
        "tenant_id": scenario.tenant_id,
        "agent_id": AGENT_ID,
        "equipment": {scenario.equipment_id: tags},
    }


# ---------------------------------------------------------------------------
# Main runner
# ---------------------------------------------------------------------------


async def _run(
    scenario: Scenario,
    relay_url: str | None,
    relay_api_key: str | None,
    tick_ms: int,
    dry_run: bool,
    once: bool,
) -> int:
    tag_by_name: dict[str, TagDef] = {td.name: td for td in scenario.tags}

    # Build fault injection map: tick → {tag: 1.0 or 0.0}
    fault_schedule: dict[int, dict[str, float]] = {}
    for fi in scenario.faults:
        fault_schedule.setdefault(fi.open_tick, {})[fi.tag] = 1.0
        fault_schedule.setdefault(fi.close_tick, {})[fi.tag] = 0.0

    # Build flicker injection map: tick → {tag: value}
    flicker_schedule: dict[int, dict[str, float]] = {}
    for fl in scenario.flickers:
        for i in range(fl.drops):
            drop_tick = fl.start_tick + i * fl.interval_ticks
            rise_tick = drop_tick + max(1, fl.interval_ticks // 2)
            flicker_schedule.setdefault(drop_tick, {})[fl.tag] = 0.0
            flicker_schedule.setdefault(rise_tick, {})[fl.tag] = 1.0

    prev_snapshot: Snapshot | None = None
    fault_state: dict[str, float] = {}   # current override state per fault tag
    flicker_state: dict[str, float] = {} # current override state per flicker tag
    total_events = 0

    # Determine when to stop for --once
    max_tick: int | None = None
    if once:
        # Run to the end of the last scheduled event, or total_ticks, or 200 ticks minimum
        all_ticks = list(fault_schedule.keys()) + list(flicker_schedule.keys())
        max_tick = max(all_ticks) + 5 if all_ticks else (scenario.total_ticks or 200)
        max_tick = max(max_tick, scenario.total_ticks or 0, 10)

    http: httpx.AsyncClient | None = None
    if not dry_run and relay_url:
        http = httpx.AsyncClient(timeout=10.0)

    try:
        tick = 0
        while True:
            if max_tick is not None and tick > max_tick:
                break
            if not once and scenario.total_ticks > 0 and tick >= scenario.total_ticks:
                tick = 0  # loop the scenario
                fault_state.clear()
                flicker_state.clear()
                prev_snapshot = None

            # Apply scheduled overrides for this tick
            for tag, val in fault_schedule.get(tick, {}).items():
                fault_state[tag] = val
            for tag, val in flicker_schedule.get(tick, {}).items():
                flicker_state[tag] = val

            values = _compute_values(scenario, tick, fault_state, flicker_state)
            now = datetime.now(timezone.utc)
            curr_snapshot = Snapshot(timestamp=now, values=values)

            events = detect_events(prev_snapshot, curr_snapshot, tag_by_name)

            # Fix equipment_id in events (uses scenario value, not the module constant)
            for ev in events:
                ev["equipment_id"] = scenario.equipment_id

            total_events += len(events)

            if dry_run:
                # Print snapshot and events to stdout
                t_str = now.strftime("%H:%M:%S.%f")[:-3]
                if events:
                    for ev in events:
                        print(f"[{t_str}] tick={tick:4d}  {ev['event_type']:22s}  "
                              f"tag={ev['plc_tag']:20s}  "
                              f"{ev.get('prev_value','')}→{ev['new_value']}")
                elif tick == 0:
                    # First tick: print the baseline snapshot summary
                    print(f"[{t_str}] tick={tick:4d}  (baseline snapshot — "
                          f"{len(values)} tags seeded, events begin tick 1+)")
            else:
                if http is not None and relay_url:
                    payload = _build_relay_payload(curr_snapshot, scenario)
                    headers: dict[str, str] = {}
                    if relay_api_key:
                        headers["Authorization"] = f"Bearer {relay_api_key}"
                    try:
                        resp = await http.post(
                            f"{relay_url.rstrip('/')}/ingest",
                            json=payload,
                            headers=headers,
                        )
                        resp.raise_for_status()
                        if events:
                            logger.debug("tick=%d posted %d tags, %d events", tick, len(values), len(events))
                    except httpx.HTTPError as exc:
                        logger.warning("relay POST failed tick=%d: %s", tick, exc)
                if events:
                    for ev in events:
                        logger.info("event %s tag=%s %s→%s",
                                    ev["event_type"], ev["plc_tag"],
                                    ev.get("prev_value"), ev["new_value"])

            prev_snapshot = curr_snapshot
            tick += 1

            if max_tick is not None and tick > max_tick:
                break

            await asyncio.sleep(tick_ms / 1000.0)

    finally:
        if http is not None:
            await http.aclose()

    if dry_run:
        print(f"\n[done] scenario={scenario.name!r}  ticks={tick}  events={total_events}")
    else:
        logger.info("done scenario=%r ticks=%d events=%d", scenario.name, tick, total_events)

    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="YAML-driven mock tag stream — emits relay batches without a PLC.",
    )
    p.add_argument(
        "--scenario",
        required=True,
        metavar="PATH",
        help="Path to a YAML scenario file (e.g. tools/scenarios/conveyor_normal.yaml)",
    )
    p.add_argument(
        "--relay-url",
        default=os.getenv("MIRA_RELAY_URL", "http://localhost:8765"),
        help="mira-relay base URL (default: env MIRA_RELAY_URL or http://localhost:8765)",
    )
    p.add_argument(
        "--relay-api-key",
        default=os.getenv("RELAY_API_KEY"),
        help="Bearer token for mira-relay (default: env RELAY_API_KEY)",
    )
    p.add_argument(
        "--tick-ms",
        type=int,
        default=200,
        metavar="MS",
        help="Tick interval in milliseconds (default: 200)",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Print events to stdout; skip relay POST",
    )
    p.add_argument(
        "--once",
        action="store_true",
        help="Run through the scenario timeline once then exit (useful for tests)",
    )
    p.add_argument(
        "--log-level",
        default=os.getenv("LOG_LEVEL", "INFO"),
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    try:
        scenario = _load_scenario(args.scenario)
    except (OSError, yaml.YAMLError, KeyError, ValueError) as exc:
        logger.error("Failed to load scenario %r: %s", args.scenario, exc)
        return 1

    logger.info(
        "Loaded scenario=%r equipment=%s tags=%d faults=%d flickers=%d",
        scenario.name, scenario.equipment_id, len(scenario.tags),
        len(scenario.faults), len(scenario.flickers),
    )

    try:
        return asyncio.run(
            _run(
                scenario=scenario,
                relay_url=args.relay_url if not args.dry_run else None,
                relay_api_key=args.relay_api_key,
                tick_ms=args.tick_ms,
                dry_run=args.dry_run,
                once=args.once,
            )
        )
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
