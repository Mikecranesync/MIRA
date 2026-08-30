# Machine Memory Operations Preflight Implementation Plan

> **Execution:** Use `superpowers:test-driven-development`, `mira-platform`,
> `mira-industrial-safety`, and `superpowers:verification-before-completion`.

**Goal:** Give operators a direct, durable, tenant-scoped answer to “did the
Machine Memory historian actually execute successfully, and is CV-101 ready for
a physical-fault proof?” without inferring execution from rows, cursors, or logs.

**PR boundary:** This is the operations/preflight PR only. It does not change
Replay UI, schedule the seven-day observer, operate the PLC, change Doppler,
deploy, or claim production GO.

## Global constraints

- Production actions remain Mike-gated. Agent work ends at a green, reviewed PR.
- The preflight is read-only. Its SQL must contain only tenant-scoped `SELECT`s.
- The historian's normal heartbeat write is allowed; it records task execution,
  never equipment state and never a control instruction.
- A data timestamp, `historian_cursor.updated_at`, `run_diff`, log line, or GitHub
  artifact is never accepted as proof that the task executed.
- Missing, malformed, cross-environment, or stale evidence is NO-GO/UNKNOWN.
- Never persist URLs, credentials, raw exceptions, tag values, or user content in
  heartbeat details.

## Locked heartbeat seam

Create a dedicated living-row table rather than reuse `system_health_log`.
`system_health_log` is inline-created, lacks tenant/environment scope, and is an
availability-probe log; treating it as historian authority would weaken both
contracts.

```sql
historian_task_heartbeat (
  tenant_id uuid not null,
  deployment_environment text not null,
  task_name text not null,
  last_started_at timestamptz not null,
  last_finished_at timestamptz,
  last_status text not null,
  software_version text not null,
  run_count bigint not null,
  detail jsonb not null,
  updated_at timestamptz not null,
  primary key (tenant_id, deployment_environment, task_name)
)
```

Allowed environments are `development`, `staging`, and `production`. Allowed
statuses are `running`, `ok`, `error`, `disabled`, `no_triggers`, and
`missing_config`. `software_version` is the exact 40-character deployed
`MIRA_GIT_SHA`; `unknown` is rejected. `detail` contains only bounded counts, a
stable error code, effective `run_diff_enabled`, SHA-256 hashes of normalized
machine-memory/run-trigger UNS paths, hashes of
`TAG_DIFF_CONFIG_JSON.fault_trigger_tags`, and one SHA-256 of that canonical config.
It never contains raw tag paths, trigger values, URLs, or secrets.
The row is RLS-protected by both supported tenant settings; the app role receives
`SELECT`, `INSERT`, and `UPDATE`, never `DELETE`.

The task records `running` in a separate committed transaction before work and a
terminal status in a separate committed transaction after work. A newer start
than finish therefore remains visible after process death. If DB identity/config
is too incomplete to record, the preflight must report unobserved; no fallback
evidence is substituted.

## Task 1: Add the durable historian heartbeat

**Files**

- Create: `mira-hub/db/migrations/086_historian_task_heartbeat.sql`
- Modify: `mira-hub/db/check-migration-order.mjs`
- Modify: `mira-crawler/tasks/historize_runs.py`
- Create: `mira-crawler/tests/test_historian_heartbeat.py`
- Modify: `mira-crawler/tests/test_historian_postgres_integration.py`
- Modify: `docs/env-vars.md`
- Modify: `.github/workflows/ci.yml` (disposable-Postgres heartbeat/RLS job only)

**TDD contract**

- [ ] Run migration 086 against the disposable PostgreSQL harness and prove the
  unique key, RLS isolation, status/environment constraints, start/finish upsert,
  monotonically increasing `run_count`, and lack of DELETE privilege.
- [ ] Add migration 086 and its dependency on the existing tenant foundation to
  `check-migration-order.mjs`. Implementation stops until the migration has an
  assigned GitHub issue for its required `-- Issue: #…` header; no invented issue
  number or unchecked warning is accepted.
