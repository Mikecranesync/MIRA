# Session 010 — ProveIt bottling factory with the Conv_Simple supervised live cell

**Date:** 2026-06-23
**Recorder:** Discovery Recorder (ProveIt demo track)
**Class of work:** demo extension (simulated plant + real supervised live cell)

> Embed the REAL Conv_Simple bench as a supervised live cell inside a larger simulated bottling plant,
> unified by one UNS/MQTT namespace, without breaking Conv_Simple (c4cabee7) or adding cloud/PLC/new-protocol deps.

## 1. Question

Can the existing Conv_Simple demo be wrapped into a bottling-plant demo where the conveyor is one
*supervised, not-24/7* cell among simulated assets — deterministically, Hub-optional, Conv_Simple untouched?

## 2. Files inspected / reused

- `demo/conv_simple_demo.py` (the real Conv_Simple card — REUSED, never modified), `demo/evidence/evidence_manifest.json` (referenced), `mqtt_uns/broker.py` (transport reused), `demo/run_demo.py` (must stay green).

## 3. Assumptions tested

| # | Assumption | Result |
|---|---|---|
| A1 | Conv_Simple needs editing to fit a plant. | **FAILED** → the bottling layer only *references* it (`use_conv_simple_card`). c4cabee7 stays green (subprocess test asserts `DEMO: OK`). |
| A2 | The live cell must be online for the demo. | **FAILED** → it is a *supervised bench, not 24/7*. `live_cell_available()` is OFF unless `CONV_SIMPLE_LIVE_CELL=1`; `--live-cell` WARNs + degrades to the evidence snapshot and still passes. |
| A3 | Simulated assets need a manufacturer to look real. | **FAILED (honesty)** → simulated assets are `model: SIMULATED`; their cards say "no OEM manual on file." The real photoeye/motor stay `UNKNOWN_MODEL`. No invented part numbers. |
| A4 | `select_scenarios(live)` returning [] for live in sim-only was fine. | **BUG (test caught)** → it dropped the skipped list so sim-only showed nothing skipped. Fixed: always return both lists; caller decides. |

## 4. Decisions

- New `demo/proveit_bottling/`: `assets.json` (6 simulated + Conv_Simple cell + 5 children, unified UNS),
  `evidence_links.json` (references demo/evidence/, no duplication), `scenarios.json` (sim: filler_jam,
  capper_fault; live: pe101_blocked [reuses the real card], gs10_fault), `bottling_demo.py`, `hub_bundle.py`
  (offline Hub adapter), `run_proveit_demo.py` (`--sim-only`/`--live-cell`/`--hub-export`/`--no-mqtt`).
- One UNS/MQTT namespace; `mqtt_topic == uns.replace('.', '/') + '/events'` for every asset; transport is the
  same `mqtt_uns.broker` (no Ignition/OPC-UA/OpenPLC/Modbus).

## 5. Reusable findings / risks

- The "missing live cell doesn't fail" pattern = a probe defaulting OFF + degrade-to-snapshot. Risk: a future
  surface that *requires* the bench would break determinism — keep the probe default OFF.
- Conv_Simple stays the single source of the real card; the bottling demo never re-authors it (no drift).

## 6. Validation

`run_demo.py` → DEMO: OK (Conv_Simple unbroken). `run_proveit_demo.py --sim-only` and `--live-cell --hub-export`
→ PROVEIT BOTTLING: OK. 32/32 demo tests (17 conv_simple + 15 bottling). ruff clean. Reports:
`demo/proveit_bottling/reports/{demo_overview,asset_map,scenario_map,hub_export_report,live_cell_report}.md`
+ `exports/proveit_bottling_factorylm_bundle.json`.

## 7. Tests / fixtures

`demo/proveit_bottling/tests/test_proveit_bottling.py` (15): Conv_Simple still passes (subprocess), sim-only
excludes live, live-cell optional+supervised+degrades, missing live cell doesn't fail, Hub bundle builds,
evidence links resolve in the real manifest, no invented models, UNS topics exist for all assets, MQTT
preserves the card. No licensed data.
