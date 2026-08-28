# FactoryLM Sensor v0 — product contract (S0)

**Status:** Execution contract for Sensor v0 (LOOK · READ · REPLAY). Amends nothing; it *sequences*
existing doctrine onto one new capability. **Owner:** Mike Crane · **Written:** 2026-08-28 ·
**Verified against:** `origin/main` @ `e087b9525` (Q1 shipped: #3450/#3452/#3451/#3456; mobile 1.0.7/vc8).
**Constitution:** `docs/specs/mira-technician-app-dogfood-system.md` §1.1–§1.4 (wins on conflict).
**Parents:** `docs/prd/2026-08-25-technician-copilot-prd.md` (ChatGPT × NotebookLM), `docs/prd/2026-08-27-chatgpt-parity-prd.md` (Q1).
**Discovery (read first):** `docs/discovery/2026-08-28-sensor-v0-discovery.md` — the reuse matrix this contract executes.

## 1. The product model

Notebook = knowledge · Conversation = reasoning · **Sensor = observation** · Machine Memory = experience ·
Work Orders = action + outcome. Sensor turns the phone into an instrument for understanding a machine.
Tricorder *capability*, industrial *styling*: calm, trustworthy, no fake precision.

## 2. Contract (the laws Sensor adds — each is a restatement, not an amendment)

1. **Sensor belongs to the existing technician app.** No new app, chatbot, notebook, evidence database,
   Machine Memory implementation, or navigation universe. It is entered from the Notebook/machine
   experience through the existing `Sheet` + transient-layer/BACK stack.
2. **The five-tab contract stands.** `Workorders | Schedule | Notebook | Assets | More` — pinned by
   `mira-mobile/src/lib/__tests__/pure.test.ts`. **No sixth tab. No fourth notebook panel.**
3. **One conversation.** Every Sensor observation lands in the notebook's existing turns
   (`equipment_notebook_turns`) via the existing chat route. No Sensor chat store.
4. **One evidence model.** Photos are parked once (`parkOrReuseFile`, SHA-256 dedup) and linked by
   `origin_file_id`; machine evidence is a discriminated entry in the turn's existing `evidence[]` JSONB.
   No Sensor file store, no new evidence type, no new table in v0.
5. **Machine Memory owns replay.** REPLAY reads `tag_events` / `tag_event_diffs` / `machine_state_window` /
   `run_diff` through the Hub only. No new event backend; no SQL seeding; ingest stays one-pipeline.
6. **Progressive context.** L0 general → L1 identified component → L2 assembled machine → L3 connected.
   Identity upgrades the analysis; it is never a prerequisite. The string "Select an asset before
   continuing" (or any equivalent) must not exist where general use is possible.
7. **Read-only toward equipment.** Zero new write paths; fieldbus and one-pipeline guards stay green.
8. **Honesty.** Missing evidence stays missing (no fabricated timeline rows). Stale/replayed/simulated
   machine data is never presented as live; every machine row carries its own timestamps + quality;
   phone-origin evidence names its provenance. Phone measurements (future LISTEN/VIBRATION) are
   *screening* instruments unless proven calibrated.
9. **Future producers, same seams.** External instruments (BT vibration, thermal, borescope, clamp meter,
   scope, industrial mic) and robots (PAROL6) later become Sensor producers/endpoints through the same
   evidence entry + conversation seams. MIRA stays the only brain. Not built in v0.

## 3. Decisions (from discovery §6 — recorded here so lanes don't re-derive)

| # | Decision |
|---|---|
| D1 | Wire name for the replay mode is **`history`** (`basis='machine_history'` already exists; avoids the `NO-GO: REPLAY` gate vocabulary). "Replay" is UI copy only. |
| D2 | Replay rows carry **both** `event_timestamp` and `ingested_at`; ordered by `event_timestamp`; a divergence between the two is rendered, never hidden (it is the replay signature). |
| D3 | The notebook chat route adopts the approved-context gate **for machine evidence only** (mirror `approvedLiveSignalCount`); document retrieval behavior is byte-identical. |
| D4 | Turn → work-order provenance: REPLAY-derived WOs use `source_run_diff_id` (exists); LOOK/READ-derived WOs carry a structured line in `description`. `work_orders.notebook_turn_id` is deferred (migration). |
| D5 | Machine evidence rides **inside `evidence[]`** as `{kind:"machine_evidence", …}` and the existing `evidence` SSE frame; **no new frame kind, no migration**. Readers that assume `{docId}` must skip non-document entries. |

## 4. API contracts the lanes build against

### 4.1 LOOK — `POST /api/equipment-notebooks/[id]/look/`  (hub, new; mirrors `nameplate/recognize`)
- multipart `image` (+ optional `question`, `clientKey`). Bytes decide MIME (`effectiveImageMime`); 8 MB cap; SVG never viewable.
- Park before vision: `parkOrReuseFile` → `attachFileToTargets({equipment_notebook: id}, role:"photo")` (idempotent on `clientKey`).
- Vision: `togetherVisionCall` (`nameplate/passes.ts`) with a fixed inspection prompt (describe visible components, LEDs/indicators, damage, labels/text — **observations only, no diagnosis**). Provider errors are scrubbed and still return the parked file.
- Response `{ fileId, attachment, observation: { text, capturedAt, provenance: "phone_photo" }, quality?: assessCapture }`.
- The observation becomes a citable source ONLY through existing doors (materialize like nameplate confirm → `origin_file_id=fileId`, marked verified by the same technician-confirmation rule as #3440, never silently). Until confirmed, the observation is conversation context: the client sends it as the turn's `question` prefix ("Visual observation (02:14:21): …") — no new store.
- Never weaken `MIRA_ENFORCE_APPROVED_RETRIEVAL` (#3437). If a LOOK text lane needs retrieval, it goes through confirmation → `markNameplateDocVerified`-equivalent, scoped to that doc.

### 4.2 READ — no new routes
- QR: `ScanView` → `extractAssetTag` → `resolveScan` → `openNotebookTransition` (unchanged), `via` widened to `AssetSelectionMethod` (`qr` | `manual_entry`).
- Nameplate: `ComponentNameplateFlow` invoked as-is inside the current notebook.
- L1→L2 bind: `PUT /api/equipment-notebooks/[id]/asset` (exists, no client) → identity chip from `notebook-asset-card.ts`.
- Optional glue: OCR text lines → `extractAssetTag` → `resolveScan`.

### 4.3 REPLAY — `GET /api/assets/[id]/history?at=<iso>&pre=<s>&post=<s>`  (hub, new, `sessionOrDemo`, tenant-scoped)
- Resolves `uns_path` via the existing kg bridge SELECT (extracted into one shared helper — no fourth copy).
- Anchor: `at` if given, else the latest `machine_state_window` with `state IN ('faulted','estopped')`; **404 `no_fault_window`** (with the latest window state + time) when none — never a synthesized anchor.
- Returns `{ anchor: {at, source: "state_window"|"explicit", windowId?, runId?}, rows: [{event_timestamp, ingested_at, uns_path, tag, value, prev_value?, quality, kind: "event"|"diff"}], freshness: FreshnessSummary, summary: MachineMemoryResponse-shaped header, provenance: "machine_memory" }`, rows ordered by `event_timestamp`, window `[at-pre, at+post]` (defaults 5 s / 2 s, caps 120 s).
- Degrades honestly: missing tables → `{rows:[], reason:"unavailable"}` (200), never a fake timeline. Distinguish "no rows" from "table missing".

### 4.4 Chat grounding — `POST /api/equipment-notebooks/[id]/chat/` (existing; extend)
- Body gains optional `machineEvidence?: { assetId, anchorAt, pre, post }` (the selected window). Server re-fetches the window itself (never trusts client rows), builds `buildMachineContextPacket` + `renderMachineEvidenceSection(packet, sanitizeMachineMemoryField)` and appends it to the system prompt after the base and before `appendManualContext` — exactly the block `assets/[id]/chat/route.ts` already runs. Four-bucket instruction (observed / documentation / historical / inference / next checks) is the existing one.
- `basis`: `live_machine_evidence` when `FreshnessSummary.overall` is fresh, else `machine_history`; both already legal (mig 084). `general_reasoning`/`oem_documentation` unchanged when no machine evidence.
- `evidence[]` gets one `{kind:"machine_evidence", assetId, anchorAt, pre, post, rowCount, freshness, runId?, windowId?}` entry (D5). Citations/`sourceSnapshot` never contain machine evidence. Refusal semantics (Gate G, no provider call at zero chunks) unchanged for document retrieval.

### 4.5 Evidence cards in the conversation (both clients)
- Persisted turns render, from `evidence[]`: `Visual observation · Photo captured · HH:MM:SS` (photo via `SourceThumb`/`FilePreview`, never markdown `<img>`), `Nameplate read · <mfr> · <model>`, `Machine Replay · N observed changes around <fault time> · <freshness label>`. Basis badge renders for every basis value (`general_reasoning` amber, others muted).

## 5. Phases & gates

| Phase | Contents | Exit gate |
|---|---|---|
| S0 | this document + discovery | merged (docs-only) |
| S1 Shell | Sensor row in the Add-sources sheet → `Sheet` mode picker (LOOK / READ / REPLAY only; nothing disabled/futuristic) | opens from the notebook; BACK: viewer → Sensor sheet → notebook → tab; 5-tab test green; works with and without an identified machine |
| S2 LOOK | 4.1 route + mobile LOOK card + Ask MIRA | picker → parked once (SHA-256) → same notebook → MIRA; reload keeps the association; no duplicate file; retrieval gate untouched |
| S3 READ | 4.2 glue + identity chip + L2 bind | QR upgrades context; nameplate upgrades context; general READ with no machine; scan→notebook regression green |
| S4 REPLAY | 4.3 route + 4.4 grounding + mobile timeline + web badge | real fixture window → chronological rows with both clocks + quality → Ask MIRA receives that window; stale/simulated never "live"; no-fault → honest empty; basis persisted |
| S5 Acceptance | emulator E2E + regression suites + read-only guards + screenshots | north star: LOOK + READ + REPLAY → one Notebook → one MIRA conversation → one evidence history |

Lanes: **hub-look** (4.1), **hub-history** (4.3 + 4.4 + web badge), **mobile** (S1 → S2 client → S3 → S4 timeline), then **acceptance + critic**. Each lane: fresh worktree off `origin/main`, small PR, deterministic tests, HELD until S5 unless authorized.

## 6. Out of scope for v0
LISTEN, VIBRATION, active inspection ("TAKE MEASUREMENT"), external instruments, robots, barcode/Data Matrix/NFC, native Capacitor plugins (a plugin changes the native fingerprint → APK not OTA), a Sensor Session table, fixing #3453, fixing #3437 globally.
