# Integrated Technician Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan. Use superpowers:test-driven-development, factorylm-ui-style, mira-industrial-safety, mira-platform, and superpowers:verification-before-completion.

**Goal:** Compose the reviewed camera, identity, Drive Commander, Notebook chat, citation, refusal, safety, and persistence seams into one no-prior-setup mobile journey that completes synthetic proof in at most 60 seconds.

**Architecture:** Home Camera creates a recoverable pending Notebook before analysis, parks the original photo, classifies it as nameplate/fault-display/unknown candidate evidence, and requires technician confirmation before machine identity or Drive Pack binding. Drive Commander becomes a typed, server-confirmed, read-only Notebook source with discriminated citations; the canonical Notebook chat owns supported answers, provider-free refusal, safety STOP, and persisted turns. Machine Memory remains read-only and is never a diagnosis store.

**Tech Stack:** React/TypeScript, Next.js route/domain code, PostgreSQL migrations, Python FastAPI adapter, Drive Pack library, Vitest, pytest, Android/mobile E2E, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-30-technician-showcase-sprint-design.md` and PRDs `docs/prd/2026-08-29-technician-beta-recovery-prd.md`, `docs/prd/2026-08-25-technician-copilot-prd.md`.

## Global Constraints

- Start only after C1/C2, D migration 087, and reviewed E interfaces are on the branch base and PR #3477's `equipment-notebooks.ts` ownership is merged, rebased, or explicitly released. Migrations 088/089 may not be authored on a base lacking 086/087.
- Consume Workstream D's `capturePhoto()` union; never recreate camera permission, gallery, or timestamp logic.
- Home capture owns Notebook machine identity. `ComponentNameplateFlow.tsx` remains component identity inside a machine and must never patch Notebook identity.
- Recognition creates candidate evidence only. Technician action is the only path to `user_confirmed`; no photo auto-verifies, creates, or binds an asset/KG entity.
- A fault display alone cannot establish machine identity. The technician selects/enters manufacturer/model before machine-specific resolution.
- Drive Commander is static reference information: `readOnly:true`, `liveTelemetry:false`, and technician copy `Static Drive Commander reference — not live machine data.`
- Machine Memory is strictly read-only. “Save” means a canonical `equipment_notebook_turns` record and copy `Saved in this notebook.`
- Preserve safety-before-retrieval/provider, tenant isolation, source approval, provider-free refusal, exact citation opening, and no OT writes.
- Do not merge/deploy/distribute, operate hardware, access production/Doppler, or claim real-world OCR/usability. Mike owns later human/device gates.

## Locked Mobile Contracts

```ts
export type HomeCaptureState =
  | { state: "creating"; clientKey: string; file: File }
  | { state: "parking"; notebookId: string; clientKey: string; file: File }
  | { state: "analyzing"; notebookId: string; clientKey: string; fileId: string; file?: File }
  | { state: "review"; notebookId: string; clientKey: string; fileId: string; analysis: HomeCaptureAnalysis; analysisRevision: string }
  | { state: "confirmed"; notebookId: string }
  | { state: "error"; notebookId?: string; clientKey?: string; file?: File; fileId?: string; analysisRevision?: string; code: string };

export type HomeCaptureAnalysis =
  | { kind: "nameplate"; machine: MachineIdentityCandidate; pack: PackResolution | null; rawVisibleText: string[] }
  | { kind: "fault_display"; fault: { code: string | null; visibleText: string[] }; machine: MachineIdentityCandidate | null; pack: PackResolution | null }
  | { kind: "unknown"; rawVisibleText: string[]; reason: string };
