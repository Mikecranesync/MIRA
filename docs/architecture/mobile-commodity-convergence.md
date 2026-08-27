# Mobile Commodity Convergence — Phase 1 Audit

**Governing PRD:** `docs/prd/2026-08-26-commodity-first-mobile-prd.md`
**Agent rule:** `.claude/rules/commodity-before-custom.md`
**Status:** Phase 1 (read-only audit) — complete. No production code modified.
**Method:** full read of `mira-mobile/src` (7,771 lines: 14 screens, 11 lib modules, api
client/resources, App shell, native `MainActivity.java` grep), plus device evidence from the
2026-08-26 Pixel 9a passes (#3427 comment thread, PR #3413 `2026-08-26_p2b-*` screenshots) and
the #3427/#3429 Chromium touch-harness findings.
**Date:** 2026-08-26

---

## 1. Classification table (PRD §15)

| Area | Current implementation | Classification | Recommendation |
|---|---|---|---|
| Fullscreen image viewer (pinch/pan/double-tap/close) | Custom pointer-event gesture engine, `screens/FilePreview.tsx` `FullscreenImageViewer` + pure zoom math + tap-slop guard + back registry (~200 lines + 2 test files) | **CUSTOM — REPLACE** | Adopt a maintained viewer (candidates §3.1) behind ONE `MediaViewer` abstraction; port #3429 acceptance behavior as the contract |
| Image orientation / rotation | Nothing explicit (CSS `object-fit: contain` only) | PLATFORM (by omission) | Covered by the replacement viewer; verify landscape on device (PRD Test C) |
| Inline image preview + thumbnails | `ImagePreview`, `SourceThumb` (`FilePreview.tsx`) — plain `<img>` off authenticated blob URLs | CUSTOM — JUSTIFIED (trivial) | KEEP; thumbnail stays a plain `<img>` |
| File picking (photo + PDF) | `@capawesome/capacitor-file-picker` via `lib/native-pick.ts` seam (mime-lie normalization, #3353/#3403) | MATURE LIBRARY + justified glue | KEEP; the seam's mime normalization is domain-truth glue, not gesture code |
| Camera capture | Not implemented — photo comes from the gallery picker (#3353 open) | GAP → PLATFORM | Use `@capacitor/camera` when #3353 lands; do NOT hand-roll `getUserMedia` capture |
| QR scanning | `qr-scanner` (MIT) in `screens/ScanView.tsx`, explicit permission/teardown states | MATURE LIBRARY | KEEP |
| Upload / binary fetch | `api/client.ts` `requestBinary` (session-cookie fetch → blob URL; ADR-0034 trust boundary) | MIRA DOMAIN | KEEP — this is the authenticated-evidence boundary, not commodity |
| PDF viewing | `PdfPreview` — honest non-renderer with a documented seam; hands off via `<a download>` | CUSTOM — JUSTIFIED seam, **BROKEN handoff** (§3.2) | KEEP the seam; fix the handoff with a platform capability; evaluate a real viewer per PRD §8 in Phase 3 |
| Text viewing | None — text/plain falls to `OpaquePreview` ("No in-app preview") | GAP | Render text directly (PRD §8 allows); trivial once the provenance fix makes .txt rarely user-facing |
| Arbitrary-file opening ("Open with another app") | `<a download href="blob:...">` in `OpaquePreview`/`PdfPreview` | **CUSTOM — REPLACE (likely inert on device)** | Android WebView ignores blob `<a download>` without a native `DownloadListener`; `MainActivity.java` has none and no Share/FileOpener plugin is installed. Use `@capacitor/share` or a file-opener plugin. Device-verify first (§3.2) |
| Bottom sheets / modals | Hand-rolled `sheet-backdrop`/`sheet` divs repeated at 8+ sites (NotebookScreen ×5, AssetsTab, AttachFileSheet, FilesScreen) — backdrop-click close, `stopPropagation`, no focus trap, no `aria-modal`, no scroll lock | **CUSTOM — REPLACE/CONSOLIDATE** | ONE `Sheet` component (headless lib such as Radix Dialog, or one tiny approved component) that self-registers with the modal/BACK stack (§3.3) |
| Android hardware BACK | Three mechanisms: per-tab `backRef` closure chains that manually enumerate sheet states (`NotebookScreen.tsx:143-166`), the #3429 viewer LIFO registry (`FilePreview.tsx`), and `CapApp.minimizeApp()` fallback (`App.tsx:82-89`) | **CUSTOM — CONSOLIDATE** | One modal/nav stack owning BACK (PRD §11). The viewer registry IS the seed: generalize it so every transient layer (sheet, viewer, flow) registers on open; `backRef` chains stop enumerating sheets by hand |
| App resume / blank-screen recovery | `lib/resume-guard.ts` + native half (#3392) — WebView renderer-death probe/reload | CUSTOM — JUSTIFIED | KEEP — platform workaround with documented device evidence; nothing commodity replaces it |
| Transient-screen restoration | Nameplate flow auto-resumes into its confirm sheet on relaunch (device-observed 2026-08-26, #3427 footer obs 1; once auto-opened the photo picker) | **CUSTOM — FIX** | Transient flows must not survive force-stop into a modal; tie flow persistence to the BACK/modal stack work |
| Deep links | `@capacitor/app` `appUrlOpen` → `handleDeepLink` (`App.tsx`) | PLATFORM | KEEP |
| Offline queue (work orders) | `lib/offline-queue.ts` over `@capacitor/preferences` | MIRA DOMAIN | KEEP |
| OTA / live update | `@capawesome/capacitor-live-update` via `lib/live-update.ts` | MATURE LIBRARY | KEEP |
| SSE chat stream | `lib/sse.ts` custom fetch-based parser | CUSTOM — JUSTIFIED | KEEP — `EventSource` cannot send auth headers; custom fetch-SSE is the standard workaround; unit-tested |
| Attach-to-targets sheet | `AttachFileSheet.tsx` — filing semantics, idempotency key, pre-checked existing links | MIRA DOMAIN (in commodity sheet chrome) | KEEP semantics; migrate its chrome onto the approved `Sheet` |
| Gesture/pointer/touch-action inventory | ONLY `FullscreenImageViewer` carries pointer handlers/`touch-action` (verified by grep — no other pointer/touch handlers in `src/`) | — | Convergence surface is exactly one component; replacing the viewer removes ~100% of custom gesture code |
| External manual links | `target="_blank"` anchors in `ComponentNameplateFlow.tsx` (241, 262, 334) to OEM URLs | REVIEW | Verify device behavior (should open system browser); prefer an explicit platform open |

## 2. What the audit says overall

The codebase is **better than the trigger incident suggests**: custom gesture code exists in
exactly one component, pickers/QR/OTA/deep-links already use platform or maintained libraries,
and the domain seams (authenticated bytes, filing idempotency, honest PDF non-renderer,
nameplate FSM) are well-drawn and documented in-place. The convergence debt concentrates in
four places:

1. **The media viewer** — the one true custom gesture engine, already responsible for a
   multi-session debugging arc (#3427 → #3429 → this PRD).
2. **BACK/modal architecture** — three parallel mechanisms; sheets are closed by hand-written
   enumeration in each screen's `backRef`. This is where the "BACK closes the wrong thing"
   class of bugs is manufactured.
3. **File handoff to the OS** — `<a download>` on blob URLs with no native `DownloadListener`
   and no Share/FileOpener plugin: the "Open with another app" / "Open in your PDF viewer"
   buttons are very likely no-ops on the Pixel. (Unverified on device; mechanism is standard
   WebView behavior. Device-verify, then fix via platform capability.)
4. **Transient-flow restoration** — the nameplate flow resurrecting its modal (and once the
   system photo picker) after force-stop.

## 3. Detail

### 3.1 Media viewer (CUSTOM — REPLACE)

Current: `FullscreenImageViewer` — pointer-Map pinch/pan bookkeeping, double-tap detection,
pure zoom math (`clampZoom`/`pinchZoom`/`panBy`/`doubleTapZoom`), #3429's `isCloseTap` slop
guard and `registerViewerBack` LIFO. The #3429 harness work proved WHY custom gesture code is
expensive here: browser click synthesis silently dies past tap slop; `touch-action: none`
placement changes which events arrive at all; every fix needed a real-Chromium harness to
verify. All of that is table stakes inside any maintained viewer.

Candidates to evaluate against PRD §13 (licenses MIT — compliant with PRD §4):

- **`yet-another-react-lightbox`** (MIT, actively maintained, React 18, first-class zoom
  plugin with pinch/double-tap/pan, controlled open/close, TypeScript). Leading candidate.
- **PhotoSwipe v5** (MIT, framework-agnostic, battle-tested touch handling; React wrapper is
  thin but adds a non-React core).
- Keep-native option: none — Capacitor has no built-in image viewer; a native-viewer plugin
  would add a second UI stack for one screen. Not recommended.

Requirements for the replacement (from PRD §7 + #3429 acceptance): pinch, pan, double-tap,
reset, reliable close under jittery taps, hardware-BACK participation (via the modal stack),
orientation, large images (a 4000px nameplate photo), blob-URL sources (authenticated bytes —
no remote loading), and WebView compatibility. **Port, don't discard:** the #3429 device
acceptance (close under jitter, BACK order) becomes the acceptance test of the replacement;
the pure zoom-math tests retire with the code they test.

Wrap it: ONE `MediaViewer` component is the only import site; the library never leaks into
screens. Classification of today's viewer until then: **valid interim fix (#3429), scheduled
for replacement** (PRD §16).

### 3.2 File handoff (likely broken on device)

`PdfPreview` and `OpaquePreview` render `<a download href={blobUrl}>`. Android WebView does
not honor downloads (blob: or otherwise) unless the host app installs a
`DownloadListener`/handles them natively; `MainActivity.java` installs none, and no
`@capacitor/share` / file-opener plugin is present in `package.json`. Expected device
behavior: tap does nothing — the same silent-dead-button class as #3427.

Fix direction (Phase 3): write bytes to cache via `@capacitor/filesystem` and hand off with
`@capacitor/share` or a maintained file-opener plugin; keep the web build's `<a download>` as
the browser path. Verify on device first — this audit's claim is mechanism-based, not yet
device-proven.

### 3.3 BACK / modal stack (CONSOLIDATE)

Target model (PRD §11): one LIFO stack of transient layers; BACK pops the top; per-screen
`backRef` handles only real navigation (detail → list → tab). #3429's
`registerViewerBack`/`closeTopViewer` is the pattern, deliberately generic — rename/promote
it to a `transient-layer` registry, make the ONE `Sheet` component register on mount, and
delete the hand-written sheet enumeration from `NotebookScreen.tsx:143-166`, `AssetsTab`,
`More`, `FilesScreen` back handlers. Focus trap, `aria-modal`, and scroll lock come free if
the Sheet adopts a headless dialog primitive (Radix Dialog is MIT, React 18, WebView-safe);
that choice goes through PRD §13 evaluation in Phase 3.

### 3.4 Evidence & provenance (MIRA DOMAIN — the Phase 2 defect)

Device evidence (2026-08-26, Harrington notebook, app 1.0.4 / prod v3.297.0 + mig 084):

- Sources list shows **three duplicate rows** of the same `nameplate-12ac8c22-….txt` (plus a
  second nameplate txt) — duplicate logical evidence, violating PRD §6.
- Citation [1] → "Open original at cited page 1" renders the **.txt sidecar**, not the
  photograph — violating PRD §10. Screenshots: PR #3413 `2026-08-26_p2b-*.png`.

Client-side resolution chain (verified in code — the client is NOT the defect):

- Citation sheet photo-first rendering requires `citedOriginFileId`, computed as
  `sources.find(s => s.docId === viewCitation.docId)?.originFileId`
  (`NotebookScreen.tsx:219-220`). A citation whose `docId` lands on a duplicate source row
  with `originFileId = NULL` therefore loses the photograph, and "Open original" falls back
  to `viewCitation.fileId` — the derived .txt's own file id (`NotebookScreen.tsx:668-681`).
- The source-row sheet does the same: `fileId={openSource.originFileId ?? openSource.fileId}`
  (`NotebookScreen.tsx:722`) — NULL origin ⇒ txt opens.

So the mobile client faithfully renders what the server contract hands it; the defect is that
the server can (a) present multiple source rows for one logical evidence object and (b) emit
citations bound to a doc row whose source lacks origin provenance. Server-side root cause:
see §4 (hub-side investigation).

**Contract restatement (PRD §18):** one captured photograph = one user-visible source;
`origin_file_id` present on every photo-derived source row (or resolvable through the
canonical evidence object); citation → doc → source → origin resolution deterministic under
duplicates; confirm/replay idempotent on a stable evidence key.

## 4. Hub-side provenance investigation (PRD §17)

_Findings from the read-only mira-hub trace are recorded in
`docs/architecture/provenance-investigation-2026-08-26.md` (companion file in this PR)._

## 5. Phase plan (restated against this audit)

- **Phase 2 — Provenance repair** (unblocked, highest value): fix the confirm/replay
  idempotency key and origin linking per §4's findings; acceptance = PRD Tests A/B/F +
  regression suite (PRD §20). Does not touch the viewer.
- **Phase 3 — Commodity convergence** (ordered): (1) media viewer replacement behind
  `MediaViewer`; (2) transient-layer registry + ONE Sheet; (3) file handoff via platform
  capability; (4) text preview. Each lands as its own PR with the PRD §12 escalation note
  pre-answered.
- **Phase 4 — Device acceptance**: next APK; run the PRD §22 journey on the Pixel, including
  the previously-inert handoff buttons and Test C/D on the replacement viewer.

## 6. Approved primitives registry (living)

| Behavior | Approved primitive |
|---|---|
| File/photo picking | `@capawesome/capacitor-file-picker` via `lib/native-pick.ts` |
| Camera capture | `@capacitor/camera` (when #3353 lands) |
| QR scanning | `qr-scanner` via `ScanView` |
| OTA updates | `@capawesome/capacitor-live-update` via `lib/live-update.ts` |
| Key-value persistence | `@capacitor/preferences` |
| Deep links / app lifecycle / BACK events | `@capacitor/app` |
| Authenticated file bytes | `api/client.ts` `requestBinary` (never `window.open`) |
| Chat streaming | `lib/sse.ts` |
| Fullscreen media viewing | _interim:_ `FullscreenImageViewer` (#3429) → _target:_ `MediaViewer` wrapper over the Phase 3 library selection |
| Sheets/modals + BACK | _interim:_ per-screen `backRef` + viewer registry → _target:_ transient-layer stack + ONE `Sheet` |
| OS file handoff | _target:_ `@capacitor/share`/file-opener (Phase 3); current `<a download>` is suspect on device |

Additions to this table go through `.claude/rules/commodity-before-custom.md`.
