# Android Credibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan. Use superpowers:test-driven-development for every behavior change, factorylm-ui-style for operator-facing controls, and superpowers:verification-before-completion before any completion claim.

**Goal:** Make every camera-labelled Android action open native capture, preserve truthful gallery access and evidence timestamps, present native chat as honestly buffered, and produce checksum-bound native acceptance evidence.

**Architecture:** Add one discriminated camera adapter beside the existing gallery/PDF picker, route all four photography actions through it, record server-owned observation receipt on the attachment relationship rather than the SHA-deduplicated file, expose one transport-capability decision to Notebook UI, and extend the existing Android harness without changing the WebView cookie/CORS trust boundary.

**Tech Stack:** React/TypeScript, Capacitor 8, `@capacitor/camera` (MIT), Vitest, Next.js/TypeScript, PostgreSQL migration, Android Gradle/instrumentation, adb.

**Spec:** `docs/superpowers/specs/2026-08-30-technician-showcase-sprint-design.md` and PRD `docs/prd/2026-08-29-technician-beta-recovery-prd.md` §§10, 12, 14–18.

## Global Constraints

- Start from current `origin/main` in a fresh isolated worktree after the Machine Memory lane releases `mira-mobile/src/screens/SensorSheet.tsx`.
- Do not merge or mechanically rebase PR #3436. Salvage its compatible dependency/options/test ideas only; the new PR supersedes it.
- Do not merge PR #3454 or move auth cookies/CORS across the WebView boundary. Native remains buffered; issue #3453 stays open absent a Mike-approved ADR.
- Keep gallery and document selection separate and honestly labelled. Keep QR scanning unchanged.
- Preserve existing parking, MIME sniffing, 8 MB limit, SHA dedup, tenant ownership, source association, citation, and provider-free refusal paths.
- Server observation receipt is authoritative; client timestamps never become canonical evidence.
- Do not install/distribute an APK, touch Play Console, choose a new production `versionCode`, or claim physical camera proof. Mike owns the Pixel gate.
- Apply FactoryLM UI tokens and muted-normal/state-only color rules to all new operator-facing copy and controls.

## Locked Interfaces

```ts
export type CameraCaptureOutcome =
  | { status: "captured"; file: File; clientKey: string }
  | { status: "cancelled" }
  | { status: "permission_denied" }
  | { status: "no_camera" }
  | { status: "failed"; reason: "unreadable_result" | "plugin_error" };

export function capturePhoto(fallbackName?: string): Promise<CameraCaptureOutcome>;
export function captureNameplatePhoto(): Promise<CameraCaptureOutcome>;
export function cameraCaptureMessage(
  outcome: Exclude<CameraCaptureOutcome, { status: "captured" }>,
): string | null;
```

```ts
export type ChatTransportCapabilities =
  | { mode: "streaming"; incremental: true; cancellable: true }
  | { mode: "buffered"; incremental: false; cancellable: false };

export function chatTransportCapabilities(): ChatTransportCapabilities;
```

Camera copy is exact: cancellation is silent; permission is `Camera permission is off. Allow camera access in Settings, then try again.`; no camera is `No camera is available on this device. Choose an existing photo instead.`; other failure is `The photo could not be captured. Try again or choose an existing photo.`

## Task 1: Add the honest native-camera outcome module

**Files:**

- Modify: `mira-mobile/package.json`
- Modify: `mira-mobile/bun.lock`
- Modify: `mira-mobile/src/lib/native-pick.ts`
- Modify: `mira-mobile/src/lib/__tests__/native-pick.test.ts`
- Regenerate: `mira-mobile/android/capacitor.settings.gradle`
- Regenerate: `mira-mobile/android/app/capacitor.build.gradle`