- [ ] Add a small `HistorianHeartbeatStore` whose only write target is the new
  table and whose parameters never include a raw exception or connection URL.
- [ ] Require explicit `MIRA_DEPLOYMENT_ENVIRONMENT` and a non-`unknown`,
  40-character `MIRA_GIT_SHA`; missing/invalid values cannot produce a
  misleading heartbeat.
- [ ] Canonicalize effective configuration at task start, persist only its
  booleans/hashes, and prove ordering/whitespace cannot change the fingerprint
  while a changed flag/path/trigger does.
- [ ] Parse `TAG_DIFF_CONFIG_JSON.fault_trigger_tags` separately from
  `MIRA_RUN_TRIGGERS`. The former owns PRD fault-window triggers; the latter only
  segments machine runs. Require the normalized CV-101 fault trigger
  `default_conveyor_fault_alarm` until Mike approves a replacement, and include
  its hash in the effective config proof.
- [ ] Prove `running → ok`, `running → error`, `disabled`, `no_triggers`, and
  `missing_config` outcomes. Preserve the task's existing return contract.
- [ ] Prove a pipeline exception records stable code `HISTORIAN_PIPELINE_ERROR`,
  not `str(exc)`, and still returns the existing error result.
- [ ] Prove a crash-shaped stale `running` row remains distinguishable from a
  completed run.
- [ ] Heartbeat persistence is fail-open for the existing historian only:
  missing migration, start-write failure, or terminal-write failure is logged
  with a stable redacted code and never suppresses historization. Preflight then
  reports unobserved/stuck. `run_count` increments exactly once at committed
  start, never on terminal update.
- [ ] Resolve DB/tenant/environment/SHA before the current disabled early return
  so a recordable disabled outcome is durable. Missing DB or tenant is inherently
  unobservable and cannot fabricate `missing_config`; distinguish it from other
  recordable missing configuration.
- [ ] RLS uses `NULLIF(current_setting('app.tenant_id',true),'')::uuid` and the
  same form for `app.current_tenant_id`; every heartbeat transaction executes
  `SET LOCAL app.current_tenant_id`. CI must run the disposable PostgreSQL test
  under the non-bypass app role with `MIRA_TEST_DATABASE_URL`; SKIP is failure,
  not evidence.

**Commit:** `feat(machine-memory): persist historian execution heartbeat`

## Task 2: Build the pure preflight evaluator

**Files**

- Create: `tools/machine_memory_preflight.py`
- Create: `tools/machine_history_provenance.py`
- Create: `tests/test_machine_memory_preflight.py`
- Modify: `tools/cv101_live_gate.py`
- Modify: `tests/test_cv101_live_gate.py`
- Consume: `tests/fixtures/machine-history-provenance.v1.json`

```python
@dataclass(frozen=True)
class MachineMemoryPreflightInput:
    expected_environment: str
    observed_environment: str | None
    heartbeat_run_diff_enabled: bool | None
    heartbeat_machine_memory_uns_path_hashes: tuple[str, ...]
    heartbeat_run_trigger_uns_path_hashes: tuple[str, ...]
    heartbeat_fault_trigger_tag_hashes: tuple[str, ...]
    heartbeat_config_sha256: str | None
    expected_database_identity_hash: str
    observed_database_identity_hash: str | None
    latest_ingested_at: datetime | None
    latest_event_at: datetime | None
    historian_last_started_at: datetime | None
    historian_last_finished_at: datetime | None
    historian_last_status: str | None
    historian_software_version: str | None
    fault_window_id: str | None
    fault_window_started_at: datetime | None
    fault_window_ended_at: datetime | None
    fault_window_row_count: int | None
    fault_window_first_event_at: datetime | None
    fault_window_last_event_at: datetime | None
    replay_from: datetime | None
    replay_to: datetime | None
    replay_returned_row_count: int | None
    replay_observation_count: int | None
    replay_admissible_observation_count: int | None
    physical_rows: int | None
    simulated_rows: int | None
    bad_quality_rows: int | None
    unknown_provenance_rows: int | None
```

