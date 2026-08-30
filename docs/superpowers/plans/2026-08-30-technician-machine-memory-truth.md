# Technician Replay Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan. Use superpowers:test-driven-development for every behavior change and superpowers:verification-before-completion before any completion claim.

**Goal:** Make REPLAY useful or explicitly unavailable and admit Ask MIRA only when the served window contains at least one good-quality, physical recorded observation.

**Architecture:** Preserve the existing Hub history route, mobile Replay surface, and notebook evidence admission. Split current cache truth from historical-window truth in the API, carry quality/provenance on historical rows, compute server-owned admissibility, consume those facts explicitly in mobile, and render canonical anomaly titles through one shared catalog.

**Tech Stack:** TypeScript, React/React Native, Next.js route tests, Vitest, Python 3, pytest, Celery, PostgreSQL read-only inspection, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-30-technician-showcase-sprint-design.md` and PRD `docs/prd/2026-08-29-technician-beta-recovery-prd.md` §§9, 12, 14–18.

## Global Constraints

- Branch from current `origin/main` in a fresh isolated worktree; do not write in the coordinator worktree.
- Do not modify the production notebook chat route unless a new failing regression proves the existing admission guard is wrong.
- Do not seed production data, write equipment, change Doppler, deploy, or claim the seven-day gate passed.
- Never infer historian execution from a data timestamp or cursor timestamp. Missing direct execution evidence is `HISTORIAN_EXECUTION_UNOBSERVED`.
- Keep missing history tables distinct from a valid zero-row window.
- Preserve compatibility fields while moving all first-party mobile consumers to the explicit contract.
- Preserve tenant scoping and redact secrets, raw tenant identifiers, credentials, cookies, and tokens.
- Open issues #3469 and #3470 remain open until their deployed evidence gates are satisfied.
- This is the deterministic REPLAY-truth PR only. The separate Machine Memory operations plan owns durable heartbeat, preflight, observer, dogfood integration, compose, workflow, and seven-day evidence.

## Task 1: Separate current connection from historical coverage

**Files:**

- Modify: `mira-hub/src/lib/machine-history.ts`
- Create: `mira-hub/src/lib/machine-history-provenance.ts`
- Create: `tests/fixtures/machine-history-provenance.v1.json`
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
  returnedRowCount: number | null;
  observationCount: number | null;
  admissibleObservationCount: number | null;
  physicalObservationCount: number | null;
  simulatedObservationCount: number | null;
  badQualityObservationCount: number | null;
  unknownProvenanceCount: number | null;
  from: string;
  to: string;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
}
```

- [ ] Extend `MachineHistory` and `AssetHistory` with `currentConnection` and `historicalCoverage`. Derive current connection only from `summary.live_tags`; derive count and first/last observed bounds only from the served historical rows. `returnedRowCount` is serialized events plus diffs; `observationCount` is raw event rows only.
- [ ] Add `source_system`, `source_connection_id`, and `simulated` to event rows. Migration 037 diff rows expose only `source_system` and `simulated`; select those two and serialize `source_connection_id:null` for diffs. Never query the nonexistent `tag_event_diffs.source_connection_id`.
- [ ] Use a positive physical-provenance contract. Generic Replay recognizes only `ignition`, `plc_bridge`, or `relay`, requires `simulated === false` and a non-empty `source_connection_id`; all other false/null/unknown combinations are unknown and cannot unlock Ask MIRA. CV-101 production proof is stricter: exact `ignition` + `cv101-bench-gw` until Mike changes the approved pair.
- [ ] Classify raw events in this order: explicit/synthetic-source simulated; then positive physical producer+connection; otherwise unknown. Count physical/simulated/unknown as an exhaustive partition of `observationCount`; within physical, good quality is admissible and every other/null quality is bad-quality. Diffs contribute only to `returnedRowCount`, never any observation/admission count.
- [ ] Put accepted/counterexample rows in the shared JSON fixture and consume it in Hub tests plus the later Python preflight/observer suites. Include arbitrary source with `simulated:false`, missing/wrong connection, spoofed false, explicit simulator, and the exact CV-101 pair.
- [ ] Make the focused Hub route test load that fixture and assert both count
  contracts: `returnedRowCount` includes events plus diffs, while
  `observationCount` and every provenance/admission partition exclude diffs.
- [ ] For missing tables return `available:false` and every count `null`, with `rows:[]` and `reason:"unavailable"`. For a valid quiet window return `available:true` and all counts `0`.
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
- [ ] Implement the actual rule set A0–A10 plus A12 (there is no A11) and this public resolver:

```ts
export function canonicalAnomalyTitle(
  ruleId: string | null,
  fallbackTagPath: string,
  persistedTitle?: string | null,
): string;
```

