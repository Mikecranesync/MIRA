# Machine Memory — read-only preflight (§9.3) and the seven-day observer (§9.4)

**PRD:** `docs/prd/2026-08-29-technician-beta-recovery-prd.md` Workstream C.
**Owner of production execution:** Mike. Claude prepares commands; it never runs
them against production, never changes Doppler, never touches the bench.

Both tools are **read-only by construction**: SELECT-only / GET-only, no
equipment access, no production mutation, no raw production SQL from a code
session, no secrets in output.

---

## 1. Preflight — `tools/machine_memory_preflight.py`

Answers "is Machine Memory operational for CV-101?" with a **GO / NO-GO** and
**stable reason codes**.

| Reports | Source |
|---|---|
| effective `MIRA_RUN_DIFF_ENABLED` | env |
| CV-101 in `MIRA_MACHINE_MEMORY_UNS_PATHS` / `MIRA_RUN_TRIGGERS` | env |
| fault-trigger tags configured | env (`MIRA_RUN_TRIGGERS`) |
| latest ingest heartbeat + age | `max(tag_events.ingested_at)` under the CV-101 subtree |
| latest historian/run-diff execution + age | newest `machine_state_window` derivation for CV-101 |
| latest CV-101 fault window + row count | newest `faulted/estopped` window, `tag_events` in `[start−60 s, end+10 s]` |
| physical / simulated / stale / unknown | `tag_events.simulated`, `quality`, `source_system` |

Reason codes: `DB_NOT_CONFIGURED`, `DB_CONNECT_FAILED`, `TENANT_REQUIRED`, `RUN_DIFF_DISABLED`, `CV101_NOT_CONFIGURED`,
`NO_FAULT_TRIGGERS`, `TABLES_UNAVAILABLE`, `INGEST_NONE`, `INGEST_STALE`,
`HISTORIAN_NONE`, `HISTORIAN_STALE`, `NO_FAULT_WINDOW`, `FAULT_WINDOW_EMPTY`,
`ROWS_SIMULATED`, `ROWS_STALE_QUALITY`. `TABLES_UNAVAILABLE` (no source) is
never reported as `FAULT_WINDOW_EMPTY` (a valid query with zero rows).

### Run it (dev / staging / disposable)

```bash
# read-only URL from env or --db-url; the URL is never printed
python tools/machine_memory_preflight.py --json
# exit 0 = GO, 1 = NO-GO, 2 = refused/usage
```

The gate is **fail-closed**: a database URL is readable only when its host is
loopback (`127.0.0.1`, `localhost`, `::1`) or an operator-named dev/staging
host (`--allow-host <host>` or `MACHINE_MEMORY_PREFLIGHT_ALLOWED_HOSTS`), **and**
the shell is not a production Doppler config (`DOPPLER_CONFIG` /
`DOPPLER_ENVIRONMENT` / `MIRA_ENV` = `prd|prod|production` → refused). Real Neon
hosts carry no "prod" marker, so a hostname denylist would be theatre. A
tenant is **required** (`MIRA_TENANT_ID` or `--tenant-id`) — without one the
tool issues no query and reports `TENANT_REQUIRED`. A driver connection
failure is reported as `DB_CONNECT_FAILED` with no host/user printed.

### Production (Mike)

```bash
python tools/machine_memory_preflight.py --print-command
```
prints the exact invocation. Only Mike runs it, on a machine with
`factorylm/prd` Doppler access; the `--allow-production-by-operator` flag is the
deliberate, operator-only lift of the refusal. Doppler changes the preflight may
recommend (`MIRA_RUN_DIFF_ENABLED=1`, `MIRA_MACHINE_MEMORY_UNS_PATHS`,
`MIRA_RUN_TRIGGERS`) are Mike's to make.

---

## 2. Seven-day observer — `tasks.machine_memory_observer.observe_cv101_machine_memory`

Runs on the **existing** synthetic-dogfood beat (`CELERY_BEAT_PROFILE=synthetic-dogfood`,
daily 06:15 UTC, queue `synthetic`). The beat entry is registered **only when**
`MACHINE_MEMORY_OBSERVER_ENABLED=1` (the same flag gates the task body and is
forwarded to both the worker and the beat container), so a disabled deployment
publishes nothing. The task module is in `celery_app._TASK_MODULES`; a test pins
its registration.
It performs three GETs with the observer's own session and writes its own files:

```
$DOGFOOD_REPORT_DIR/machine-memory-observer/YYYY-MM-DD.json   # one per scheduled day
$DOGFOOD_REPORT_DIR/machine-memory-observer/series.json       # recomputed from the daily files
```

Each daily record carries: `observed_at`, `deployed_version`, `current_connection`
(current-cache freshness), `historian_heartbeat`, `fault_window` identity,
`row_count`, `window_bounds`, `quality`, `classification`
(physical/simulated/stale/unknown), `api_state_consistent`, `defects`.

Defect detectors (`agents/machine_memory_observer.py::evaluate_observation`):
`admissible_without_rows` / `misleading_live` (the API would offer a replay
answer on an empty window) and `unavailable_as_empty` (no history source
presented as "nothing recorded").

`series.json` (`evaluate_series`) reports `days_observed`, `consecutive_days`
(**distinct** calendar days ending at the latest observation — seven runs on
one day are one day), `defects`, `real_fault_window_with_rows` (physical
classification only; simulated never counts), and `operational`.

### Three claims, kept apart

| Claim | How it is established |
|---|---|
| **code ready** | `mira-crawler/tests/test_machine_memory_observer.py` green in CI |
| **synthetic / staging proof** | one run against a Hub with a fixture window; `series.json` shows `days_observed: 1`, `operational: false`, reason `SEVEN_DAYS_NOT_ACCRUED` |
| **operational** | seven consecutive scheduled days in production with no defect **and** at least one real, non-seeded CV-101 fault window containing rows. If no physical fault occurs Mike may create one with the bench's existing physical controls. Claude and the synthetic agents never operate the machine or seed SQL. |

### Enable (Mike, Doppler `factorylm/prd`)

`MACHINE_MEMORY_OBSERVER_ENABLED=1`, `MACHINE_MEMORY_OBSERVER_ASSET_ID=<CV-101 kg id>`,
`MACHINE_MEMORY_OBSERVER_EMAIL` / `_PASSWORD` (an existing user in the tenant that
owns CV-101). Then redeploy `mira-synthetic-dogfood-worker` +
`mira-synthetic-dogfood-beat` via `deploy-vps.yml`. The seven-day artifact Mike
attaches at the §9.5 exit gate is the `series.json` plus the seven daily files.
