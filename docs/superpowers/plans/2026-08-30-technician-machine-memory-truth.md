# Technician Machine Memory Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan. Use superpowers:test-driven-development for every behavior change and superpowers:verification-before-completion before any completion claim.

**Goal:** Make REPLAY useful or explicitly unavailable, add an honest read-only operational preflight, and collect the PRD's seven-day CV-101 evidence without inventing live state.

**Architecture:** Preserve the existing Hub history route, mobile Replay surface, notebook evidence admission, historian, CV-101 classifier, and synthetic-dogfood scheduler. Split current cache truth from historical-window truth in the API, consume those facts explicitly in mobile, render canonical anomaly titles through one shared catalog, and attach read-only observation/preflight adapters around existing production seams.

**Tech Stack:** TypeScript, React/React Native, Next.js route tests, Vitest, Python 3, pytest, Celery, PostgreSQL read-only inspection, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-30-technician-showcase-sprint-design.md` and PRD `docs/prd/2026-08-29-technician-beta-recovery-prd.md` §§9, 12, 14–18.

## Global Constraints

- Branch from current `origin/main` in a fresh isolated worktree; do not write in the coordinator worktree.
- Do not modify the production notebook chat route unless a new failing regression proves the existing admission guard is wrong.
- Do not seed production data, write equipment, change Doppler, deploy, or claim the seven-day gate passed.
- Never infer historian execution from a data timestamp or cursor timestamp. Missing direct execution evidence is `HISTORIAN_EXECUTION_UNOBSERVED`.
- Keep missing history tables distinct from a valid zero-row window.
- Preserve compatibility fields while moving all first-party mobile consumers to the explicit contract.
- Extend the existing six-hour synthetic-dogfood cadence; do not add a second scheduler, issue reporter, artifact root, or credential system.
- Preserve tenant scoping and redact secrets, raw tenant identifiers, credentials, cookies, and tokens.
- Open issues #3469 and #3470 remain open until their deployed evidence gates are satisfied.

## Task 1: Separate current connection from historical coverage

**Files:**

- Modify: `mira-hub/src/lib/machine-history.ts`
- Modify: `mira-hub/src/app/api/assets/[id]/history/__tests__/route.test.ts`
- Modify: `mira-mobile/src/lib/replay.ts`
- Modify: `mira-mobile/src/api/resources.ts`
- Modify: `mira-mobile/src/lib/__tests__/replay.test.ts`

- [ ] Add failing Hub route tests named `reports current live connection separately from an empty historical window`, `reports missing history tables as unavailable rather than zero`, `reports returned and observed bounds for non-empty history`, and `keeps stale and simulated classifications under current connection`.
- [ ] Define and return the same additive contract in Hub and mobile:

```ts
export interface CurrentConnection {
  freshness: FreshnessSummary;
}

export interface HistoricalCoverage {
  available: boolean;
  observationCount: number | null;
  from: string;
  to: string;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
}
```

- [ ] Extend `MachineHistory` and `AssetHistory` with `currentConnection` and `historicalCoverage`. Derive current connection only from `summary.live_tags`; derive count and first/last observed bounds only from the served historical rows.
- [ ] For missing tables return `available:false`, `observationCount:null`, `rows:[]`, and `reason:"unavailable"`. For a valid quiet window return `available:true` and `observationCount:0`.
- [ ] Retain the old top-level `freshness` only as a temporary compatibility alias. Add a failing mobile parser test proving `null` and `0` remain distinct and first-party code receives both new objects.
- [ ] Run the focused route/parser tests and commit `feat(machine-memory): separate current connection from replay coverage`.

## Task 2: Render canonical anomaly titles

**Files:**

- Create: `mira-hub/src/lib/machine-anomaly-catalog.ts`
- Modify: `mira-hub/src/lib/machine-context-intelligence.ts`
- Modify: `mira-hub/src/lib/machine-context-intelligence.test.ts`
- Modify: `mira-hub/src/components/MachineMemoryCard.tsx`
- Modify: `mira-hub/src/components/MachineMemoryCard.test.tsx`
- Modify: `mira-crawler/run_engine/machine_memory.py`
- Modify: `mira-crawler/tests/test_machine_memory.py`
- Modify: `mira-hub/src/lib/machine-memory.ts`
- Modify: `mira-hub/src/lib/machine-memory-response.ts`

- [ ] Add failing tests proving A0 on `_stale_s` renders `PLC/bridge offline`, A2 remains canonical, the active-fault summary preserves the next check, raw UNS/internal pseudo-topics never enter a title, unknown custom diffs degrade deterministically, and `MachineMemoryCard` uses the same mapper.
- [ ] Implement the complete A0–A12 catalog and this public resolver:

```ts
export function canonicalAnomalyTitle(
  ruleId: string | null,
  fallbackTagPath: string,
  persistedTitle?: string | null,
): string;
```

- [ ] Resolve titles by sanitized persisted canonical title first, complete known rule mapping second, and a humanized leaf only for unknown non-anomaly diffs. Do not add a one-off `_stale_s` replacement.
- [ ] Add canonical `title` and `message` to new `MachineAnomaly.metadata` rows, expose `metadata.title` through the existing Hub read model, and retain the catalog fallback for historical rows. This is additive and requires no migration.
- [ ] Run the focused Python/Hub tests and commit `fix(machine-memory): render canonical anomaly titles`.

## Task 3: Make empty replay non-actionable

**Files:**

- Modify: `mira-mobile/src/screens/SensorSheet.tsx`
- Modify: `mira-mobile/src/screens/ReplayTimeline.tsx`
- Modify: `mira-mobile/src/screens/__tests__/sensor-replay.test.tsx`
- Modify: `mira-mobile/src/lib/replay.ts`
- Modify: `mira-mobile/src/lib/__tests__/replay.test.ts`

- [ ] Add failing tests for valid empty, unavailable, current-live plus empty history, non-empty current-live, non-empty stale, simulated, widened-window bounds, and divergent event/ingest clocks.
- [ ] Export this exact copy from `replay.ts` and render it for a valid zero-row window:

```ts
export const REPLAY_EMPTY_COPY =
  "Nothing was recorded in this window. Widen the window or check the gateway.";