- [ ] Resolve titles by complete known-rule mapping first. Use a sanitized persisted title only for unknown rules, and a humanized leaf only for unknown non-anomaly diffs. Do not let arbitrary persisted metadata override canonical known-rule titles and do not add a one-off `_stale_s` replacement.
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

- [ ] Compute actionability from `historicalCoverage.available`, non-null `admissibleObservationCount > 0`, and `reason !== "unavailable"`. Only then construct `MachineEvidenceWindow`, render `Ask MIRA what happened`, or call `askNotebook`.
- [ ] Label the current cache explicitly as `Current connection`; never place its `Live` state in the historical-window heading. Keep both clocks visible when they materially diverge.
- [ ] Prove empty, unavailable, simulated-only, bad-quality-only, and unknown-provenance windows send no `machineEvidence`; an admissible physical window sends the exact server-returned bounds; simulated current connection is explicit and never described as live.
- [ ] Run the focused mobile tests/build and commit `fix(sensor): make empty replay non-actionable`.

## Task 4: Enforce provider-free refusal at the server boundary

**Files:**

- Modify: `mira-hub/src/app/api/equipment-notebooks/[id]/chat/__tests__/machine-evidence.test.ts`
- Modify: `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts`

- [ ] Add regressions proving empty, unavailable, simulated-only, bad-quality-only, and unknown-provenance machine-only requests do not call a provider, return `insufficient_evidence`, emit no evidence frame, and never persist an `answered` turn. The server must use `historicalCoverage.admissibleObservationCount`, not client-supplied row count, as the machine-history admission fact.
- [ ] Add a mixed-source regression proving empty machine selection plus valid documents may answer only with `basis:"oem_documentation"`, without a machine prompt section or machine-grounded label.
- [ ] Replace the current `machineEntry.rowCount > 0` admission with the server-fetched `historicalCoverage.available`, non-null `admissibleObservationCount > 0`, and `reason !== "unavailable"`. Client row counts or provenance fields are never trusted. Persist the full returned window for honesty, but add it to provider/prompt evidence only when admitted.
- [ ] Commit the narrow guard and tests as `fix(chat): require admissible Machine Memory evidence`.

## Task 5: Verify, review, and hand off

- [ ] Run Hub tests, lint, and build:

```bash
cd mira-hub
npm test -- "src/app/api/assets/[id]/history/__tests__/route.test.ts" "src/lib/machine-context-intelligence.test.ts" "src/components/MachineMemoryCard.test.tsx" "src/app/api/equipment-notebooks/[id]/chat/__tests__/machine-evidence.test.ts"
npm run lint -- src/lib/machine-history.ts src/lib/machine-context-intelligence.ts src/lib/machine-anomaly-catalog.ts src/components/MachineMemoryCard.tsx
npm run build
```

- [ ] Confirm the focused Hub output names every shared provenance-fixture
  counterexample and the returned-versus-observation count split; a fixture that
  is present but not consumed is a failure.

- [ ] Run mobile tests and build:

```bash
cd mira-mobile
npm test -- src/lib/__tests__/replay.test.ts src/screens/__tests__/sensor-replay.test.tsx
npm run build
```

- [ ] Run crawler producer tests and the freshness/diff gates:

```bash
cd mira-crawler
python -m pytest tests/test_machine_memory.py -q
cd ..
python -m pytest tests/regime7_ignition/test_no_customer_write_paths.py tests/integration/test_machine_evidence_proof.py::TestStep7NoWrites -q
python -m ruff check mira-crawler/run_engine/machine_memory.py mira-crawler/tests/test_machine_memory.py
bash wiki/orchestrator/freshness-guard.sh docs/prd/2026-08-29-technician-beta-recovery-prd.md mira-hub/src/lib/machine-history.ts mira-mobile/src/screens/SensorSheet.tsx mira-mobile/src/screens/ReplayTimeline.tsx mira-crawler/run_engine/machine_memory.py
git diff --check origin/main...HEAD
```

- [ ] Have Codex perform separate spec-compliance and code-quality reviews against the exact head. Fix all release-blocking findings, rerun affected tests, push the branch, and open one independently reversible PR referencing #3469 and #3470 without auto-closing them.
- [ ] Write `HANDOFF.md` with exact commit, changed files, test outputs, artifact paths, and the fact that this PR closes deterministic behavior only. Reference the operational plan and the current run `33297349547` blocker: `REPLAY`, `STALE_OBSERVATION`, and `GATEWAY_QUALITY`.
- [ ] Stop at the PR boundary. Do not claim Workstream C complete or close #3469/#3470; durable historian heartbeat, preflight, scheduled observation, deployed UI/API evidence, and the seven-day human gate remain separate work.
