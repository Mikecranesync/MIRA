# Machine Memory Seven-Day Observer Implementation Plan

> **Execution:** Use `superpowers:test-driven-development`, `mira-platform`,
> `mira-industrial-safety`, `factorylm-ui-style`, and
> `superpowers:verification-before-completion`.

**Goal:** Observe CV-101 without control writes, preserve every scheduled result,
prove that the visible Replay UI agrees with its API, and compute a conservative
seven-day readiness verdict.

**PR boundary:** This PR owns the pure observer, append-only artifact contract,
UI/API consistency probe, and evaluator. The Synthetic Recovery Battery PR owns
the shared dogfood task, schedule, compose, and runbook integration to avoid
overlapping writers.

## Global constraints

- Read-only: no equipment/control endpoints and no SQL mutation.
- Staging automation must fail closed to an explicit staging Hub URL, staging
  database, synthetic tenant, and synthetic user. No production default.
- Generic “physical” requires source in `ignition|plc_bridge|relay`, a non-empty
  connection ID, `simulated=false`, good quality, and an actual raw observation.
  CV-101 production proof requires the exact Mike-approved pair
  `ignition/cv101-bench-gw`. Absence, arbitrary source, wrong connection, or a
  spoofed false flag is unknown—not physical.
- The observer consumes the durable heartbeat from migration 086; it never
  infers task execution from data, cursors, or logs.
- Artifacts are redacted, append-only, and keyed by run ID. Daily evaluation
  reduces every run in a UTC day to the worst state; first-write-wins is banned.

## Task 1: Define the observation and evaluator contracts

**Files**

- Create: `mira-crawler/agents/machine_memory_observer.py`
- Create: `mira-crawler/tests/test_machine_memory_observer.py`

```python
@dataclass(frozen=True)
class MachineMemoryObservation:
    schema_version: int
    run_id: str
    status: str
    reason_codes: tuple[str, ...]
    expected_run_at: str
    observed_at: str
    software_version: str
    environment: str
    tenant_id_hash: str
    uns_path: str
    current_connection: dict
    historian_heartbeat: dict
    historical_coverage: dict
    fault_window: dict | None
    quality_classification: str
    physical_rows: int | None
    simulated_rows: int | None
    bad_quality_rows: int | None
    unknown_provenance_rows: int | None
    ui_api_consistency: dict | None
    cleanup_status: str
    provenance_attestation: dict | None
```

- [ ] Parse a redacted, tenant-scoped API/preflight snapshot into an observation.
- [ ] Consume `tests/fixtures/machine-history-provenance.v1.json` in Python tests
  so Hub, preflight, observer, and CV-101 counterexamples stay aligned.
- [ ] Preserve `available=false/count=null` versus a valid empty window/count 0.
- [ ] Classify physical, simulated-only, bad-quality, stale, replay, unknown, and
  unavailable separately by reusing `tools/cv101_live_gate.py`.
- [ ] Reject raw credentials, database URLs, email addresses, and unredacted
  tenant/user IDs from the serialized contract.
- [ ] Append one file per scheduled run under `<root>/<yyyy-mm-dd>/<run-id>.json` with
  create-new semantics. A duplicate run ID is idempotent only when bytes match.
- [ ] Write a redacted failure envelope from an outer `finally` even when
  preflight/UI parsing or the main observer fails. `expected_run_at`, status, and
  ordered reason codes are still present.
- [ ] Evaluate seven complete UTC days after enablement and require every
  expected six-hour slot (28 invocations), with an explicit bounded scheduler
  tolerance. Reduce all observations in each day to its worst trust state, so a
  later failure or three missing cycles cannot be hidden by one pass.
- [ ] Require at least one non-seeded physical CV-101 fault window with positive
  admissible rows and first/last event bounds.
- [ ] Any UI/API mismatch, missing slot/day, stale/failed heartbeat, bad quality,
  simulated-only evidence, unknown provenance, or cleanup failure blocks.
- [ ] The final gate accepts a separate passing staging UI/API proof only when it
  names the exact same software SHA as every production observation. Production
  physical rows can never be replaced by staging rows.

**Commit:** `feat(dogfood): define machine memory observation gate`

## Task 2: Add the actual UI/API consistency journey

**Files**