- [ ] Produce deterministic `GO`, `NO_GO`, or `UNKNOWN`, ordered reason codes,
  and a redacted JSON snapshot.
- [ ] Replace the CV-101 denylist classifier with the shared positive provenance
  contract and exact `ignition/cv101-bench-gw` requirement. Add arbitrary-source,
  missing/wrong connection, spoofed false, and simulator counterexamples; the
  existing “foreign source” test must assert NO-GO.
- [ ] Include at minimum `ENVIRONMENT_MISMATCH`, `DATABASE_IDENTITY_MISMATCH`,
  `RUN_DIFF_DISABLED`, `CV101_UNS_NOT_CONFIGURED`, `FAULT_TRIGGER_TAGS_NOT_CONFIGURED`,
  `INGEST_UNOBSERVED`, `INGEST_STALE`, `HISTORIAN_EXECUTION_UNOBSERVED`,
  `HISTORIAN_EXECUTION_STALE`, `HISTORIAN_STUCK_RUNNING`,
  `HISTORIAN_LAST_RUN_FAILED`, `FAULT_WINDOW_UNOBSERVED`,
  `FAULT_WINDOW_EMPTY`, `SIMULATED_ONLY`, `GATEWAY_QUALITY_BAD`,
  `UNKNOWN_PROVENANCE`, plus the existing CV-101 gate reason codes.
- [ ] A current ingestion stream without a physical fault window remains NO-GO.
  A cursor or fresh history row without a fresh successful heartbeat remains
  NO-GO.
- [ ] Hash the expected CV-101 UNS path locally and require it in the effective
  heartbeat machine-memory path hashes. Require the approved fault-trigger hash
  separately; do not confuse it with run-start triggers. A workflow input or GitHub environment value is
  expectation only; it can never substitute for historian-emitted config proof.
- [ ] Add `HISTORIAN_VERSION_UNKNOWN` and `HISTORIAN_CONFIG_MISMATCH`; require the
  heartbeat SHA to equal the inspected deployment SHA.
- [ ] Malformed timestamps/counts and any null critical fact produce UNKNOWN,
  never GO.
- [ ] Query/count the exact API replay bounds. `fault_window_row_count` means raw
  events inside that served `[replay_from,replay_to]` anchor window, not state
  duration or total event+diff rows.

**Commit:** `feat(ops): add machine memory preflight evaluator`

## Task 3: Add the approved read-only workflow

**Files**

- Create: `.github/workflows/machine-memory-preflight.yml`
- Create: `tools/qa/machine_memory_preflight_snapshot.py`
- Create: `tests/test_machine_memory_preflight_workflow.py`
- Create: `tests/test_machine_memory_preflight_sql_contract.py`
- Create: `docs/runbooks/machine-memory-preflight.md`

- [ ] Make the workflow manual-only with a required `environment` choice of
  `staging` or `production`; bind the selected GitHub Environment before reading
  secrets.
- [ ] Require an explicit expected tenant UUID and CV-101 UNS path. Refuse an
  environment/URL/database mismatch before querying. Compare the protected
  expected database-identity hash with the hash computed from the supplied DB;
  record only redacted expected/observed hashes.
- [ ] Query the historian-emitted effective config fingerprint, deployment SHA,
  heartbeat, ingest, window, and provenance facts with tenant-scoped `SELECT`s
  only. Do not read an external input as effective deployed config.
- [ ] Save the full redacted snapshot, verdict, commit SHA, workflow run ID, and
  SQL hash as an artifact. Secrets and database URLs are never printed.
- [ ] Contract-test that the workflow/snapshotter contain no `INSERT`, `UPDATE`,
  `DELETE`, deploy, Doppler mutation, equipment endpoint, or Docker-socket path.
