# Machine-Memory Worker — tag_events → persisted machine memory

**What it is:** the worker that turns the canonical `tag_events` stream into
persisted machine memory on the migration-038/040 layer — runs, state windows,
and typed A0–A12 anomaly diffs with evidence pointers. Built on the existing
`mira-crawler/run_engine/` (PR #2351); design decisions D1–D4/D8 in
`docs/discovery/2026-07-03-machine-memory-buildout.md`.

## Input

One table: **`tag_events`** (migration 033 — the raw reading stream). The
worker never writes to it and never opens a fieldbus socket; readings arrive
through the one-pipeline ingest path (`mira-relay`). Only tag paths present in
the approved mapping (derived from the `approved_tags` allowlist + the
human-approved context model) enter a rule snapshot; unmapped/unapproved tags
are excluded and counted (`unmapped_tags` in the summary).

## Processing

```
tag_events rows (per tenant, per uns_path)
  │
  ├─ 1. RUN segmentation (existing 038 engine, unchanged)
  │      trigger tag crosses threshold → machine_run + run_step,
  │      baseline over recent normal runs → run_baseline,
  │      observed-vs-baseline k·σ deviations → run_diff (statistical)
  │
  ├─ 2. STATE WINDOWS (new, migration 040)
  │      snapshot mapping (run_engine/snapshot.py: normalized tag_path →
  │      rules topic) → derive_state_windows: idle / running / faulted /
  │      comm_down / estopped / unknown, opened/closed on transitions,
  │      anchored to first/last tag_events row (evidence in metadata)
  │
  └─ 3. TYPED ANOMALIES (new, migration 040)
         vendored A0–A12 brain (run_engine/anomaly_rules.py — byte-identical
         copy of plc/conv_simple_anomaly/rules_core.py, parity-tested) per
         window snapshot → run_diff rows with diff_type='anomaly_<RULE_ID>',
         window_id parent, severity CRITICAL→'critical' HIGH→'warning'
         MEDIUM→'info' (raw in metadata.severity_raw), NEXT_CHECK guidance in
         metadata.next_check, evidence pointers from_event_id/to_event_id
```

Idempotent by construction: `machine_state_window` upserts on
`(tenant_id, uns_path, state, started_at)`; anomaly rows dedupe on the partial
unique index `(tenant_id, window_id, diff_type, tag_path, event_timestamp)`;
the run layer is skipped when the batch's detected run starts already exist.

## Output (the five tables)

| Table | Migration | Written as |
|---|---|---|
| `machine_run` | 038 | INSERT + close UPDATE (existing engine) |
| `run_step` | 038 | INSERT + close UPDATE (existing engine) |
| `run_baseline` | 038 | living-aggregate upsert (existing engine) |
| `run_diff` | 038 + 040 columns | append-only: statistical rows (run_id parent) + typed anomaly rows (window_id parent, `diff_type`, evidence pointers) |
| `machine_state_window` | 040 | upsert on the idempotency key; UPDATE only to close |

## Run locally (deterministic — no DB, no hardware, no network)

```bash
cd mira-crawler
python -m run_engine.machine_memory --fixture tests/fixtures/machine_memory/cv101_comm_stale.json
```

Prints the summary (windows, anomalies with rule_id/severity/next_check/
evidence event ids, unmapped tags) plus the in-memory persisted-row counts.
The CLI always runs against `InMemoryRunStore` — it is non-destructive by
construction; `--dry-run` suppresses the persisted-row dump.

Tests:

```bash
cd mira-crawler
python -m pytest tests/test_machine_memory.py tests/test_anomaly_rules_parity.py -q
```

## Enable in staging (default OFF)

The Celery beat task `tasks/historize_runs.py` NO-OPs unless
`MIRA_RUN_DIFF_ENABLED == "1"` (decision D8 — no new flag; machine memory
rides the same gate). Enablement is an ops step, **staging first**, prod only
after verification:

1. Apply migration 040 via `apply-migrations.yml` (`dry-run`, then `apply`) —
   dev → staging → prod, never hand-edited.
2. In Doppler `factorylm/stg` set:
   - `MIRA_RUN_DIFF_ENABLED=1`
   - `MIRA_TENANT_ID=<tenant uuid>` (garage tenant:
     `e88bd0e8-8a84-4e30-9803-c0dc6efb07fe`)
   - `MIRA_RUN_TRIGGERS=enterprise.home_garage.conveyor_lab.conveyor_1=default_conveyor_vfd_hz:0.1`
     (or leave unset and use the next var for windows-only operation)
   - `MIRA_MACHINE_MEMORY_UNS_PATHS=enterprise.home_garage.conveyor_lab.conveyor_1`
3. Wait ≥ one beat cycle (30 s), then run the verification SQL below against
   **staging** (read-only; `db-inspect.yml` or psql against `factorylm/stg` —
   never prod psql).
4. Prod: repeat via the gated workflows only after staging shows expected rows.

## Verification SQL (read-only)

```sql
-- Runs per day for a tenant
SELECT date_trunc('day', started_at) AS day, status, count(*)
  FROM machine_run
 WHERE tenant_id = '<tenant uuid>'::uuid
 GROUP BY 1, 2 ORDER BY 1 DESC LIMIT 14;

-- State windows for the conveyor, newest first
SELECT state, started_at, ended_at, metadata->>'from_event_id' AS from_event
  FROM machine_state_window
 WHERE tenant_id = '<tenant uuid>'::uuid
   AND uns_path = 'enterprise.home_garage.conveyor_lab.conveyor_1'::ltree
 ORDER BY started_at DESC LIMIT 20;

-- Typed anomaly diffs (the A0-A12 layer) with evidence pointers
SELECT diff_type, severity, tag_path, event_timestamp,
       from_event_id, to_event_id, metadata->>'next_check' AS next_check
  FROM run_diff
 WHERE tenant_id = '<tenant uuid>'::uuid
   AND diff_type IS NOT NULL
 ORDER BY event_timestamp DESC LIMIT 20;

-- Evidence round-trip: the tag_events rows an anomaly cites
SELECT e.event_id, e.tag_path, e.value, e.event_timestamp
  FROM run_diff d
  JOIN tag_events e ON e.event_id IN (d.from_event_id, d.to_event_id)
 WHERE d.tenant_id = '<tenant uuid>'::uuid AND d.diff_type IS NOT NULL
 ORDER BY d.event_timestamp DESC LIMIT 10;
```

## Rollback

- Worker: revert the PR (flag is default-off; nothing runs unless enabled).
- Migration 040 is additive and forward-safe; the rollback block in the file
  drops `machine_state_window` and the new index/constraint only. Do not
  re-add `NOT NULL` to `run_diff.run_id` once anomaly rows exist.

## Known limits (v1, documented judgment calls)

- The tag→topic mapping is per-asset config; v1 ships CV-101 only
  (`run_engine/snapshot.py::CV101_TAG_TOPIC_MAP`). New assets add a mapping,
  not code.
- No approved tag exposes the e-stop NO channel (DI_03), so A3 can only fire
  via the wiring-fault flag from tag_events today.
- The final window of each batch is closed at the last event's timestamp
  (`metadata.closed_by='batch_end'`); a continuing state in the next batch
  opens a new window rather than extending the old one.
- `NeonRunStore` SQL is structurally reviewed, not CI-executed against live
  Postgres (same standing note as the 038 engine, `run_engine/store.py`).
