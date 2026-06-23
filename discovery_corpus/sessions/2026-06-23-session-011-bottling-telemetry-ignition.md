# Session 011 — bottling live telemetry + Ignition-HMI readiness

**Date:** 2026-06-23
**Recorder:** Discovery Recorder (ProveIt demo track)
**Class of work:** demo extension (simulated PLCs → tags → telemetry + Ignition tag map / HMI plan)

> Make demo/proveit_bottling a realistic live-telemetry demo where Python simulated PLCs publish plant
> state for Ignition/HMI, while preserving the deterministic offline demo and the real Conv_Simple cell.

## 1. Question

Can simulated PLCs emit a live tag stream (MQTT or deterministic JSONL) and an Ignition-ready tag map +
HMI plan, without breaking Conv_Simple, without a real clock/cloud, and with the default run still offline?

## 2. Decisions / assumptions

| # | Decision | Why |
|---|---|---|
| A1 | Deterministic **virtual clock** (`BASE_EPOCH + tick`), not wall clock. | The DoD requires deterministic JSONL; tests assert byte-identical reruns. `datetime.fromtimestamp(ts, UTC)` is a pure function of the virtual epoch. |
| A2 | **On-change** emission (initial snapshot at tick 0 + deltas). | Produces clean fault transitions (jam false→true at tick 20) the tests assert, and keeps JSONL readable. |
| A3 | **JSONL always written; MQTT optional** via the in-memory `mqtt_uns.broker`. | "MQTT enabled → publish; disabled/unavailable → JSONL." No external broker, no cloud. |
| A4 | Live cell = **snapshot event** (source=live_supervised_cell, quality=snapshot) when offline. | The bench is supervised/not-24/7; never fabricate a live feed. Missing live cell never fails. |
| A5 | Ignition export = **tag contract**, not an Ignition project. | "HMI visualizes tags, not PLCs." `ignition_export.py` writes json+csv tag map + an HMI screen plan; no Ignition API. |
| A6 | sim_plc spec is per-kind data; capper fault **degrades** (runs + rejects), others **stop**. | Realistic + makes "status/fault tags change" testable for each scenario. |

## 3. Constraints honored

Conv_Simple untouched (subprocess test asserts `DEMO: OK`); `conv_simple_demo.py` only READ (its TAGS feed
the Ignition export). No PLC writes. No cloud/API (a test scans the telemetry stack for `requests/httpx/
urllib`). Default run stays offline-deterministic. OpenPLC not required (documented as a later milestone).

## 4. New files

`sim_plc.py` (6 simulated PLCs + scenarios), `telemetry.py` (events → JSONL + optional MQTT),
`ignition_export.py` (tag map json/csv + HMI plan), updated `run_proveit_demo.py`
(`--telemetry/--ticks/--scenario/--ignition-export`), `tests/test_telemetry_ignition.py`.

## 5. Validation

DoD command `--telemetry --ticks 60 --scenario filler_jam --ignition-export --no-mqtt` → 349 deterministic
events (jam false→true @ tick 20) + 36-tag Ignition map + HMI plan. 49/49 demo tests green; ruff clean;
Conv_Simple `DEMO: OK`. No licensed data.

## 6. Reusable findings / risks

Reusable: the virtual-clock + on-change pattern gives reproducible telemetry without a broker. Risk: if a
future stage needs real wall-clock timestamps, isolate it behind a flag so default tests stay deterministic.
