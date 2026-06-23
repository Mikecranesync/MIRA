"""Live telemetry layer for the ProveIt bottling plant.

Runs the simulated PLCs for a bounded number of ticks and emits on-change tag events:
  * JSONL is ALWAYS written (the deterministic local record / fallback).
  * When MQTT is enabled, each event is ALSO published to its asset's UNS topic via the existing
    in-memory broker (mqtt_uns.broker) — no external broker, no cloud.

If the live supervised Conv_Simple cell is requested but offline (the normal case), a single evidence
SNAPSHOT event is appended (source=live_supervised_cell, quality=snapshot) — never fabricated live data.

Deterministic: virtual clock (sim_plc.BASE_EPOCH + tick), on-change emission, stable ordering.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEMO = HERE.parent
ROOT = DEMO.parent
for _p in (str(HERE), str(DEMO), str(ROOT / "mqtt_uns")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import bottling_demo as bd  # noqa: E402
import broker as bk  # noqa: E402  (mqtt_uns.broker)
import sim_plc as sp  # noqa: E402

REPORTS = HERE / "reports"
JSONL_PATH = REPORTS / "telemetry_events.jsonl"


def event_topic(uns: str) -> str:
    return uns.replace(".", "/") + "/events"


def _iso(ts_epoch: int) -> str:
    return datetime.fromtimestamp(ts_epoch, timezone.utc).isoformat()


def _asset_by_key(assets: list, key: str) -> dict:
    return next(a for a in assets if a["key"] == key)


def run_telemetry(scenario_id: str, ticks: int, mqtt: bool, live_cell: bool) -> dict:
    """Generate telemetry for `ticks` cycles of `scenario_id`. Returns a summary dict."""
    assets_doc = bd.load_assets()
    assets = assets_doc["assets"]
    scn = sp.scenario_def(scenario_id)
    plcs = sp.build_plcs(assets)

    events: list = []
    prev: dict = {}
    for n in range(ticks):
        ts = sp.BASE_EPOCH + n * sp.TICK_SECONDS
        for plc in plcs:
            vals = plc.tick(n, scn)
            for tag, val in vals.items():
                pk = (plc.asset["key"], tag)
                if prev.get(pk, "__nil__") == val:
                    continue  # on-change only
                prev[pk] = val
                ev = {
                    "timestamp": _iso(ts),
                    "ts_epoch": ts,
                    "tick": n,
                    "asset_id": plc.asset["key"],
                    "uns_path": plc.asset["uns"],
                    "tag_name": tag,
                    "value": val,
                    "quality": "good",
                    "source": "sim_plc",
                }
                if scenario_id != "normal":
                    ev["scenario_id"] = scenario_id
                events.append(ev)

    # Live supervised cell — snapshot only (bench is supervised, not 24/7).
    live_status = "not_requested"
    if live_cell:
        cell = _asset_by_key(assets, "conv_simple.photoeye_pe101")
        online = bd.live_cell_available()
        live_status = "online" if online else "offline_snapshot"
        events.append({
            "timestamp": _iso(sp.BASE_EPOCH),
            "ts_epoch": sp.BASE_EPOCH,
            "tick": 0,
            "asset_id": cell["key"],
            "uns_path": cell["uns"],
            "tag_name": "di05_photoeye",
            "value": True,  # PE-101 blocked (the flagship evidence snapshot)
            "quality": "good" if online else "snapshot",
            "source": "live_supervised_cell",
            "scenario_id": "pe101_blocked",
            "note": "supervised bench" + ("" if online else " offline — evidence snapshot, not live feed"),
        })

    # Always write the deterministic JSONL record.
    REPORTS.mkdir(exist_ok=True)
    with JSONL_PATH.open("w", encoding="utf-8") as fh:
        for ev in events:
            fh.write(json.dumps(ev, ensure_ascii=False, sort_keys=True) + "\n")

    # Optionally publish through the in-memory MQTT broker (proves the pathway; no external broker).
    published = 0
    if mqtt:
        transport = bk.InMemoryBroker()
        delivered_box = {"n": 0}
        transport.subscribe("#", lambda t, p: delivered_box.__setitem__("n", delivered_box["n"] + 1))
        for ev in events:
            published += transport.publish(event_topic(ev["uns_path"]), json.dumps(ev, sort_keys=True))

    return {
        "scenario": scenario_id,
        "ticks": ticks,
        "events": len(events),
        "jsonl": str(JSONL_PATH.relative_to(ROOT)),
        "mqtt": "published" if mqtt else "off (JSONL only)",
        "mqtt_published": published,
        "live_cell": live_status,
    }
