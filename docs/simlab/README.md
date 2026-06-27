# MIRA SimLab — Juice Bottling Line

## What SimLab Is (and Is Not)

SimLab is **not** a toy conveyor demo. It is a **ProveIt-style deterministic simulated factory benchmark** — a headless, seeded, tick-driven simulator that MIRA can monitor, reason over, map into a Unified Namespace, diagnose, cite documentation against, and gate with train-before-deploy approval — exactly like a real PLC/SCADA data source.

The flagship line is a **juice/beverage bottling line** operated under the Florida Natural Demo site. It is the primary test fixture for proving MIRA's live-tag reasoning, documentation grounding, and approval-gate mechanics before any customer deployment.

**The headless deterministic simulator is always the source of truth.** Factory I/O (optional visual layer) and any future HMI projection are views onto the simulator — they never drive it. See `factory-io-optional-adapter.md`.

**PLC baselines are clean-room normalizations.** The tag models, fault codes, alarm predicates, and archetype patterns in `simlab/baselines/` normalize standard industrial concepts — inputs, outputs, interlocks, timers, counters, alarms — found in any textbook on PLC programming. No proprietary ladder logic, structured text, or customer PLC programs are executed or copied. Every reading carries `simulated=True` and `source_system="simulator"`.

---

## The 8-Machine Bottling Flow

```
Depalletizer01 → ConveyorZone01 → ConveyorZone02 → Rinser01 → Filler01
    → Capper01 → Labeler01 → CasePacker01 → Palletizer01
```

**Utilities (run alongside the line):**
- `AirSystem01` — plant compressed-air supply (85–100 PSI header); feeds all pneumatic actuators
- `CIPSkid01` — clean-in-place solution supply; interlocks food-contact machines out of production during cleaning

**Accumulation / backup propagation:** A stoppage at any downstream machine causes the upstream conveyor accumulation zones to fill. When `conveyorzone02.accumulation_percent` = 100%, upstream machines are forced to hold. This is how Scenarios D and E generate multi-machine symptoms from a single root cause.

---

## UNS Tree

Canonical ltree root: `enterprise.florida_natural_demo.plant1.juice_bottling.line01`

MQTT display projection: `FactoryLM/FloridaNaturalDemo/Plant1/JuiceBottling/Line01`

```
enterprise
└── florida_natural_demo
    └── plant1
        └── juice_bottling
            └── line01
                ├── depalletizer01
                │   ├── status.run_state
                │   ├── process.pallet_present
                │   ├── process.layer_count
                │   ├── process.vacuum_pressure
                │   ├── process.bottle_outfeed_rate
                │   ├── process.jam_detected
                │   └── faults.fault_code
                ├── conveyorzone01   (same structure as conveyorzone02)
                │   ├── status.run_state
                │   ├── process.motor_current_amps
                │   ├── process.speed_fpm
                │   ├── process.photoeye_blocked
                │   ├── process.blocked
                │   ├── process.starved
                │   ├── process.accumulation_percent
                │   └── faults.fault_code
                ├── rinser01
                │   ├── status.run_state
                │   ├── process.infeed_bottle_count
                │   ├── process.outfeed_bottle_count
                │   ├── process.water_pressure
                │   ├── process.rinse_valve_open
                │   ├── quality.reject_count
                │   └── faults.fault_code
                ├── filler01
                │   ├── status.run_state
                │   ├── process.bottles_per_minute
                │   ├── process.fill_level_oz
                │   ├── process.fill_level_target_oz
                │   ├── process.fill_level_variance
                │   ├── process.tank_level_percent
                │   ├── process.product_temperature
                │   ├── process.filler_bowl_pressure
                │   ├── process.nozzle_fault_count
                │   ├── motor.vfd_speed_hz
                │   ├── motor.motor_current_amps
                │   ├── quality.underfill_reject_count
                │   ├── quality.overfill_reject_count
                │   └── faults.fault_code
                ├── capper01
                │   ├── status.run_state
                │   ├── process.cap_present
                │   ├── process.cap_torque_inlb
                │   ├── process.cap_torque_target
                │   ├── process.cap_torque_variance
                │   ├── process.cap_chute_level
                │   ├── process.jam_detected
                │   ├── motor.motor_current_amps
                │   ├── quality.reject_count
                │   └── faults.fault_code
                ├── labeler01
                │   ├── status.run_state
                │   ├── process.label_roll_percent
                │   ├── process.label_web_tension
                │   ├── process.label_sensor_blocked
                │   ├── process.glue_temperature
                │   ├── process.registration_error_mm
                │   ├── quality.reject_count
                │   └── faults.fault_code
                ├── casepacker01
                │   ├── status.run_state
                │   ├── production.case_count
                │   ├── production.bottle_infeed_count
                │   ├── process.case_former_ready
                │   ├── process.glue_level
                │   ├── process.glue_temperature
                │   ├── process.jam_detected
                │   ├── quality.reject_count
                │   └── faults.fault_code
                ├── palletizer01
                │   ├── status.run_state
                │   ├── production.case_infeed_count
                │   ├── status.pallet_present
                │   ├── production.layer_count
                │   ├── status.robot_ready
                │   ├── status.slip_sheet_present
                │   ├── status.jam_detected
                │   └── faults.fault_code
                ├── airsystem01
                │   ├── process.header_pressure_psi
                │   ├── process.compressor_running
                │   ├── alarms.dryer_fault
                │   └── alarms.low_air_alarm
                └── cipskid01
                    ├── process.cip_active
                    ├── process.cycle_step
                    ├── process.supply_temp
                    ├── process.return_temp
                    ├── process.conductivity
                    └── faults.valve_fault
```

