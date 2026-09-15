# ChatGPT-Class UI — Compatibility Spike Execution Plan

**PRD:** [docs/prd/2026-08-30-chatgpt-class-ui-prd.md](../prd/2026-08-30-chatgpt-class-ui-prd.md) §8.3 · **ADRs:** 0038, 0039  

**Read-only-program note:** the spike is code, but it ships nothing — it lives on a branch in the `C:/wt-chatui` worktree, never deploys, and satisfies the recovery PRD's stabilization-first constraint (Phase 0 is inventory + spike only). Every PR is HELD for Mike.

## Where the spike lives

- **Hub host page:** `mira-hub/src/app/(hub)/labs/chat-spike/page.tsx` — a route that renders only when `can(capabilities,"chat_v2")` (added to `capabilities.ts` for dev roles only) AND `process.env.NODE_ENV !== "production"`. Not linked from any nav.
- **Adapter code under test:** `mira-hub/src/lib/chat-adapter/` (per adapter ADR layout).
- **Mobile bridge check:** no mobile app changes; the Capacitor-specific criteria run the *hub-built* spike bundle inside a local debug WebView build of mira-mobile pointed at the spike page — see "cannot be proven on web" below. Mobile-side pure-logic proofs go in `mira-mobile/src/chat-adapter/__tests__/` against recorded fixtures.
- **Fixtures:** recorded SSE transcripts captured from the real route into `mira-hub/src/lib/chat-adapter/__fixtures__/` (answered, abstain, safety, stopped-partial, provider-error, evidence-heavy). Source of truth for recording: the existing route tests (`chat-stop-persist.test.ts`, `chat-safety-stop.test.ts`, `chat-canonical-seam.test.ts`) already exercise these paths — reuse their harness to emit transcripts.
- **Dependencies:** `@assistant-ui/react` (+ `@assistant-ui/react-markdown` when criterion 3 needs it), pinned exact versions, MIT verified — added to `mira-hub/package.json` only (never touch `mira-mobile/package.json` version fields — frozen-lockfile rule).

## The seven exit criteria

### 1. Render a persisted MIRA thread
- **Against:** `GET /api/equipment-notebooks/[id]/` → `{notebook, sources, turns, photos}` on staging, plus a checked-in `turns[]` fixture for deterministic tests.
- **Build:** `frames-to-parts.ts` hydration path: `NotebookServerTurn[]` → canonical parts (text + source + machine_evidence + observation), synthesizing message IDs from row ids; stopped turns (`answer_status==='error' && answer_text`) render the "Stopped" caption with zero citations.
- **Pass:** a fixture thread containing an answered turn with 3 citations, a stopped partial, an insufficient_evidence turn, and a machine-evidence turn renders in assistant-ui with correct per-turn treatment; unit test snapshots the part JSON.

### 2. Send a message with an image attachment
- **Against:** the real two-step: `POST /api/namespace/node/{nodeId}/files/` (upload) then attach (`uploadSourceToNotebook`, `resources.ts:583`) — OR the LOOK-photo path (`visualEvidence.fileId` claim on the chat POST, server-verified via `photoLinkedToTarget`).
- **Honesty note:** no chat surface has composer attachments today (inventory §8) — this criterion proves the *plumbing*, not parity. Implement an `AttachmentAdapter` whose `send()` runs the upload pipeline and returns the fileId; the subsequent `onNew` rides it as `visualEvidence`.
- **Pass:** on staging, attach a JPEG in the spike composer → file lands via the real upload route → chat turn carries the fileId → server's observation entry comes back on the `evidence` frame and renders as an `observation` part. Failure (oversized/corrupt) preserves the draft.

### 3. Stream text incrementally
- **Against:** `POST /api/equipment-notebooks/[id]/chat/` from the hub spike page (real incremental SSE on web).
- **Build:** transport = existing `postNotebookChat`/`parseFrame` feeding the runtime; markdown via `@assistant-ui/react-markdown` with ADR-0034 overrides (links neutered, images suppressed) + the citation-chip text renderer.
- **Pass:** visible token-by-token growth; no layout jumps/duplicate tokens; scrolling up during stream does NOT force-scroll (stick-to-bottom + jump-to-latest verified — the exact PRD 10.1 behavior mobile lacks today); late-arriving `sources` frame attaches chips to already-rendered `[n]` markers correctly.