- Create: `mira-mobile/vite.e2e.config.ts`
- Create: `mira-hub/tests/e2e/machine-memory-consistency.spec.ts`
- Create: `mira-hub/tests/e2e/helpers/machine-memory-consistency.ts`
- Create: `mira-hub/playwright.machine-memory.config.ts`
- Create: `mira-crawler/tests/test_machine_memory_ui_probe_contract.py`

- [ ] The E2E Vite configuration requires `MOBILE_E2E_HUB_URL`; it has no
  production fallback and accepts only the workflow's allowlisted staging host.
- [ ] Define explicit inputs `MOBILE_E2E_URL`, `MOBILE_E2E_HUB_URL`,
  `MACHINE_MEMORY_E2E_COOKIE`, `MACHINE_MEMORY_E2E_NOTEBOOK_ID`,
  `MACHINE_MEMORY_E2E_ASSET_ID`, `MACHINE_MEMORY_E2E_RUN_ID`, and
  `MACHINE_MEMORY_UI_RESULT_PATH`, `MACHINE_MEMORY_EXPECTED_GIT_SHA`, and D's
  protected database-identity inputs. Run the shared guard before auth/probe;
  refuse missing input, SHA/DB mismatch, non-staging host, cross-host pair, or a
  result path outside the run artifact directory.
- [ ] C3 performs no provisioning or cleanup. Lane E provides the isolated
  staging Notebook/asset session and retains cleanup ownership.
- [ ] Capture the exact `/api/assets/.../history` response that populated the
  mobile UI with Playwright response routing; do not issue a second independent
  “latest” request that can race a new fault window.
- [ ] Compare API `available`, admissible count, current-connection label,
  historical empty/unavailable copy, Ask MIRA visibility, and event/ingest clocks
  with the visible DOM.
- [ ] Atomically create `machine-memory-ui-api-consistency.json` at the explicit
  result path with schema `{schemaVersion,runId,observedAt,environment,
  softwareSha,assetIdHash,anchorWindowId,window,apiFacts,visibleFacts,consistent,reasonCodes}`.
  Facts are bounded booleans/counts/labels; response bodies, raw IDs, cookies,
  screenshots, and secrets are forbidden.
- [ ] A mismatch fails the Playwright test and marks the observation failed.
- [ ] Compare exact `anchor.windowId`, `window.from`, and `window.to` in addition
  to coverage/count/labels/actions/clocks.
- [ ] Add contract tests proving explicit staging inputs and no production URL
  default in this lane.
- [ ] Lock Playwright `webServer` to start `mira-mobile` with
  `vite.e2e.config.ts` on a fixed loopback port; the Hub test's base URL is that
  mobile server, while direct API requests use only `MOBILE_E2E_HUB_URL`.

**Commit:** `test(machine-memory): prove replay UI and API consistency`

## Task 3: Add the standalone observer command

**Files**

- Create: `tools/qa/machine_memory_observer.py`
- Create: `tests/test_machine_memory_observer_cli.py`
- Create: `docs/runbooks/machine-memory-seven-day-observer.md`

- [ ] Accept an explicit preflight snapshot plus optional UI/API result and
  `--artifact-root`, `--environment staging|production`, `--software-version`,
  `--run-id`, `--expected-run-at`, and `--cleanup-result`.
- [ ] Staging requires the UI/API result. Production requires
  `--production-authorized`, exact `GITHUB_RUN_ID`/repository/workflow identity,
  and a job bound to the GitHub `production` Environment; direct ad-hoc
  production invocation is rejected.
- [ ] Refuse missing inputs, environment/SHA disagreement, stale heartbeat, path
  traversal, symlink targets, or an artifact root outside the configured run
  directory.
- [ ] Write observation atomically with owner-only permissions and print only the
  redacted verdict/path.
- [ ] `--evaluate` reads the append-only records, applies worst-state daily
  reduction, and emits stable GO/NO-GO reasons.
- [ ] Prove crash-safe partial-file cleanup and idempotent exact replay.
- [ ] Production observations always use `cleanup_status:"not_applicable"` and
  `provenance_attestation:null` and never provision/clean product rows. The final
  evaluator alone consumes Mike's separate attestation. Staging observations
  require a schema-validated `cleanup_status:"verified"` result from E; any
  other value blocks.

