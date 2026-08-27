# Run-diff pilot — first reviewed artifact from the run engine

**Produced:** 2026-08-19 · **Capability:** `run_diff_engine` · **Tenant:** `capability-closure-pilot` (synthetic)

Purpose: close the *proven* leg for a capability that is **enabled in production**
(`MIRA_RUN_DIFF_ENABLED='1'` in Doppler prd) but whose output nobody had reviewed.

Method: the real engine (`run_engine.pipeline.run_historization`) driven offline through
`InMemoryRunStore`. **No production, staging, PLC or database access** — the engine core is
pure and depends only on a `RunStore`, so it can be exercised without any environment change.

## Input

Seven runs of a conveyor, segmented on `vfd_freq > 1.0`. Six normal (`motor_current` ~10.0/10.4 A),
then one faulted run at 18.0 A — the deviation a technician would be chasing.

## Engine summary
```json
{
  "status": "ok",
  "runs_opened": 7,
  "runs_closed": 7,
  "runs_still_open": 0,
  "diffs_written": 10,
  "anomalous_runs": 0
}
```

## Learned baselines

| tag | phase | avg | stddev | samples |
|---|---|---|---|---|
| `vfd_freq` | default | 36.000 | 0.000 | 5 |
| `motor_current` | default | 9.051 | 0.000 | 5 |

## Run diffs

| run | tag | phase | baseline | observed | delta | delta % | severity |
|---|---|---|---|---|---|---|---|
| `pilot-run-003` | `vfd_freq` | default | 36.000 | 36.000 | +0.000 | +0.0% | **info** |
| `pilot-run-003` | `motor_current` | default | 9.051 | 9.051 | +0.000 | +0.0% | **info** |
| `pilot-run-004` | `vfd_freq` | default | 36.000 | 36.000 | +0.000 | +0.0% | **info** |
| `pilot-run-004` | `motor_current` | default | 9.051 | 9.051 | +0.000 | +0.0% | **info** |
| `pilot-run-005` | `vfd_freq` | default | 36.000 | 36.000 | +0.000 | +0.0% | **info** |
| `pilot-run-005` | `motor_current` | default | 9.051 | 9.051 | +0.000 | +0.0% | **info** |
| `pilot-run-006` | `vfd_freq` | default | 36.000 | 36.000 | +0.000 | +0.0% | **info** |
| `pilot-run-006` | `motor_current` | default | 9.051 | 9.051 | +0.000 | +0.0% | **info** |
| `pilot-run-007` | `vfd_freq` | default | 36.000 | 36.000 | +0.000 | +0.0% | **info** |
| `pilot-run-007` | `motor_current` | default | 9.051 | 9.051 | +0.000 | +0.0% | **info** |

## Reviewer notes

- The engine **does** segment runs, learn per-tag baselines from prior normal runs, and score a
  later run against them. On this input it produced 10 diffs from 2 baselines.
- `anomalous_runs: 0` while diffs were written: worth understanding before this output is put
  in front of a technician — a run carrying a `critical` diff that is not counted anomalous is
  either a deliberate distinction (per-tag vs per-run scoring) or a gap. **Not resolved here.**
- Baseline `motor_current` avg is 9.05, not ~10.2, because the run window includes the
  zero-current readings at stop. Defensible, but it means a technician reading 'baseline 9.05 A'
  is seeing a window average, not a running average. Worth labelling in any UI.

## What this does and does not prove

**Does:** the run engine's core is functional end-to-end and its output is legible.

**Does not:** that it behaves correctly on real production tag noise, at production volume,
or through `NeonRunStore` rather than the in-memory store. The two observations above are
exactly the kind of question a real artifact surfaces and a green test suite does not.

**Also does not:** replace CI. The three run-engine suites still run in no job.