---

## Simulator Layers

| Layer | Module | Purpose |
|-------|--------|---------|
| PackML / ISA-88 state model | `simlab.packml` | 10 machine states, transition guard, run/fault predicates |
| PLC tag models | `simlab.models` | TagDef, FaultCode, AlarmDef, AssetModel, LineModel, FactoryModel, Reading |
| Canonical UNS paths | `simlab.uns` | ltree path builders + MQTT display projection |
| PLC archetypes | `simlab.baselines` | Reusable tag/fault/alarm sets per machine class |
| Line definition | `simlab.lines.juice_bottling` | The 8-process + 2-utility asset instances |
| Deterministic tick engine | `simlab.engine` | Seeded, replay-identical state machine; 1 tick = 1 second sim time |
| Fault scenarios | `simlab.scenarios` | Six replayable scenarios A–F with ground-truth rubrics |
| Publisher abstraction | `simlab.publishers` | InMemory / MQTT / RelayIngest / Fake; test default = InMemory |
| Local flight recorder | `simlab.flight_recorder` | Process-local deterministic scenario/tick event capture; no broker, DB, or wall-clock |
| Evidence assembler | `simlab.diagnostic` | Surfaces what is abnormal; does NOT generate the diagnosis |
| Approval store | `simlab.approval` | train-before-deploy lifecycle (draft→training→validating→approved) |
| FastAPI surface | `simlab.api` | REST API for Hub / MIRA consumption |

---

## Six Scenarios (A–F)

| ID | Title | Primary Asset | Root Cause | Question Posed |
|----|-------|--------------|------------|----------------|
| A | Filler Underfill — Low Bowl Pressure | filler01 | `filler_bowl_pressure` drops below 10 PSI; `underfill_reject_count` rises | "Why is Line 1 making bad bottles?" |
| B | Capper Torque Deviation | capper01 | Worn clutch pads; `cap_torque_inlb` below target; `reject_count` rising | "Capper is rejecting bottles — what's wrong?" |
| C | Labeler Registration Drift | labeler01 | `label_web_tension` out of range; `registration_error_mm` rising | "Labels are crooked on every bottle — why?" |
| D | Case Packer Jam Blocks Line | casepacker01 | `jam_detected` = TRUE; upstream accumulation fills; labeler and capper forced to hold | "The whole line slowed down — where's the problem?" |
| E | Palletizer Unavailable Backs Up Cases | palletizer01 | `robot_ready` = FALSE (E-stop); casepacker discharge backs up; upstream fills | "Cases piling up — what's happening?" |
| F | Low Plant Air — Multi-Machine Symptoms | airsystem01 | `header_pressure_psi` drops; `low_air_alarm` = TRUE; depalletizer vacuum, filler bowl, capper chute, case packer cylinders all degraded | "Multiple machines are throwing faults — what's the root cause?" |

---

## How to Run Locally

### Prerequisites
```bash
cd /Users/charlienode/mira-simlab-wt
pip install -e ".[dev]"    # or: uv pip install -e ".[dev]"
```

### Start the SimLab API server
```bash
python -m simlab
```

This starts a uvicorn server (default port 8099) with the juice bottling line loaded and
the underfill scenario (A) armed but not started. The startup banner prints local URLs and sample cURL commands.

### Start the Underfill Scenario (Scenario A)

```bash
# Arm and start
curl -X POST http://localhost:8099/simlab/scenario/filler_underfill_low_bowl_pressure/start

# Advance 30 ticks (= 30 seconds of sim time)
curl -X POST "http://localhost:8099/simlab/scenario/tick?n=30"

# Inspect current snapshot (all tags)
curl http://localhost:8099/simlab/snapshot

# Inspect deterministic local flight-recorder events
curl http://localhost:8099/simlab/flight-recorder/events

# Export deterministic flight-recorder events as NDJSON
curl http://localhost:8099/simlab/flight-recorder/export.ndjson

# Clear process-local recorder events
curl -X POST http://localhost:8099/simlab/flight-recorder/clear

# Inspect evidence packet (abnormal tags + candidate docs)
curl http://localhost:8099/simlab/evidence/filler_underfill_low_bowl_pressure

# Check rubric (ground-truth expected answer)
curl http://localhost:8099/simlab/scenario/filler_underfill_low_bowl_pressure/rubric

# Reset to clean state
curl -X POST http://localhost:8099/simlab/scenario/reset
```