```

```ts
beginHomeCapture(clientKey: string): Promise<{ notebook: EquipmentNotebook; replayed: boolean }>;
analyzeHomeCapture(notebookId: string, image: File, clientKey: string): Promise<{ fileId: string; analysis: HomeCaptureAnalysis; analysisRevision: string }>;
resumeHomeCapture(notebookId: string): Promise<{ state: "analyzing" | "review" | "error"; fileId: string; analysis?: HomeCaptureAnalysis; analysisRevision?: string; code?: string }>;
confirmHomeMachine(notebookId: string, input: { identity: MachineIdentityInput; packId?: string | null; analysisRevision: string }, idempotencyKey: string): Promise<{ notebook: EquipmentNotebook; packSource: DrivePackNotebookSource | null }>;
```

## Task 1: Create the pending Notebook intake

**Files:**

- Create: `mira-hub/db/migrations/088_notebook_home_capture_intake.sql`
- Modify: `mira-hub/db/check-migration-order.mjs`
- Modify: `mira-hub/package.json` (required component version bump)
- Modify: `mira-hub/src/lib/equipment-notebooks.ts`
- Create: `mira-hub/src/app/api/equipment-notebooks/home-captures/route.ts`
- Modify: `mira-hub/src/app/api/equipment-notebooks/[id]/route.ts`
- Modify: `mira-mobile/src/api/resources.ts`
- Create: `mira-hub/src/app/api/equipment-notebooks/home-captures/__tests__/route.test.ts`
- Create: `mira-hub/src/lib/__tests__/notebook-home-capture-postgres.integration.test.ts`

- [ ] Add tenant-scoped unique intake client key plus persisted intake phase,
  parked `file_id`, typed analysis JSON, and server-generated analysis revision.
  Migration 088 also creates `home_capture_fixture_authorizations` with tenant
  ID, exact file SHA-256, expected analysis JSON, exact software SHA, run-ID
  hash, and expiry. The app role gets tenant-scoped SELECT only; the staging
  provisioner alone may insert/delete through its admin connection. Disposable
  PostgreSQL tests prove RLS, grants, expiry, tenant/SHA/software matching, and
  rejection when fixture mode is enabled outside staging.
  Safely widen migration 073's identity-source CHECK and TypeScript union to
  allow `home_camera`; no other value becomes legal.
- [ ] Add 088 to `check-migration-order.mjs` after 087 and prove the checker
  fails on reordered dependencies. Implementation stops until migration 088 has
  an assigned GitHub issue for its required `-- Issue: #…` header. Run migration
  088 in disposable PostgreSQL to
  prove CHECK widening, RLS, grants, tenant isolation, unique/idempotent intake,
  and reload projection.
- [ ] Add failing tests: camera acceptance creates `Unidentified machine` with `identityStatus:"unknown"` and source `home_camera` before upload/provider; same tenant/key returns the same Notebook; cross-tenant keys do not collide; reload returns pending state; no asset, KG, Machine Memory, or provider operation occurs.
- [ ] Implement `POST /api/equipment-notebooks/home-captures/` and mobile `beginHomeCapture()` minimally. Commit `feat(notebook): create idempotent home capture intake`.

## Task 2: Park the original photo before classification

**Files:**

- Modify: `mira-hub/src/lib/nameplate/index.ts`
- Create: `mira-hub/src/lib/home-capture-analysis.ts`
- Create: `mira-hub/src/app/api/equipment-notebooks/[id]/home-capture/photo/route.ts`
- Modify: `mira-hub/src/lib/workspace-files.ts`
- Create: `mira-hub/src/lib/__tests__/home-capture-analysis.test.ts`
- Create: `mira-hub/src/app/api/equipment-notebooks/[id]/home-capture/photo/__tests__/route.test.ts`

- [ ] Add a classifier-specific prompt/schema for exactly `nameplate`, `fault_display`, and `unknown`; do not make the existing nameplate recognizer pretend to classify fault displays.
- [ ] Prove file parking/linking completes before recognition; timeout/failure leaves a visible recoverable photo and pending Notebook; MIME, size, tenant, dedup, auth, and observation-receipt rules remain intact. Persist phase/file/analysis/revision after each successful server transition and return `analysisRevision`. `resumeHomeCapture()` reloads parked bytes by authorized `fileId` and can resume analysis without re-upload.
- [ ] Prove deterministic fixtures classify each union member and output never becomes `verified`. Commit `feat(notebook): classify parked home captures`.

## Task 3: Confirm machine identity and bind a typed Drive Pack source

**Files:**

- Modify: `mira-bots/ask_api/drive_pack.py`
- Modify: `mira-bots/tests/test_ask_api_drive_pack.py`
- Create: `mira-hub/src/lib/drive-packs/client.ts`
- Create: `mira-hub/src/app/api/equipment-notebooks/[id]/home-capture/confirm/route.ts`
- Create: `mira-hub/db/migrations/089_notebook_drive_pack_sources.sql`
- Modify: `mira-hub/src/lib/equipment-notebooks.ts`
- Create: `mira-hub/src/app/api/equipment-notebooks/[id]/home-capture/confirm/__tests__/route.test.ts`

