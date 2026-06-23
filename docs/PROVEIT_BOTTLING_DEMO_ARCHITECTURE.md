# ProveIt Bottling Factory Demo — Architecture

**A simulated bottling plant with the REAL Conv_Simple garage conveyor embedded as a supervised live
cell.** Unified by one UNS/MQTT namespace, visualized by the FactoryLM Hub, explained by MIRA with
evidence-backed answer cards. Deterministic; no cloud/API for a demo run; no unsafe PLC writes; no new
protocol integrations.

## The two layers

| Layer | What | Mode | UNS root |
|---|---|---|---|
| **Simulated bottling plant** | tanks, mixer, filler, capper, labeler, case packer — deterministic scenarios | `simulated`, 24/7, no supervision | `enterprise.proveit.bottling.plant1` |
| **Live Conv_Simple cell** | the real bench: Micro820 + GS10 + PE-101 photoeye + motor + conveyor | `live_supervised_bench`, **not 24/7**, **requires supervision** | embedded at `…plant1.packaging.conv_simple` (native: `enterprise.proveit.bench.conv_simple`) |

The Conv_Simple cell is a **real, supervised bench asset, not 24/7 production**. It appears in the plant
namespace as a packaging cell, but it carries `requires_supervision: true` and `runs_24_7: false`, and a
demo run never depends on it being online (see "Degradation").

## Components

```
 Simulated assets ┐
                  ├─ assets.json (one registry) ── UNS/MQTT namespace ── FactoryLM Hub bundle
 Live Conv_Simple ┘                                       │
        │                                                 │  (visualization, optional locally)
        └─ evidence_links.json ── demo/evidence/ (REAL manuals, no duplication)
                  │
 scenarios.json (sim + live faults) ── MIRA answer cards (evidence-backed) ── MQTT round trip (mqtt_uns.broker)
```

- **`demo/proveit_bottling/assets.json`** — the unified asset registry (simulated + Conv_Simple), with
  hierarchy, UNS paths, MQTT topics, supervision flags, and evidence references.
- **`demo/proveit_bottling/evidence_links.json`** — links each Conv_Simple asset to the EXISTING
  `demo/evidence/` (manifest, answer card, MQTT report). **No duplication** — references only.
- **`demo/proveit_bottling/scenarios.json`** — deterministic fault scenarios: simulated (filler jam,
  capper fault, …) and live (PE-101 blocked, GS10 fault). Each maps to an asset, tags, evidence, an
  answer card, and review notes.
- **`demo/proveit_bottling/exports/proveit_bottling_factorylm_bundle.json`** — a self-describing
  FactoryLM Hub bundle (assets + scenarios + evidence links + UNS map + supervision flags). The Hub is
  optional locally; the bundle IS the import payload (the "adapter" writes it; a real Hub would POST it).
- **`demo/proveit_bottling/run_proveit_demo.py`** — the runner: `--sim-only` (default), `--live-cell`,
  `--hub-export`, `--no-mqtt`.

## UNS / MQTT namespace

Every asset has a UNS path and a derived MQTT topic (`uns.replace(".", "/") + "/events"`), e.g.
`enterprise/proveit/bottling/plant1/filling/filler01/events`. The Conv_Simple cell shares the same
namespace under packaging, so simulated and live assets are addressable identically. Transport reuses
`mqtt_uns.broker.InMemoryBroker` (the one nervous-system path — no Ignition/OPC-UA/OpenPLC/Modbus).

## MIRA explanations

Each scenario produces a 9-section evidence-backed answer card. **Live Conv_Simple scenarios reuse the
existing `demo/conv_simple_demo.py` card** (real GS10/Micro820 manuals, the PE-101 procedure, the IO map
— real receipts). **Simulated scenarios** produce honest cards that say plainly the asset is *simulated*
and has *no OEM manual on file* — no invented manufacturers or part numbers.

## Degradation (supervised, not 24/7)