- [ ] Parse every shipped snapshotter query in the dedicated SQL-contract test
  and allow only tenant-scoped `SELECT`/CTE statements with explicit replay
  bounds. Reject multi-statements, write-capable CTEs, session-wide tenant state,
  unbounded history scans, and any query not executed after `SET LOCAL
  app.current_tenant_id` in the same transaction.
- [ ] Production dispatch, deployment, flag change, and physical fault creation
  are documented as Mike-only steps.

**Commit:** `feat(ops): add read-only machine memory preflight workflow`

## Task 4: Wire the heartbeat into isolated staging and production services

**Files**

- Modify: `docker-compose.saas.yml` (historian worker stanza only)
- Modify: `docker-compose.staging-vps.yml` (staging Redis + historian worker/beat stanzas only)
- Modify: `.github/workflows/deploy-staging.yml`
- Create: `tests/test_machine_memory_historian_compose.py`

- [ ] Forward fixed `MIRA_DEPLOYMENT_ENVIRONMENT=production`, deployed
  `MIRA_GIT_SHA`, tenant ID, run-diff flag, machine-memory paths, and triggers to
  the production historian worker. Forward `TAG_DIFF_CONFIG_JSON` so its
  fault-trigger hashes describe the effective tag-diff configuration. Do not
  touch dogfood stanzas.
- [ ] Add isolated `stg-mira-redis`, `stg-mira-historian-worker`, and
  `stg-mira-historian-beat` services on `staging-net`, with staging-only names,
  volumes, database/tenant inputs, fixed `MIRA_DEPLOYMENT_ENVIRONMENT=staging`,
  and the same run-diff/path/run-trigger/fault-trigger surface. Run-diff remains
  disabled by default.
- [ ] Export the checked-out 40-character SHA as `MIRA_GIT_SHA` in
  `deploy-staging.yml`, add the three staging services to the explicit/default
  target and health/status output, and never alias missing staging config to
  production.
- [ ] Compose/static tests prove environment, SHA, tenant, DB, queue, network,
  restart, and disabled-default isolation for both deployments. Missing or
  `unknown` SHA makes preflight NO-GO.
- [ ] This PR owns only historian/Redis staging stanzas. Lane E rebases after it
  and alone adds dogfood staging services.

**Commit:** `feat(ops): wire historian heartbeat in staging and production`

## Task 5: Verify and hand off

Run:

```powershell
if (-not $env:MIRA_TEST_DATABASE_URL) { throw 'MIRA_TEST_DATABASE_URL must point to a disposable PostgreSQL database using the non-bypass app role' }
python -m pytest tests/test_machine_memory_preflight.py tests/test_machine_memory_preflight_workflow.py tests/test_machine_memory_preflight_sql_contract.py -q
python -m pytest tests/test_cv101_live_gate.py -q
python -m pytest mira-crawler/tests/test_historian_heartbeat.py mira-crawler/tests/test_historian_postgres_integration.py -q -rs
python -m pytest tests/test_machine_memory_historian_compose.py -q
python -m pytest tests/test_architecture.py -q
python -m ruff check tools/machine_memory_preflight.py tools/machine_history_provenance.py tools/qa/machine_memory_preflight_snapshot.py tests/test_machine_memory_preflight.py tests/test_machine_memory_preflight_workflow.py tests/test_machine_memory_preflight_sql_contract.py mira-crawler/tasks/historize_runs.py mira-crawler/tests/test_historian_heartbeat.py
node mira-hub/db/check-migration-order.mjs
git diff --check origin/main...HEAD
```

The disposable-PostgreSQL job must assert that neither integration module was
skipped, exercise two tenant settings under the non-bypass app role, and inspect
the final privileges/RLS policy. A green unit-only fallback is not evidence.

Then request architecture, industrial-safety, security/RLS, and adversarial test
review. Stop at a green PR. The PR may say “preflight tooling ready”; it may not
say Machine Memory production-ready or seven-day proven.