- [ ] Add `@capacitor/camera:^8`, resolve/freeze the lockfile, and record its MIT license.
- [ ] Write failing tests proving `Camera.getPhoto()` receives `source:CameraSource.Camera`, `resultType:Uri`, `quality:90`, `correctOrientation:true`, and `saveToGallery:false`; it never calls `FilePicker.pickImages()`; both path and webPath yield correct bytes/name/MIME; off-device capture does not invoke Camera.
- [ ] Add failing tests for the exact Android messages: `User cancelled photos app` → cancelled; `User denied access to camera` → permission; `Device doesn't have a camera available` or `Unable to resolve camera activity` → no camera; missing/unreadable URI → `failed/unreadable_result`; all other rejections → `failed/plugin_error`.
- [ ] Implement the locked union and copy resolver. Generate `clientKey = crypto.randomUUID()` only after a readable successful result. Do not reuse `pickOne()` because it intentionally erases error semantics.
- [ ] Keep `pickPhoto()` as gallery-only through `FilePicker.pickImages()` and keep `pickPdf()` unchanged.
- [ ] Run focused native-pick tests and Capacitor sync; commit `feat(mobile): add honest native camera capture outcomes`.

## Task 2: Make all camera and gallery actions truthful

**Files:**

- Modify: `mira-mobile/src/screens/NotebookScreen.tsx`
- Modify: `mira-mobile/src/screens/NotebooksTab.tsx`
- Modify: `mira-mobile/src/screens/SensorSheet.tsx`
- Modify: `mira-mobile/src/screens/__tests__/notebook-composer.test.tsx`
- Modify: `mira-mobile/src/screens/__tests__/sensor-look.test.tsx`
- Modify: `mira-mobile/src/screens/__tests__/sensor-read.test.tsx`
- Create: `mira-mobile/src/screens/__tests__/camera-actions.test.tsx`

- [ ] Add failing UI tests proving all four native photography controls—Notebook nameplate, Home nameplate, Sensor LOOK, Sensor READ nameplate—call `capturePhoto()`/`captureNameplatePhoto()` and no camera-labelled control calls the gallery picker.
- [ ] Add a separately labelled `Choose an existing photo` action using `pickPhoto()` anywhere photography is offered on device. Do not mislabel the server workspace file chooser as the phone gallery.
- [ ] Prove cancellation preserves the previous view, performs no recognize/LOOK/upload, and renders no toast. Prove permission/no-camera/failure show the three exact distinct messages.
- [ ] Send successful camera and gallery files into the same existing `recognizeComponentNameplate()` or `lookAtPhoto()` paths. Keep hidden `capture="environment"` inputs as web fallback only.
- [ ] Run QR regressions proving the scan control still uses `ScanView`/QR scanner with no QR implementation change.
- [ ] Run focused screen tests/build and commit `fix(mobile): make camera and gallery actions truthful`.

## Task 3: Record observation time independently of file dedup

**Files:**

- Create: `mira-hub/db/migrations/086_workspace_file_link_observation.sql`
- Modify: `mira-hub/src/lib/workspace-files.ts`
- Modify: `mira-hub/src/app/api/equipment-notebooks/[id]/look/route.ts`
- Modify: `mira-hub/src/app/api/equipment-notebooks/[id]/nameplate/recognize/route.ts`
- Modify: `mira-hub/src/app/api/equipment-notebooks/[id]/route.ts`
- Modify: `mira-mobile/src/api/resources.ts`
- Modify: `mira-mobile/src/screens/SensorSheet.tsx`
- Modify: `mira-hub/src/lib/__tests__/workspace-files.test.ts`
- Modify: `mira-hub/src/app/api/equipment-notebooks/[id]/look/__tests__/look.test.ts`
- Modify: `mira-hub/src/app/api/equipment-notebooks/[id]/nameplate/__tests__/recognize.test.ts`
- Modify: `mira-hub/src/app/api/equipment-notebooks/[id]/__tests__/get-photos.test.ts`
- Modify: `mira-hub/src/app/api/equipment-notebooks/[id]/chat/__tests__/machine-evidence.test.ts`
- Modify: `mira-mobile/src/lib/__tests__/sensor-look.test.ts`
- Modify: `mira-mobile/src/screens/__tests__/sensor-look.test.tsx`