### 4. Receive structured source and tool events
- **Against:** the `sources` + `evidence` frames on the same route; REPLAY fixture with `machineEvidence` rider to get a `machine_evidence` entry; `chat-safety-stop` fixture for the `safety` frame.
- **Pass:** parts arrive typed (never parsed from display text); an unknown frame kind injected into a fixture is ignored without crashing and is inspectable in a dev panel (PRD §9.2 unknown-part rule). **Tool events cannot be proven** — none exist server-side (inventory §8); the criterion is satisfied for source/evidence events, and the tool half is formally recorded as "requires net-new server events, Phase 3" — this is a documented incompatibility of MIRA's backend, not of assistant-ui.

### 5. Stop via a real abort/cancel path
- **Against:** the same route from the web spike page — `req.signal` → `clientAbort` wiring exists server-side (route :1033); persisted result verified via re-`GET` of the notebook.
- **Pass (web):** Stop mid-stream → UI enters `stopping` → server persists `answer_status='error'` + partial text → reload shows the same partial as a stopped turn. No late citations appear after cancel (Journey C step 5).
- **Device caveat:** on Capacitor this criterion CANNOT pass end-to-end (abort never reaches the server; #3453). The spike must instead prove the *honest* behavior: buffered-transport detection → no Stop affordance (or explicit "can't cancel on this connection" state) per recovery PRD §10.2. Pass = the runtime renders honest-buffered on native and real-Stop on web from one codebase.

### 6. Restore authoritative final/partial turn after reload
- **Against:** criterion-5's stopped turn + a completed turn; reload the spike page; hydrate via `GET /api/equipment-notebooks/[id]/`.
- **Pass:** the reloaded thread matches server truth exactly (stopped partial stays stopped; no duplicates; no resurrection differences between live-rendered and hydrated part JSON — assert byte-equal translation, the property mobile's dual `liveTurns`/`turns` path violates today). Also proves the ExternalStoreRuntime state handoff (adapter ADR runtime decision).

### 7. Render a machine-evidence card without forking the library core
- **Against:** an `evidence`-frame fixture with a full `MachineEvidenceEntry` (asset, anchorAt, pre/post, freshness, rowCount, reason) from a recorded REPLAY turn.
- **Pass:** the card renders via a registered custom part component using the frozen freshness/label strings verbatim (cross-checked against `mira-mobile/src/lib/replay.ts` constants); `git diff` shows zero patches under `node_modules`/no forked assistant-ui source; recorded-history styling is distinct from live (PRD 10.7).

## What CANNOT be proven on web alone (needs the Capacitor WebView)

1. **Buffered single-chunk rendering** — the CapacitorHttp fetch patch behavior only exists on device/emulator; web always streams. Proof: debug APK/emulator build loading the spike bundle; assert `onChunk` fires once and the UI renders the honest-buffered state (no fake token animation).
2. **Cookie-jar transport** — native requests carry the explicit `Cookie` header from `flm.cookiejar.v1`; assistant-ui components must never trigger a fetch outside `client.ts` doors. Only observable on device.
3. **Stop honesty on device** — criterion 5's device caveat.
4. **Hardware BACK ordering** — assistant-ui popovers/dialogs registered in `transient-layer.ts`; viewer → sheet → conversation drain order testable only with a real BACK button (emulator OK for iteration; physical Pixel = Mike, release authority only).
5. **Keyboard/composer reachability** — no `@capacitor/keyboard` plugin exists; reachability is pure CSS (PRD 11.1) — must be eyeballed with the soft keyboard open on device.
6. **OTA eligibility** — `scripts/ota-guard.mjs` run against the spike diff proves the bundle is native-fingerprint-clean (pure-JS claim of the dependency assessment).

No mobile emulator test lane exists today (inventory §6) — the device checks above are manual for the spike, and building the emulator lane is a Phase 1 exit prerequisite, not a spike deliverable.

## Order of work (estimate)

1. Record fixtures from route-test harness (0.5 d)
2. Criterion 1 hydration + `frames-to-parts.ts` (1 d)
3. Criterion 3 streaming + markdown/citation renderer (1.5 d — the inline-citation gap is the known hard part)
4. Criterion 4 source/evidence parts + unknown-frame test (0.5 d)
5. Criteria 5+6 stop/reload on web (1 d)
6. Criterion 7 machine-evidence card (0.5 d)
7. Criterion 2 attachment plumbing (1 d)
8. Device pass in debug WebView build: buffered/BACK/keyboard/ota-guard (1 d, emulator)
9. Write-up: pass/fail per criterion, incompatibility log, LocalRuntime-vs-ExternalStore verdict (0.5 d)

**Total ≈ 7.5 focused days.** Abort rule per PRD §8.3: any hard failure is documented precisely before evaluating an alternative foundation; no second custom chat runtime gets built inside the spike.