```

- [ ] Compute actionability from `historicalCoverage.available`, non-null `observationCount > 0`, and `reason !== "unavailable"`. Only then construct `MachineEvidenceWindow`, render `Ask MIRA what happened`, or call `askNotebook`.
- [ ] Label the current cache explicitly as `Current connection`; never place its `Live` state in the historical-window heading. Keep both clocks visible when they materially diverge.
- [ ] Prove empty and unavailable windows send no `machineEvidence`; non-empty windows send the exact server-returned bounds; simulated current connection is explicit and never described as live.
- [ ] Run the focused mobile tests/build and commit `fix(sensor): make empty replay non-actionable`.

## Task 4: Pin provider-free refusal without changing production logic

**File:**

- Modify: `mira-hub/src/app/api/equipment-notebooks/[id]/chat/__tests__/machine-evidence.test.ts`

- [ ] Add regressions proving empty and unavailable machine-only requests do not call a provider, return `insufficient_evidence`, emit no evidence frame, and never persist an `answered` turn.
- [ ] Add a mixed-source regression proving empty machine selection plus valid documents may answer only with `basis:"oem_documentation"`, without a machine prompt section or machine-grounded label.
- [ ] If these tests pass on the existing route, make no production route change. Commit the tests with Task 3 or as `test(chat): pin empty Machine Memory refusal`.

## Task 5: Add the read-only Machine Memory preflight

**Files:**

- Create: `tools/machine_memory_preflight.py`
- Create: `tests/test_machine_memory_preflight.py`
- Create: `.github/workflows/machine-memory-preflight.yml`
- Create: `docs/runbooks/machine-memory-preflight.md`

- [ ] Write failing pure-classifier tests for every stable code: `RUN_DIFF_DISABLED`, `CV101_UNS_NOT_CONFIGURED`, `CV101_RUN_TRIGGER_NOT_CONFIGURED`, `INGEST_UNOBSERVED`, `INGEST_STALE`, `HISTORIAN_EXECUTION_UNOBSERVED`, `HISTORIAN_EXECUTION_STALE`, `HISTORIAN_LAST_RUN_FAILED`, `FAULT_WINDOW_UNOBSERVED`, `FAULT_WINDOW_EMPTY`, `HISTORY_UNAVAILABLE`, `SIMULATED_ONLY`, `GATEWAY_QUALITY_BAD`, and reused CV-101 codes `REPLAY`, `STALE_OBSERVATION`, and `PROVENANCE`.
- [ ] Implement this pure input boundary and deterministic evaluator:

```py
@dataclass(frozen=True)
class MachineMemoryPreflightInput:
    run_diff_enabled: bool
    machine_memory_uns_paths: tuple[str, ...]
    run_triggers: tuple[str, ...]
    latest_ingested_at: datetime | None
    latest_event_at: datetime | None
    historian_last_execution_at: datetime | None
    historian_last_status: str | None
    historian_cursor_updated_at: datetime | None
    fault_window_id: str | None
    fault_window_started_at: datetime | None
    fault_window_ended_at: datetime | None
    fault_window_row_count: int | None
    fault_window_first_event_at: datetime | None
    fault_window_last_event_at: datetime | None
    physical_rows: int
    simulated_rows: int
    bad_quality_rows: int