- [ ] Add migration columns `workspace_file_links.observation_client_key TEXT` and `observed_at TIMESTAMPTZ`, a 1–128 character check for non-null keys, and a backfill `observed_at=created_at` only for existing photo links.
- [ ] Extend `AttachTarget` with `observationClientKey?: string | null`, `WorkspaceFileLink`/`AttachOutcome` with `observedAt:string|null`, and leave non-photo callers compatible.
- [ ] Write failing relationship tests for same bytes/different key → same file/newer server receipt; same bytes/same key retry → same file/same receipt; a forged client timestamp cannot influence receipt; attachments without an observation key do not overwrite observation metadata.
- [ ] In the existing attachment upsert, generate `observed_at` in PostgreSQL/server. First photo key stores it; same key preserves it; a different action key on the same SHA/file/notebook updates it.
- [ ] Send the camera/gallery action key through both LOOK and component-nameplate multipart routes. Fix Sensor LOOK so Retry retains the capture's original key rather than minting one inside each `look()` invocation.
- [ ] Change Notebook `photos[]` and `photoLinkedToTarget()` to use `COALESCE(l.observed_at,l.created_at)`, never canonical file `created_at`, while retaining tenant, role=`photo`, and raster checks. Prove chat persists that canonical receipt.
- [ ] Rerun MIME, size, SHA dedup, tenant, park-before-provider-failure, and evidence-linkage tests. Commit `fix(hub,mobile): record camera observation receipt independently of file dedup`.

## Task 4: Present Android Notebook chat as buffered

**Files:**

- Create: `mira-mobile/src/lib/chat-transport.ts`
- Create: `mira-mobile/src/lib/__tests__/chat-transport.test.ts`
- Modify: `mira-mobile/src/screens/NotebookScreen.tsx`
- Modify: `mira-mobile/src/screens/__tests__/notebook-composer.test.tsx`

- [ ] Add capability tests for native `{mode:"buffered",incremental:false,cancellable:false}` and web `{mode:"streaming",incremental:true,cancellable:true}`.
- [ ] Add failing Notebook tests proving native busy copy is exactly `MIRA is answering...`, there is no `Stop generating`, and `askNotebook()` receives neither `signal` nor `onUpdate`.
- [ ] In native buffered mode, do not create partial/stopped turns; add only the final parsed server result to `liveTurns`, once, even if a buffered body contains multiple SSE content frames.
- [ ] Prove failure restores the exact question plus the entire existing `PendingSend` object so Retry is byte-identical for scope, mode, history, machine evidence, and visual evidence.
- [ ] Keep the web AbortController, incremental painting, Stop behavior, and stopped-turn rendering unchanged. Avoid `mira-mobile/src/api/client.ts` unless a comment must be corrected, preventing PR #3477 overlap.
- [ ] Run transport/composer/request-stream/SSE tests and commit `fix(mobile): present Android notebook answers as buffered`.

## Task 5: Open captured evidence from the turn

**Files:**

- Modify: `mira-mobile/src/screens/NotebookScreen.tsx`
- Modify: `mira-mobile/src/screens/__tests__/notebook-composer.test.tsx`

- [ ] Change `VisualEvidenceCards` to receive `onOpen:(entry:VisualObservationEntry)=>void` and render persisted/live observation cards as accessible buttons.
- [ ] Prove clicking either opens the existing `FilePreview` by `fileId`, including a new live photo before Notebook detail refresh; displayed time is `entry.capturedAt`; source citations and Photos keep their existing open paths; viewability never adds a photo to chat scope.
- [ ] Commit `feat(mobile): open captured evidence from notebook turns`.

## Task 6: Add the native acceptance and release-evidence gate

**Files:**

- Delete: `mira-mobile/android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java`
- Create: `mira-mobile/android/app/src/androidTest/java/com/factorylm/mira/CameraIntentInstrumentedTest.java`
- Modify only for required test dependencies: `mira-mobile/android/app/build.gradle`
- Modify: `tools/mobile-e2e/journey.py`
- Modify: `tools/mobile-e2e/run.sh`
- Create: `.github/workflows/android-native-gate.yml`
- Modify: `docs/release/android/README.md`
- Create: `docs/runbooks/android-camera-buffered-acceptance.md`

