# Machine Memory Layer — Build Note (PR #2404, round 2 deltas)

**Date:** 2026-07-03 · **PR:** [#2404](https://github.com/Mikecranesync/MIRA/pull/2404) `feat/machine-memory-worker`
**Status:** implemented, reviewed, flag default-off (`MIRA_RUN_DIFF_ENABLED`)

This note is the product-owner-facing summary of what PR #2404 built and why.
It complements — does not replace — `docs/runbooks/machine-memory-worker.md`
(the operational runbook: local run, staging enablement, rollback).

## What was built, and why

PR #2404 extends the **existing** `mira-crawler/run_engine/` worker (built in
PR #2351 for migration 038 — `machine_run`/`run_step`/`run_baseline`/`run_diff`)
rather than building a new pipeline. It adds two new capabilities on top of
that engine:

1. **State windows** — what state the machine was in (idle / running /
   faulted / comm_down / estopped / unknown) over an interval, including
   intervals where no run trigger ever rose (038 alone records nothing for an
   idle machine — there is no run row when the trigger never crosses
   threshold).
2. **Typed A0–A12 anomalies** — the vendored anomaly-detection brain
   (`plc/conv_simple_anomaly/rules_core.py`, byte-identical copy at
   `mira-crawler/run_engine/anomaly_rules.py`, parity-tested) evaluated per
   window snapshot, persisted as `run_diff` rows with a `diff_type` and
   explicit evidence pointers.

**Migration 038 was REUSED, not reshaped.** The discovery/decision doc for
this buildout — `docs/discovery/2026-07-03-machine-memory-buildout.md`
(landed on branch `fix/db-inspect-orphan-probe`, PR #1 of this same
buildout sweep) — records the evidence and the decision:

- **D1** — "No `machine_events` table. Build on 038 + existing
  `mira-crawler/run_engine`." Evidence: the run-centric worker already
  existed (PR #2351): `segmentation.py`, `baseline.py`/`diff.py`,
  `pipeline.py::run_historization()`, `store.py` (`RunStore` Protocol +
  `InMemoryRunStore` + `NeonRunStore`), Celery beat task
  `tasks/historize_runs.py`. Building a parallel table would have duplicated
  a working layer.
- **D2** — "Migration 040 (additive only)": `run_diff` gains `diff_type`,
  `window_id`, `from_event_id`, `to_event_id` columns (`run_id` becomes
  nullable, gated by a `run_diff_parent_check` CHECK requiring one parent),
  plus one genuinely new table, `machine_state_window`. Evidence: 038's
  `machine_run.status` CHECK only allows `open`/`closed`/`anomalous` — there
  is no row at all for an idle interval — and `run_diff.severity` has no
  anomaly-code column, only `info`/`warning`/`critical`. Three of the six
  CV-101 fixtures below are idle-state faults that 038 alone cannot
  represent. `machine_state_window` is a genuinely different concept from a
  run (an interval of *state*, not a *trigger-bounded activity period*), not
  a `machine_events` clone — the buildout's hard rule was "no competing
  `machine_events` table unless a written note proves 038 insufficient,"
  and that note is D2.

Migration file: `mira-hub/db/migrations/040_machine_memory_windows.sql`.

## Input tables

| Table | Migration | Role |
|---|---|---|
| `tag_events` | 033 | The raw reading stream (append-only). The worker never writes to it and never opens a fieldbus socket — readings arrive through the one-pipeline ingest path (`mira-relay`). Columns used: `event_id`, `tenant_id`, `uns_path`, `tag_path`, `value`, `value_type`, `quality`, `event_timestamp`. |
| `approved_tags` | (allowlist, seeded by `tools/seeds/approved_tags_conveyor.sql`) | Only tag paths present in the approved mapping enter a rule snapshot. The worker's own mapping — `run_engine/snapshot.py::CV101_TAG_TOPIC_MAP` — is derived from this allowlist + the human-approved CV-101 context model; unmapped/unapproved tags never enter a snapshot and are excluded (counted in the summary's `unmapped_tags`, never persisted — see "Unapproved/unmapped tag visibility" below). |

## Output tables

| Table | Migration | Written by |
|---|---|---|
| `machine_run` | 038 | Existing 038 engine (`pipeline.py::run_historization`), unchanged. INSERT + narrow UPDATE to close. |
| `run_step` | 038 | Existing 038 engine, unchanged. One `'default'` `phase_name`/`phase_index=0` step per run, `run_id` linked to its parent run. |
| `run_baseline` | 038 | Existing 038 engine, unchanged. Living per-(tenant, uns_path, tag_path, phase_name) aggregate. |
| `run_diff` | 038 + 040 columns | Two row shapes now: **statistical** rows (038, `run_id` parent, `diff_type IS NULL`) and **typed anomaly** rows (040, `window_id` parent, `diff_type='anomaly_<RULE_ID>'`, `from_event_id`/`to_event_id` evidence pointers, `metadata.severity_raw`/`metadata.next_check`). |
| `machine_state_window` | 040 (new) | Upsert on `(tenant_id, uns_path, state, started_at)`; INSERT + narrow UPDATE (`ended_at`, `metadata`) only, no DELETE. |

## Worker entrypoints

1. **Celery task** — `mira-crawler/tasks/historize_runs.py`. Flag-gated by
   `MIRA_RUN_DIFF_ENABLED` (default OFF — decision D8: no new flag, machine
   memory rides the same gate as the 038 run layer). When enabled, the run
   layer processes trigger-configured uns_paths as before; the machine-memory
   pass (state windows + typed anomalies) runs per uns_path with
   `triggers=None` to avoid double-processing, and covers trigger-less
   uns_paths via `MIRA_MACHINE_MEMORY_UNS_PATHS` (config, not a new enable
   flag).
2. **CLI (deterministic, no DB, no hardware)** —
   `python -m run_engine.machine_memory --fixture <path> [--dry-run]`. Always
   runs against a fresh, throwaway `InMemoryRunStore` — never touches Neon
   even if `NEON_DATABASE_URL` is set. `--dry-run` suppresses the CLI's final
   persisted-row-count dump; it does not change what
   `historize_machine_memory` computes (see `tests/test_machine_memory.py::TestCliDryRun`
   for the exact contract this is tested against).

## Fixtures (`mira-crawler/tests/fixtures/machine_memory/`)

Six deterministic, tag_events-shaped JSON fixtures, all tenant
`e88bd0e8-8a84-4e30-9803-c0dc6efb07fe`, uns_path
`enterprise.home_garage.conveyor_lab.conveyor_1` (the CV-101 conveyor bench):

| Fixture | Proves |
|---|---|
| `cv101_healthy_idle.json` | Baseline case — all-good snapshot yields exactly one `idle` window and zero anomalies. |
| `cv101_comm_stale.json` | RS-485 comm loss (`vfd_comm_ok=false`) — an `idle → comm_down` window transition plus one `A1_COMM_STALE` anomaly (CRITICAL → `critical`), evidence pointers anchored to the actual `comm_ok=false` fixture rows. |
| `cv101_estop.json` | E-stop wiring fault (`estop_wiring_fault=true`) — `idle → estopped` window transition plus one `A3_ESTOP_WIRING` anomaly (HIGH → `warning`). |
| `cv101_both_directions.json` | Simultaneous forward+reverse direction command — `A4_DIRECTION_FAULT` (MEDIUM → `info`); MEDIUM is not a fault state, so the machine stays classified `idle`. |
| `cv101_run_trigger.json` | Proves the 038 run layer is untouched: `vfd_hz` crosses the 0.1 Hz threshold and back, creating exactly one closed `machine_run` + one `'default'` `run_step` linked to it, while the state layer independently records `idle → running → idle`. |
| `cv101_unmapped_tag.json` | Two unapproved/hacker-injected tag paths are excluded from every snapshot, counted in `summary["unmapped_tags"]`, and never produce a window state change or an anomaly — proves the fail-closed allowlist boundary holds inside the worker, not just at ingest. |

## Scoreboard SQL (read-only)

All queries are read-only and safe to run via `db-inspect.yml` against
staging (never prod psql — `docs/environments.md`).

```sql
-- 1. tag_events volume by tenant/day (input-side health)
SELECT tenant_id, date_trunc('day', event_timestamp) AS day, count(*)
  FROM tag_events
 GROUP BY 1, 2
 ORDER BY 2 DESC, 3 DESC
 LIMIT 30;

-- 2. machine_run count by tenant/uns_path/day (038 run layer activity)
SELECT tenant_id, uns_path::text, date_trunc('day', started_at) AS day, count(*)
  FROM machine_run
 GROUP BY 1, 2, 3
 ORDER BY 3 DESC, 4 DESC
 LIMIT 30;

-- 3. run_step count by run (v1 expectation: exactly 1 per run — a count > 1
--    means the phase model has grown beyond v1's single 'default' step)
SELECT run_id, count(*)
  FROM run_step
 GROUP BY run_id
 ORDER BY 2 DESC
 LIMIT 20;

-- 4. run_diff by severity/diff_type/day (038 statistical + 040 typed anomalies)
SELECT date_trunc('day', event_timestamp) AS day, severity,
       coalesce(diff_type, 'baseline_deviation') AS diff_type, count(*)
  FROM run_diff
 GROUP BY 1, 2, 3
 ORDER BY 1 DESC, 4 DESC
 LIMIT 30;

-- 5. Latest run + latest 5 diffs for one asset (parameterized on tenant + uns_path)
--    Replace :tenant_id / :uns_path.
SELECT run_id, status, started_at, stopped_at
  FROM machine_run
 WHERE tenant_id = :tenant_id::uuid
   AND uns_path = :uns_path::ltree
 ORDER BY started_at DESC
 LIMIT 1;

SELECT diff_type, severity, tag_path, event_timestamp,
       from_event_id, to_event_id, metadata->>'next_check' AS next_check
  FROM run_diff
 WHERE tenant_id = :tenant_id::uuid
   AND uns_path = :uns_path::ltree
 ORDER BY event_timestamp DESC
 LIMIT 5;
```

**Note on unapproved/unmapped tag visibility.** The worker counts
unapproved/unmapped tag paths it excluded from a batch's snapshot in the
summary dict's `unmapped_tags` field (`{tag_path: count}`) — this is an
**in-memory metric only, not persisted to any table.** There is no scoreboard
SQL for it because there is nothing in the database to query; visibility into
unmapped-tag volume today requires reading the worker's log line
(`machine_memory: uns=%s windows=%d anomalies=%d unmapped=%d`,
`mira-crawler/run_engine/machine_memory.py`) or the Celery task's return
value. If unmapped-tag volume needs to be queryable over time, that is a
follow-up (a small persisted counter table or a log-based metric), not
something this PR does.

## Known limitations

- **NeonRunStore SQL is structurally reviewed, not CI-executed against a live
  Postgres.** Same standing caveat as the 038 engine (`run_engine/store.py`
  header note). The `ON CONFLICT … WHERE …` partial-index upsert and the
  `RETURNING window_id` clause should be eyeballed against real staging
  behavior the first time the flag is enabled there.
- **A3 (`A3_ESTOP_WIRING`) dual-channel arm is unreachable today.** No
  approved tag currently exposes the e-stop NO channel (DI_03), so A3 can
  only fire via the wiring-fault flag from `tag_events`. Unblocked once the
  `approved_tags` allowlist grows to include that channel (tracked
  separately — CCW slave-map-v2 reflash work on the bench PLC laptop).
- **State-label vs. temporal-anomaly severity divergence.** A window's state
  label (idle/running/faulted/comm_down/estopped) is derived per-event with
  empty derived facts (temporal rules like "stale for N seconds" can't
  meaningfully fire "per instant"), while the anomaly evaluation for that same
  window uses the full cumulative derived facts through the window's last
  event. This means a window can be labeled `idle` while still containing a
  MEDIUM-severity anomaly (see `cv101_both_directions.json`) — this is
  intentional (MEDIUM is not a fault state) but worth knowing when reading a
  window list next to its anomaly list.
- **Flag is off by default** (`MIRA_RUN_DIFF_ENABLED`). Nothing runs against
  live tag_events until this is explicitly enabled, staging first — see the
  runbook's "Enable in staging" section.

## Next steps

1. **Staging enablement** per `docs/runbooks/machine-memory-worker.md` §
   "Enable in staging" — apply migration 040 (`apply-migrations.yml`
   dry-run → apply), set the Doppler `factorylm/stg` vars, wait one beat
   cycle, run the scoreboard SQL above against staging.
2. **Historian `list_runs()` wiring (#2339)** — `PostgresHistorianAdapter`
   still raises `NotImplementedError`; `machine_run` is already shaped 1:1
   onto the Historian Query API's `Run` DTO (`run_engine/models.py` header
   note), so this is a straightforward SELECT + column-rename adapter once
   both branches merge.
3. **Hub tile (PR #2406 / `feat/hub-machine-memory-surface`)** — the minimal
   read surface (`GET /api/assets/[id]/machine-memory` + a
   `MachineMemoryCard`) spec'd in the discovery doc's Agent E findings; zero
   Hub source files reference `machine_run`/`run_step`/`run_baseline`/
   `run_diff` today.

## Cross-references

- `docs/discovery/2026-07-03-machine-memory-buildout.md` — the full discovery
  log, sub-agent findings, and decisions D1–D9 this build implements.
- `docs/runbooks/machine-memory-worker.md` — operational runbook (local run,
  staging enablement, rollback).
- `mira-hub/db/migrations/033_tag_events.sql`, `038_machine_runs.sql`,
  `040_machine_memory_windows.sql` — the schema this worker reads/writes.
- `mira-crawler/run_engine/machine_memory.py`,
  `mira-crawler/run_engine/store.py`,
  `mira-crawler/tests/test_machine_memory.py` — the implementation and its
  test suite.
