"""Ignition-HMI readiness for the ProveIt bottling demo.

Generates (no Ignition API required):
  * ignition_tag_map.json / .csv — asset, UNS path, suggested Ignition tag path, MQTT topic, tag name,
    data type, normal/fault meaning. Covers every simulated asset AND the Conv_Simple cell.
  * ignition_hmi_plan.md — a plain-English HMI screen plan.

Ignition does NOT visualize PLCs; it visualizes TAGS. This module produces the tag contract an Ignition
project would bind to (MQTT Engine / OPC / Modbus all land as tags). Pure generation; deterministic.
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEMO = HERE.parent
ROOT = DEMO.parent
for _p in (str(HERE), str(DEMO)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import bottling_demo as bd  # noqa: E402
import conv_simple_demo as cs  # noqa: E402  (read-only — never modified)
import sim_plc as sp  # noqa: E402

REPORTS = HERE / "reports"
TAG_MAP_JSON = REPORTS / "ignition_tag_map.json"
TAG_MAP_CSV = REPORTS / "ignition_tag_map.csv"
HMI_PLAN = REPORTS / "ignition_hmi_plan.md"


def ignition_tag_path(uns: str, tag: str) -> str:
    """UNS path -> a suggested Ignition tag path ([provider]Folder/Sub/Tag), dropping the enterprise root."""
    parts = uns.split(".")[1:]  # drop 'enterprise'
    return "[default]" + "/".join(parts) + "/" + tag


def _row(asset_key, asset_name, uns, mqtt_topic, tag, data_type, normal, fault, source):
    return {
        "asset": asset_key,
        "asset_name": asset_name,
        "uns_path": uns,
        "ignition_tag_path": ignition_tag_path(uns, tag),
        "mqtt_topic": mqtt_topic,
        "tag_name": tag,
        "data_type": data_type,
        "normal_meaning": str(normal),
        "fault_meaning": str(fault),
        "source": source,
    }


def build_tag_map() -> list:
    assets = bd.load_assets()["assets"]
    rows: list = []

    # Simulated assets: full PLC tag set from sim_plc.
    for a in assets:
        if a.get("layer") != "simulated":
            continue
        spec = sp.KIND_SPECS.get(a["kind"])
        if not spec:
            continue
        for t in spec["tags"]:
            rows.append(_row(a["key"], a["name"], a["uns"], a["mqtt_topic"],
                             t["name"], t["data_type"], t["normal"], t["fault"], "sim_plc"))

    # Conv_Simple live cell: key tags from the existing conv_simple_demo (read-only).
    cell = next((a for a in assets if a["key"] == "conv_simple"), None)
    if cell:
        for tag, meta in cs.TAGS.items():
            # map the conv_simple tag's native uns onto the bottling cell namespace
            child_uns = cell["uns"] + "." + tag
            topic = child_uns.replace(".", "/") + "/events"
            normal = "nominal"
            fault = meta["desc"]
            rows.append(_row("conv_simple", "Conv_Simple cell", child_uns, topic,
                             tag, meta["type"], normal, fault, "live_supervised_cell"))
    return rows


def write_tag_map(rows: list) -> dict:
    REPORTS.mkdir(exist_ok=True)
    TAG_MAP_JSON.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    fields = ["asset", "asset_name", "uns_path", "ignition_tag_path", "mqtt_topic",
              "tag_name", "data_type", "normal_meaning", "fault_meaning", "source"]
    with TAG_MAP_CSV.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    return {"json": str(TAG_MAP_JSON.relative_to(ROOT)), "csv": str(TAG_MAP_CSV.relative_to(ROOT)), "tags": len(rows)}


HMI_PLAN_TEXT = """# Ignition HMI screen plan — ProveIt bottling

> Ignition does not visualize PLCs; it visualizes **tags**. Bind these screens to the tags in
> `ignition_tag_map.json` (delivered via MQTT Engine, OPC, or Modbus — your choice). This is a plan, not
> an Ignition project; no Ignition API is required to run the demo.

## 1. Main bottling overview
A line schematic left-to-right: Tank → Mixer → Filler → Capper → Labeler → Case Packer, with the
**Conv_Simple** packaging cell shown as a distinct supervised cell. Each block tinted by `status`
(running = normal, fault = alarm color). Top strip: line running count, total bottles, active alarms.

## 2. Asset status cards
One card per asset bound to its tags: `status`, `running`, the primary counter (e.g. `bottles_filled`),
the primary process value (e.g. `bottles_per_min`), and the fault bit. The Conv_Simple card is marked
**LIVE — supervised bench** with `requires_supervision`/`runs_24_7` badges.

## 3. Alarms panel
A table driven by the fault bits (`jam_detected`, `torque_fault`, `downstream_blocked`, `low_level`,
`overload`, `label_low`, and the Conv_Simple `vfd_fault_code` / photoeye). Columns: asset, alarm,
priority, time, state. No blink except an unacked high-priority alarm (ISA-18.2 / HP-HMI).

## 4. Live trends
Trend pens on the process values + counters (filler `bottles_per_min`, capper `cap_torque_inlb`,
case-packer `pack_rate`, tank `level_pct`). Sourced from the same tags the telemetry layer publishes.

## 5. MIRA evidence panel
An "Ask MIRA" panel that, on an alarm, shows the evidence-backed answer card (most-likely cause,
evidence for/against, manuals/receipts, technician checks, human-review). For Conv_Simple faults it
renders the REAL card from the evidence folder; for simulated faults it renders the scenario card.

## 6. Conv_Simple supervised cell panel
A dedicated panel for the real bench: GS10 VFD, Micro820 PLC, PE-101 photoeye, motor. Shows the live
(or snapshot) photoeye/VFD tags, the supervision flags, and a clear "supervised — not 24/7" banner so an
operator never treats it as a 24/7 production line.
"""


def write_hmi_plan() -> str:
    REPORTS.mkdir(exist_ok=True)
    HMI_PLAN.write_text(HMI_PLAN_TEXT, encoding="utf-8")
    return str(HMI_PLAN.relative_to(ROOT))


def export_all() -> dict:
    rows = build_tag_map()
    tm = write_tag_map(rows)
    plan = write_hmi_plan()
    assets_covered = sorted({r["asset"] for r in rows})
    return {"tag_map": tm, "hmi_plan": plan, "assets_covered": assets_covered}