- [ ] Add owned `POST /drive-pack/resolve` returning `resolved`, `ambiguous`, or `none` from manufacturer/model/visible text/fault code; reuse canonical pack definitions.
- [ ] Store Drive Packs in dedicated `equipment_notebook_pack_sources`, never fake/empty document UUIDs. Persist pack ID/family/schema version/match state/confirmation actor+time plus literal `readOnly:true`, `liveTelemetry:false` in the read model.
- [ ] Confirm with a compare-and-set on the current server `analysisRevision`; stale review data returns conflict and cannot confirm. Prove edited technician values become machine identity at `user_confirmed`; fault display requires explicit machine identity; pack binding is server validated/idempotent/tenant scoped; client-invented pack IDs fail; no asset is created/bound.
- [ ] Add 089 to `check-migration-order.mjs` after 088 and prove the checker fails
  when either migration is absent or reordered. Implementation stops until 089
  has its own assigned GitHub issue header. Run migration 089 in disposable
  PostgreSQL and prove RLS, grants, tenant FK, Notebook/pack uniqueness,
  idempotency, and rejection of cross-tenant/invented relations. Commit
  `feat(notebook): confirm machine and bind Drive Commander source`.

## Task 4: Implement the unified mobile home-capture reducer and UI

**Files:**

- Create: `mira-mobile/src/lib/home-capture-flow.ts`
- Create: `mira-mobile/src/lib/__tests__/home-capture-flow.test.ts`
- Modify: `mira-mobile/src/screens/NotebooksTab.tsx`
- Modify: `mira-mobile/src/screens/NotebookScreen.tsx`
- Modify: `mira-mobile/src/api/resources.ts`
- Modify: `mira-mobile/src/screens/__tests__/notebook-composer.test.tsx`

- [ ] Drive `creating → parking → analyzing → review → confirmed`. Only
  pre-park states require a browser `File`; server-hydrated analyzing/error
  states retain `fileId` and can retry without re-upload. Keep client key until
  parking and revision through confirmation. Cancellation before acceptance
  creates no Notebook; after acceptance the pending Notebook survives.
- [ ] Navigate to the pending Notebook immediately; show upload/analyze progress there; retain/open the parked image on failure; distinguish nameplate/fault display/unknown; make extracted machine fields editable; require explicit pack confirmation.
- [ ] Prove retry reuses Notebook/photo/key; fault display never supplies silent
  identity; unknown remains correctable; reload during parked/analyzing/failure
  hydrates `fileId` and retries without upload; component flow cannot patch
  machine identity. Commit `feat(mobile): unify camera to confirmed machine notebook`.

## Task 5: Bring Drive Commander through canonical Notebook chat

**Files:**

- Modify: `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts`
- Create: `mira-hub/src/app/api/equipment-notebooks/[id]/pack-sources/[packId]/citations/route.ts`
- Modify: `mira-hub/src/lib/equipment-notebooks.ts`
- Modify: `mira-hub/src/lib/notebook-chat-types.ts`
- Modify: `mira-mobile/src/api/resources.ts`
- Modify: `mira-mobile/src/screens/NotebookScreen.tsx`
- Create: `mira-mobile/src/lib/technician-answer-presentation.ts`
- Create: `mira-mobile/src/lib/__tests__/technician-answer-presentation.test.ts`
- Create: `mira-hub/src/app/api/equipment-notebooks/[id]/chat/__tests__/drive-pack.test.ts`
- Modify: `mira-mobile/src/screens/__tests__/notebook-composer.test.tsx`

- [ ] Make citations a discriminated `document`/`drive_pack` union; pack citation contains canonical pack ID, title, page, excerpt and is authorized by the Notebook-to-pack relation.
- [ ] Preserve server order: authorize → safety matcher → confirmed pack/document sources → deterministic Drive Commander ask → document retrieval → insufficient-evidence gate → grounded provider answer → ordinary Notebook turn persistence.
- [ ] Prove supported pack answer has `basis:"drive_pack"`, `model:null`, exact openable pack citation; pack miss falls through to documents; total miss is provider-free `insufficient_evidence`; client-only pack is rejected.
- [ ] Add safety pressure proving STOP before Drive Commander/retrieval/provider, hazard category/standard/escalation, no citations/unsafe next action/troubleshooting continuation, and fresh non-safety input before resumption.
- [ ] Prove reload restores supported/refusal/safety turns; UI says `Saved in this notebook.` and labels Drive Commander static/read-only/not live.
- [ ] Render the first answer through a view model over the canonical turn, in
  this visible order: `What happened`, `What changed`, `Safe first check`, `Why
  MIRA thinks this`, `Confidence / trust state`. Do not create another answer or
  inference pipeline. On the no-setup/unbound path, `What changed` explicitly
  says trusted live/replay evidence is unavailable; it never reads or writes
  Machine Memory. Add ordered rendered assertions.
- [ ] Commit `feat(chat): ground Notebook turns in confirmed Drive Commander packs`.