- [ ] Replace the generated wrong-package placeholder with correct `com.factorylm.mira` instrumentation. Prove plugin compilation/registration, camera action launches `MediaStore.ACTION_IMAGE_CAPTURE`, and cancellation creates no multipart request or workspace file.
- [ ] Drive a synthetic JPEG across the real JS/native seam through production `uploadMultipart()` and staging LOOK/nameplate routes; record returned file/link IDs and observation receipt. Prove gallery remains reachable, buffered copy/no Stop, Retry, and evidence opening.
- [ ] Make `tools/mobile-e2e/run.sh` always rebuild the requested SHA or verify an explicit APK hash; it may never silently reuse a stale APK.
- [ ] Record a redacted evidence manifest with head SHA, package, versionCode/versionName, native fingerprint, APK variant/SHA-256, signer certificate SHA-256, emulator model/serial/API, exact build/install/test/restore/rollback commands, camera-intent result, staging tenant hash, returned file/link hashes, LOOK/nameplate result, and buffered/no-Stop assertions.
- [ ] State explicitly that automated evidence proves intent/plugin/synthetic-byte integration, not a physical lens, viewfinder, permission dialog, or Pixel ergonomics.
- [ ] Commit `test(mobile): add Android camera and buffered-response acceptance gate`.

## Task 7: Verify, review, and hand off

- [ ] Run mobile verification:

```powershell
Set-Location mira-mobile
bun install --frozen-lockfile
bunx vitest run src/lib/__tests__/native-pick.test.ts src/lib/__tests__/chat-transport.test.ts src/lib/__tests__/request-stream.test.ts src/lib/__tests__/sse-incremental.test.ts src/lib/__tests__/sensor-look.test.ts src/lib/__tests__/sensor-read.test.ts src/screens/__tests__/camera-actions.test.tsx src/screens/__tests__/notebook-composer.test.tsx src/screens/__tests__/sensor-look.test.tsx src/screens/__tests__/sensor-read.test.tsx src/lib/__tests__/native-fingerprint-wiring.test.ts
bun run build
node node_modules/@capacitor/cli/bin/capacitor sync android
node scripts/native-fingerprint.mjs
node scripts/ota-guard.mjs origin/main HEAD
```

- [ ] Record the OTA guard's expected non-zero result as proof that the native dependency requires an APK. Run Android verification:

```powershell
Set-Location android
.\gradlew.bat --no-daemon testDebugUnitTest
.\gradlew.bat --no-daemon connectedDebugAndroidTest
.\gradlew.bat --no-daemon assembleDebug
```

- [ ] Run Hub verification:

```powershell
Set-Location ..\..\mira-hub
bun install --frozen-lockfile
bunx vitest run 'src/lib/__tests__/workspace-files.test.ts' 'src/app/api/equipment-notebooks/[id]/look/__tests__/look.test.ts' 'src/app/api/equipment-notebooks/[id]/nameplate/__tests__/recognize.test.ts' 'src/app/api/equipment-notebooks/[id]/__tests__/get-photos.test.ts' 'src/app/api/equipment-notebooks/[id]/chat/__tests__/machine-evidence.test.ts'
bun run db:check-order
bunx tsc --noEmit
Set-Location ..
git diff --check origin/main...HEAD
```

- [ ] Hash and inspect the built APK with `Get-FileHash`, `aapt dump badging`, `apksigner verify --print-certs`, `adb shell dumpsys package com.factorylm.mira`, and `adb shell am instrument -w com.factorylm.mira.test/androidx.test.runner.AndroidJUnitRunner`.
- [ ] Have Codex independently review specification compliance and code quality at the exact head. Fix release-blocking findings, rerun affected verification, push, and open one reversible PR that says `Supersedes #3436` without closing #3453.
- [ ] Write `HANDOFF.md` with exact SHA, dependency/license, files, test output, native fingerprint, APK/signer checksums, emulator limitations, rollback, and the physical smoke checklist.
- [ ] Stop at Mike's Pixel gate: checksum-match/install APK; exercise rear viewfinder, cancellation, permission denial, nameplate and LOOK capture; verify receipt/evidence/opening; verify buffered/no Stop; record build/device/signer; restore/rollback. Workstream D remains open until that artifact exists.