- **`--sim-only` (default):** the live cell is NOT exercised; the demo is fully deterministic.
- **`--live-cell`:** include the Conv_Simple cell. A probe (`live_cell_available()`, env
  `CONV_SIMPLE_LIVE_CELL=1`) decides online vs offline. If the supervised bench is offline (the normal
  case), the runner **WARNs and degrades to the evidence snapshot** — the demo still passes. A missing
  live cell never fails the demo.

## Safety / constraints honored

- Conv_Simple functionality untouched (`demo/run_demo.py` stays green; the bottling layer only
  *references* it).
- No cloud/API dependency for a deterministic run.
- No PLC writes, no new protocol integrations.
- Hub optional for local execution (the bundle is a file; importing it is the Hub's job).
- No invented models — simulated assets are labeled `SIMULATED`; the real photoeye/motor remain
  `UNKNOWN_MODEL`.

## Success

A user runs `python demo/proveit_bottling/run_proveit_demo.py --live-cell --hub-export` and sees: a
simulated bottling plant, a real supervised Conv_Simple cell, one UNS/MQTT namespace, a FactoryLM Hub
bundle, and MIRA explaining each fault with evidence-backed answer cards.

## Live telemetry layer (simulated PLCs → tags)

The simulated assets behave like simple PLCs (`sim_plc.py`): each has its own tag set, a cyclic state
update, a running/offline/fault status, counters/process values, and fault bits. `telemetry.py` runs them
for a bounded number of ticks on a **deterministic virtual clock** (`BASE_EPOCH + tick`) and emits
**on-change** tag events:

- **JSONL is always written** (`reports/telemetry_events.jsonl`) — the deterministic local record / fallback.
- **When MQTT is enabled**, each event is also published to its asset's UNS topic via the existing
  in-memory `mqtt_uns.broker` (no external broker, no cloud).

Each event carries: `timestamp`, `ts_epoch`, `tick`, `asset_id`, `uns_path`, `tag_name`, `value`,
`quality`, `source` (`sim_plc` | `live_supervised_cell`), and `scenario_id` when applicable. Scenarios:
`normal`, `filler_jam`, `capper_fault`, `downstream_blocked`, `recovery`.

## How this reaches Ignition (the HMI truth)

- **Ignition does NOT visualize PLCs; it visualizes _tags_.** Whatever produces the tags — a real PLC, a
  simulated PLC, MQTT, OPC-UA, or Modbus — Ignition just binds screens to tag paths.
- **Python simulated PLCs are the first milestone.** They emit the tag stream now, with zero hardware.
- **OpenPLC can be added later** for more controls realism (real ladder/ST execution) — optional, not
  required for this milestone.
- **Ignition consumes tags** from MQTT Engine / OPC / Modbus and renders the visual HMI. `ignition_export.py`
  generates the **tag contract** an Ignition project binds to (`ignition_tag_map.json` / `.csv`: asset,
  UNS path, suggested Ignition tag path, MQTT topic, tag name, data type, normal/fault meaning) plus a
  plain-English **HMI screen plan** (`ignition_hmi_plan.md`). No Ignition API is required to run the demo.

## CLI

```
python demo/proveit_bottling/run_proveit_demo.py \
    [--sim-only | --live-cell] [--hub-export] [--no-mqtt] \
    [--telemetry] [--ticks N] [--scenario normal|filler_jam|capper_fault|downstream_blocked|recovery] \
    [--ignition-export]
```

`--sim-only` stays the default and stays offline-deterministic. `--telemetry` runs the simulated live
telemetry for `--ticks N` (default 60); `--ignition-export` writes the tag map + HMI plan.

Generated artifacts (`reports/`): `demo_overview.md`, `asset_map.md`, `scenario_map.md`,
`hub_export_report.md`, `live_cell_report.md`, `telemetry_events.jsonl`, `ignition_tag_map.json` + `.csv`,
`ignition_hmi_plan.md`.

## The ProveIt story

A simulated bottling plant + a real supervised conveyor cell + one unified UNS + evidence-backed MIRA
answers — visualized in Ignition by binding to tags, not by talking to PLCs.