### Other useful API calls

```bash
# List all assets on the line
curl http://localhost:8099/simlab/lines/line01/assets

# Get a specific asset's tags
curl http://localhost:8099/simlab/assets/filler01/tags

# Get active alarms
curl http://localhost:8099/simlab/alarms

# Serve a doc fixture
curl http://localhost:8099/simlab/docs/filler01/troubleshooting.md

# Deterministic replay: replay scenario A from tick 0, advance 60 ticks
curl -X POST "http://localhost:8099/simlab/scenario/filler_underfill_low_bowl_pressure/replay?ticks=60"

# Health check
curl http://localhost:8099/simlab/healthz
```

---

## Running Tests

```bash
# All SimLab tests (no LLM, no broker required — fully offline)
pytest tests/simlab/ -v

# Flight recorder contract
python -m pytest tests/simlab/test_flight_recorder.py -q

# Determinism check only
pytest tests/simlab/test_juice_determinism.py -v

# Rubric grader test
pytest tests/simlab/test_juice_rubric.py -v
```

---

## Local Flight Recorder

The Phase 1 flight recorder is a deterministic, local contract for replay and
debugging. `SimEngine.add_flight_recorder(...)` attaches a recorder at the engine
level, so `advance(60)` emits 60 individual `tick` events rather than one
publisher batch. `load_scenario()` emits a `scenario_loaded` event at tick 0, and
`/simlab/evidence/{scenario_id}` emits an `evidence_requested` event at the
current tick after assembling the diagnostic evidence packet.

Each event includes only deterministic data: event type, run id, engine seed,
line id, simulation tick, `Reading.ts`, scenario id, reading count, active
alarms, and changed UNS paths. Evidence-request events also include a compact
`details` block with `abnormal_tag_count`, sorted `abnormal_paths`,
`active_alarm_count`, `candidate_docs`, and `uns_subtree`. They intentionally do
not record expected root cause, expected answer text, or rubric truth; the
snapshot is diagnostic context only. The default run id is `simlab-local-run`;
tests or callers may inject an `InMemoryFlightRecorder(run_id="...")` to label a
deterministic replay without UUIDs or wall-clock time.

The default API app attaches an `InMemoryFlightRecorder` and exposes:

```bash
curl http://localhost:8099/simlab/flight-recorder/events
curl http://localhost:8099/simlab/flight-recorder/export.ndjson
curl -X POST http://localhost:8099/simlab/flight-recorder/clear
```

The NDJSON export is read-only. It returns one JSON object per recorded event in
the same order as `/events`, with no wrapper object, so two fresh same-seed runs
produce byte-identical replay metadata.

There is no Hub database, MQTT, relay, wall-clock timestamp, UUID, or live
hardware dependency in this local phase.

---

## What MIRA Must Prove

To pass the SimLab benchmark, MIRA must demonstrate:

1. **Live-tag reasoning** — given a snapshot of abnormal tags, identify the root cause asset and fault without inventing plant context.
2. **Documentation grounding** — cite the correct fixture documents (e.g., `filler01/troubleshooting.md`) by name when explaining a fault.
3. **UNS accuracy** — reference the correct canonical UNS paths in evidence packets, not free-form strings.
4. **Train-before-deploy approval** — a MIRA answer can be marked Good / Bad / Needs Review, and the asset must reach `approved` lifecycle state before it is considered deployment-ready.

The honest engine test uses the real Supervisor (via `tests/simlab/runner.py`) against a live cascade call — this requires Doppler credentials and is NOT in the default CI run. The rubric grader (`simlab.diagnostic.grade`) provides a fully deterministic, no-LLM pass/fail for CI.

---

## Related Files

- `simlab/` — all simulator source code
- `simlab/docs/<asset_id>/` — synthetic maintenance document fixtures
- `tests/simlab/` — deterministic test suite (10 test modules)
- `tests/simlab/scenarios/` — YAML scenario definitions for runner.py
- `docs/simlab/factory-io-optional-adapter.md` — Factory I/O visual layer (optional, not authoritative)
- `docs/simlab/SIMLAB_BUILD_TASK.md` — full delegation spec (locked interfaces)
- `docs/plans/2026-06-22-simlab-uns-ingest-roadmap.md` — **SimLab → real UNS ingest roadmap/runbook**: the full emit→land→UNS-map→consume pipeline (done-vs-needed matrix, parallel-agent work-tree lanes, infra/ops checklist)
