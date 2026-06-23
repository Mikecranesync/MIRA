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