## Task 6: Add the strict synthetic 60-second lane

**Files:**

- Create: `tools/mobile-e2e/lane_s.py`
- Create: `tools/mobile-e2e/fixtures/lane_s_nameplate.png`
- Create: `tools/mobile-e2e/fixtures/lane_s_fault_display.png`
- Create: `tests/test_mobile_lane_s.py`
- Create: `.github/workflows/mobile-lane-s.yml`
- Modify: `docker-compose.staging-vps.yml` (Hub authorized-fixture mode only, after E)
- Modify: `mira-hub/scripts/provision-beta-gate.ts` (new-table cleanup only)
- Create: `docs/runbooks/mobile-lane-s.md`

- [ ] Use E's typed staging provisioner plus D's guard, including exact
  `expectedGitSha`. Refuse before mutation unless the job is bound to GitHub
  staging and host/environment/database/SHA all match. Provision an isolated
  tenant/user, canonical Drive Pack, and two expiring run-owned fixture
  authorization rows before timing; no Notebook or identity may pre-exist.
- [ ] Set `t0=time.perf_counter_ns()` immediately before Home Camera click and `deadline=t0+60_000_000_000`. Every wait receives `min(step_cap, remaining)` and fails `lane_s_deadline_exceeded` when remaining is non-positive.
- [ ] Include camera click, pending Notebook, photo parked, candidate, confirmation, pack source, cited answer, citation open, unsupported refusal, safety STOP, full reload, and persistence inside the timer. Stop only after reload assertions; PASS requires `<=60_000 ms` and zero trust failure.
- [ ] Record milestone offsets for every step in a redacted JSON artifact. Run nameplate and fault-display variants independently.
- [ ] Return the selected fixture through D's androidTest-only camera intent responder into the real Capacitor Camera plugin/JS `File`/multipart path. The production APK contains no fixture responder.
- [ ] After real parking, the server computes the file SHA and may use an
  unexpired authorization only when authenticated tenant, SHA, deployed SHA,
  and `MIRA_DEPLOYMENT_ENVIRONMENT=staging` all match. The startup flag is
  `authorized_staging`; production rejects it. No request switch exists. The
  provisioner records authorizations in its mode-0600 ledger; `finally` deletes
  and verifies them with all other run rows. Use workflow concurrency
  `mobile-lane-s-staging-fixture` with `cancel-in-progress:false`. Execute the
  real remaining paths, label fixture-driven vision, and never claim OCR accuracy.
- [ ] `lane_s.py` owns a mode-0600 run ledger and `finally` cleanup for only the
  provisioned tenant/user/Notebook/photo/intake/pack-source/turn/fixture-
  authorization rows. Verify absence and delete the ledger; cleanup failure is
  a hard trust failure.
- [ ] Define `mobile-lane-s.yml` with contract tests on Ubuntu and a `macos-14` API-35 Pixel-6 emulator job using D's portable harness and protected staging Environment. It requires explicit staging URL/database identity/credentials/SHA, has no production/default fallback, runs both fixtures, and uploads redacted traces/screenshots/timing/cleanup evidence.
- [ ] Run pure deadline/evidence tests and the isolated workflow; commit `test(mobile): add one-minute technician showcase gate`.

## Task 7: Verify, review, and hand off

- [ ] Run:

```powershell
Set-Location mira-hub
bun install --frozen-lockfile
bun run test
bun run test:integration:db
bun run lint
bunx tsc --noEmit
bun run build
bun run db:check-order
Set-Location ..\mira-mobile
bun install --frozen-lockfile
bun run test
bun run build
Set-Location ..
python -m pytest mira-bots/tests/test_ask_api_drive_pack.py mira-bots/tests/test_drive_packs_readonly.py tests/test_mobile_lane_s.py tests/test_architecture.py -q
python -m ruff check tools/mobile-e2e/lane_s.py tests/test_mobile_lane_s.py mira-bots/ask_api/drive_pack.py mira-bots/tests/test_ask_api_drive_pack.py
git diff --check origin/main...HEAD
```

- [ ] Run `mobile-lane-s.yml` once per fixture against explicit staging. Retain JSON timings, trace/screenshots, citation/refusal/safety/persistence evidence, cleanup result, environment, and reviewed SHA.
- [ ] Have Codex conduct independent spec and quality reviews at exact head. Fix blockers, rerun, push, and open one reversible PR. No merge/deploy/device/human claim.
- [ ] Write `HANDOFF.md` with exact SHA, contracts, migrations, tests, two timing results, synthetic-classifier limitation, open overlaps, and Mike's remaining signed-APK/physical/human gates.