**Commit:** `feat(ops): add standalone machine memory observer`

## Task 4: Add the Mike-authorized production observation workflow

**Files**

- Create: `.github/workflows/machine-memory-production-observer.yml`
- Create: `tests/test_machine_memory_production_observer_workflow.py`

- [ ] Run every six hours and by manual dispatch, but execute the production job
  only when repository variable `MACHINE_MEMORY_PROD_OBSERVER_ENABLED == '1'`.
  Mike alone sets that variable after reviewing/deploying C2 and creating the
  physical bench condition.
- [ ] Bind the job to the GitHub `production` Environment, run the C2 preflight
  snapshotter with tenant-scoped SELECTs, then invoke the observer with
  `--production-authorized`. No deployment, Doppler mutation, provisioner,
  equipment endpoint, or SQL write exists in this workflow.
- [ ] Upload one immutable redacted observation artifact named with workflow run
  ID and SHA on every enabled run, including NO-GO results. Absence never passes.
- [ ] A final manual `evaluate` job uses the GitHub Actions API to download every
  observer artifact in the requested UTC range, verifies repository/workflow/run
  provenance, applies worst-state daily reduction, and takes an explicit passing
  staging UI/API result artifact for the same SHA. That staging artifact must
  come from the protected workflow identity
  `.github/workflows/machine-memory-staging-evidence.yml`; a VPS path or manual
  upload is rejected.
- [ ] Final evidence also requires Mike's separate physical-fault attestation
  naming the bench control used, operator, UTC start/end, approved
  `ignition/cv101-bench-gw` provenance, and matching first/last event bounds.
  Software does not claim it can prove a privileged SQL seed never occurred.
- [ ] Contract tests prove the enable gate, production environment binding,
  read-only command surface, same-SHA UI proof, exactly 28 expected six-hour
  slots across seven complete UTC dates, scheduler-tolerance boundaries,
  outer-finally failure envelopes, and no production fallback in staging code.

**Commit:** `feat(ops): schedule authorized machine memory observation`

## Task 5: Hand the shared staging integration to the recovery lane

The Synthetic Recovery Battery implementation must consume this command after
its visible journeys and must own all edits to:

- `mira-crawler/tasks/synthetic_dogfood.py`
- `mira-crawler/tests/test_synthetic_dogfood.py`
- `mira-crawler/celeryconfig.py`
- `docker-compose.staging-vps.yml` (dogfood stanzas only, after C2)
- `.github/workflows/deploy-staging.yml` (dogfood targets only, after C2)
- `docs/runbooks/synthetic-dogfood-agents.md`

Integration requirements:

- all persona and CV-101 provisions complete before any journey starts;
- observer runs even when another persona journey fails;
- the existing six-hour cadence remains the only schedule;
- every scheduled run gets its own observation file;
- issues remain dry-run until Mike explicitly enables writes;
- cleanup is verified after all isolation checks;
- staging inputs remain mandatory and production defaults are removed.

## Task 6: Verify and hand off

Run:

```powershell
python -m pytest mira-crawler/tests/test_machine_memory_observer.py tests/test_machine_memory_observer_cli.py mira-crawler/tests/test_machine_memory_ui_probe_contract.py tests/test_machine_memory_production_observer_workflow.py tests/regime7_ignition/test_no_customer_write_paths.py tests/integration/test_machine_evidence_proof.py::TestStep7NoWrites -q
python -m ruff check mira-crawler/agents/machine_memory_observer.py mira-crawler/tests/test_machine_memory_observer.py tools/qa/machine_memory_observer.py tests/test_machine_memory_observer_cli.py mira-crawler/tests/test_machine_memory_ui_probe_contract.py
npm --prefix mira-mobile test -- src/screens/__tests__/sensor-replay.test.tsx
Set-Location mira-hub
npx playwright test tests/e2e/machine-memory-consistency.spec.ts --config=playwright.machine-memory.config.ts --project=chromium
Set-Location ..
git diff --check origin/main...HEAD
```

Request architecture, safety, privacy/artifact, and adversarial review. Stop at a
green PR. Only Mike may dispatch production inspection, create the physical bench
fault, or approve the final seven-day evidence.