def evaluate_machine_memory_preflight(
    snapshot: MachineMemoryPreflightInput,
    *,
    now: datetime,
    expected_uns_path: str,
) -> dict: ...
```

- [ ] Reuse `tools/cv101_live_gate.py` for physical/simulated/replay classification. Malformed or missing evidence is `UNKNOWN`/NO-GO; current-live without a fault window is still NO-GO.
- [ ] Make the workflow manual and read-only. Allowlist exactly the three Machine Memory environment names, obtain direct Celery task completion from timestamped historian container logs, and use tenant-scoped `SELECT` queries for ingest, cursor, window, rows, bounds, quality, and provenance.
- [ ] Persist the complete redacted snapshot and verdict as the GitHub run artifact. If logs are absent after container replacement, report `HISTORIAN_EXECUTION_UNOBSERVED`; do not substitute rows or cursor state as an execution heartbeat.
- [ ] Add static safety tests proving SQL is SELECT-only; the workflow has no Doppler mutation, deploy, Docker mutation, equipment/control call, or unallowlisted environment output; and reason ordering is deterministic.
- [ ] Document the prepared staging and production commands. State that Mike alone dispatches production and changes environment/deploy state.
- [ ] Run the focused root tests and commit `feat(ops): add Machine Memory preflight`.

## Task 6: Observe CV-101 for seven scheduled days

**Files:**

- Create: `mira-crawler/agents/machine_memory_observer.py`
- Create: `mira-crawler/tests/test_machine_memory_observer.py`
- Modify: `mira-crawler/tasks/synthetic_dogfood.py`
- Modify: `mira-crawler/tests/test_synthetic_dogfood.py`
- Modify: `mira-crawler/celeryconfig.py`
- Modify: `mira-crawler/tests/test_celery_tasks.py`
- Modify: `docker-compose.saas.yml`
- Modify: `docs/runbooks/synthetic-dogfood-agents.md`

- [ ] Write failing tests for one idempotent record per UTC day; seven consecutive dates; required deployed version/timestamp; empty versus unavailable; stale/simulated/bad-quality/unknown classes; physical provenance that cannot be inferred from `simulated=false`; one non-seeded physical CV-101 window with rows/bounds; UI/API consistency; read-only behavior; and observation even when Playwright dogfood fails.
- [ ] Implement:

```py
@dataclass(frozen=True)
class MachineMemoryObservation:
    schema_version: int
    observed_at: str
    software_version: str
    uns_path: str
    current_connection: dict
    historian_heartbeat: dict
    fault_window: dict | None
    quality_classification: str
    physical_rows: int
    simulated_rows: int
    ui_api_consistent: bool | None

def observe_machine_memory(...) -> MachineMemoryObservation: ...
def append_daily_observation(path: Path, observation: MachineMemoryObservation) -> bool: ...
def evaluate_seven_day_gate(observations: Sequence[MachineMemoryObservation]) -> dict: ...
```

- [ ] Use tenant-scoped API/database reads and the existing artifact directory. Never grant the dogfood container Docker socket access. The preflight artifact, not this observer, owns direct historian execution proof.
- [ ] Run the observer from the existing synthetic-dogfood cycle even when the Playwright journey fails. Keep the existing six-hour beat schedule and deduplicate observations to a single append-only UTC-day record.
- [ ] Add environment documentation/defaults with observation disabled unless explicitly configured, dry-run issue mode, redacted output, and no new credentials or scheduler.
- [ ] Run the crawler suites and commit `feat(dogfood): observe Machine Memory for seven days`.

## Task 7: Verify, review, and hand off

- [ ] Run Hub tests, lint, and build:

```bash
cd mira-hub
npm test -- "src/app/api/assets/[id]/history/__tests__/route.test.ts" "src/lib/machine-context-intelligence.test.ts" "src/components/MachineMemoryCard.test.tsx" "src/app/api/equipment-notebooks/[id]/chat/__tests__/machine-evidence.test.ts"
npm run lint -- src/lib/machine-history.ts src/lib/machine-context-intelligence.ts src/lib/machine-anomaly-catalog.ts src/components/MachineMemoryCard.tsx
npm run build
```

- [ ] Run mobile tests and build:

```bash
cd mira-mobile
npm test -- src/lib/__tests__/replay.test.ts src/screens/__tests__/sensor-replay.test.tsx
npm run build
```

- [ ] Run crawler/root suites and the freshness/diff gates:

```bash
cd mira-crawler
python -m pytest tests/test_machine_memory.py tests/test_historize_runs_integration.py tests/test_synthetic_dogfood.py tests/test_machine_memory_observer.py tests/test_celery_tasks.py -q
cd ..
python -m pytest tests/test_cv101_live_gate.py tests/test_machine_memory_preflight.py -q
bash wiki/orchestrator/freshness-guard.sh docs/prd/2026-08-29-technician-beta-recovery-prd.md mira-hub/src/lib/machine-history.ts mira-mobile/src/screens/SensorSheet.tsx mira-mobile/src/screens/ReplayTimeline.tsx mira-crawler/tasks/synthetic_dogfood.py
git diff --check origin/main...HEAD
```

- [ ] Have Codex perform separate spec-compliance and code-quality reviews against the exact head. Fix all release-blocking findings, rerun affected tests, push the branch, and open one independently reversible PR referencing #3469 and #3470 without auto-closing them.
- [ ] Write `HANDOFF.md` with exact commit, changed files, test outputs, artifact paths, skipped production evidence, and the operational blocker from run `33297349547`: `REPLAY`, `STALE_OBSERVATION`, and `GATEWAY_QUALITY`.
- [ ] Stop at the human gate. Mike restores PLC↔Ignition, authorizes production settings/deploy, creates a physical fault using bench controls, dispatches the preflight, waits for seven consecutive observations, and attaches the qualifying artifact. Workstream C remains open until then.
