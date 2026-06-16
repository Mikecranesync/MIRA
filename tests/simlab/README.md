# SimLab — Machine Behavior Scenario Evaluation

> **SimLab is now two layers.** This directory is the **eval harness** (YAML scenarios →
> real Supervisor → behavior checkpoints). The **runtime simulator** — a deterministic,
> headless juice-bottling factory MIRA can monitor live (tags, UNS, alarms, docs,
> train-before-deploy) — lives in the top-level **`simlab/`** package. See
> `docs/simlab/README.md` for the North Star. The `juice_*.yaml` scenarios here mirror the
> runtime simulator's six fault scenarios so this harness can grade the real engine on them.

SimLab tests **cross-component diagnostic reasoning** — whether MIRA correctly isolates
a fault across a multi-component machine, not just whether it knows a device's fault codes.

## Architecture

```
tests/simlab/
├── scenarios/            # YAML scenario files
│   ├── conveyor_jam_01.yaml
│   ├── motor_no_motion_01.yaml
│   ├── pump_no_flow_01.yaml
│   ├── vfd_thermal_cascade_01.yaml
│   └── sensor_stuck_high_01.yaml
├── ingestion/
│   └── ai4i.py          # AI4I 2020 dataset → scenario YAML seeds
├── schema.py            # SimLabScenario dataclasses
├── checkpoints.py       # Behavior checkpoint evaluators
├── runner.py            # In-process Supervisor runner
└── runs/                # Scorecard output (YYYY-MM-DDTHHMM-simlab.md)
```

## Scenario Tiers

| Tier | Use case | Examples |
|------|----------|---------|
| 1 | Full eval — complex stateful device, multi-component fault | conveyor jam, VFD thermal, pump no-flow |
| 2 | Lightweight — binary component, single failure mode | sensor stuck, tool wear |
| 3 | Knowledge-card — passive hardware, no FSM required | (future) |

## Running

```bash
# Load Doppler secrets first
doppler run --project factorylm --config prd -- \
    python3 tests/simlab/runner.py

# Run single scenario
python3 tests/simlab/runner.py --scenario conveyor_jam_01

# Schema-only dry run (no LLM calls)
python3 tests/simlab/runner.py --dry-run
```

## Behavior Checkpoints

Checkpoints that can't be evaluated per-turn — they look across the whole conversation:

| Checkpoint | What it checks |
|-----------|---------------|
| `cp_no_premature_blame` | MIRA didn't name red-herring components before isolation |
| `cp_isolation_evidence` | MIRA cited measurements/tags before concluding root cause |
| `cp_subsystem_identified` | MIRA named the correct faulty subsystem |
| `cp_no_cross_component_confusion` | MIRA didn't direct action on unrelated components |

## AI4I 2020 Seed Ingestion

The [AI4I 2020 Predictive Maintenance Dataset](https://archive.ics.uci.edu/dataset/601/ai4i+2020+predictive+maintenance+dataset)
(UCI, 10k rows) provides realistic sensor values (air/process temp, RPM, torque, tool wear)
to seed scenario tag states. Failure modes map to:

| AI4I failure | Machine scenario |
|-------------|-----------------|
| HDF (heat dissipation) | Clogged coolant filter |
| PWF (power failure) | Worn tooling excessive load |
| TWF (tool wear) | Tool life expiration |
| OSF (overstrain) | Worn tool + heavy cut |
| RNF | Excluded — no mechanical root cause |

```bash
# Generate AI4I-seeded scenarios (downloads dataset on first run)
python3 tests/simlab/ingestion/ai4i.py --out tests/simlab/scenarios/

# Dry run
python3 tests/simlab/ingestion/ai4i.py --dry-run
```

## Pre-seeding Machine Context

The runner pre-seeds Supervisor state with `source="direct_connection"` so the UNS
confirmation gate is bypassed. The SimLab runner IS the machine context — scenarios
run from the perspective of a tech already standing at the machine.
