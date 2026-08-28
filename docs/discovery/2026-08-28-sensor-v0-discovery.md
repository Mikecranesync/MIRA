# Sensor v0 discovery — 2026-08-28 (origin/main e087b9525)

Synthesized from 7 read-only area audits of `C:/wt-sensor` (`feat/sensor-v0` = `origin/main` @ `e087b9525`). Every claim below carries the `file:line` from the source audit; where audits disagreed, the claim with the more specific file:line evidence wins and the loser is noted. Items marked **[UNVERIFIED]** were asserted by one audit without corroboration or were not covered by any audit.

---

## 1. Executive read

1. Sensor v0 is **wiring, not building**. Every structural seam exists; they are split across two surfaces (mobile owns the notebook conversation and has zero Machine Memory; Hub owns Machine Memory, the evidence model, and anomaly→WO prefill, but grounds them on a *different* chat route).
2. **The single biggest gap** is that the route mobile actually calls (`mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts`) never imports `machine-context-packet`; only `assets/[id]/chat/route.ts:29,432,537` does. Porting that ~6-line block is the core Sensor change.
3. **READ is already built end-to-end** on mobile: `ScanView` → `extractAssetTag` → `getAssetByTag` → `openAssetNotebook(id,"qr")` → same notebook conversation. Nameplate → component identity → citable manual is also complete (`ComponentNameplateFlow.tsx:36`, `nameplate-flow.ts:163-294`).
4. **LOOK's server pipeline exists** under a nameplate-specific name: `nameplate/recognize` parks the photo before recognition (`recognize/route.ts:88-107`) and `nameplate/confirm` materializes a citable, chunk-verified doc with `origin_file_id` (`084:34-36`). A general "describe this photo" vision call exists (`passes.ts:580 togetherVisionCall`) with zero production callers.
5. **REPLAY's data substrate exists** (`tag_events` 033, `tag_event_diffs` 037, `machine_state_window` 040, `run_diff` anchors) but has **no mobile client, no timeline UI, no fault-anchored window query, and no Hub route** over `tag_event_diffs`. The relay's `fault_window_id` is dormant (never minted without `TAG_DIFF_CONFIG_JSON`).
6. **A Sensor Session composes WITHOUT a new table** (see matrix row) — turns carry untyped `evidence` JSONB (`073:96`), the `basis` CHECK already admits `live_machine_evidence`/`machine_history` with no writer (`084:26-32`), and turns snapshot the asset (`081:101-105`). The one hole is turn→work-order provenance (no column).
7. **Freshness honesty is solved once**: `classifyTagFreshness`/`rollupFreshness` (`command-center-freshness.ts:58,106`), `deriveCurrentState` (`machine-current-state.ts:33`), and `FreshnessSummary.overall` (`machine-context-packet.ts:31-38`). Sensor must reuse, not re-derive. The "Live unavailable" product state exists only in docs.
8. **The mobile shell is frozen**: 5 tabs pinned by `pure.test.ts:62-64`; BACK is a LIFO transient-layer stack (`transient-layer.ts:22-34`, `App.tsx:82-94`); the one approved chrome is `Sheet` (`Sheet.tsx:20-52`). Sensor enters from inside the `chat` tab's Add-sources sheet.
9. **Read-only guards are already mechanical**: fieldbus AST guard (`mira-bots/tests/test_drive_packs_readonly.py`), one-pipeline Contract 5 (`tests/test_architecture.py:130-196`), packet SELECT-only test (`machine-context-packet.test.ts:152`). Sensor adds no write path and must not seed `tag_events` by SQL.
10. Adding **any native Capacitor plugin** (camera/motion/mic) changes `__FLM_NATIVE_FINGERPRINT__` (`vite.config.ts:23-25`, `live-update.ts:40-48`) and turns the ship into an APK, not an OTA. v0 should stay plugin-free.

---

## 2. The reuse matrix

| Capability | Existing implementation (file:line) | Status | Reuse action | Files |
|---|---|---|---|---|
| **Sensor shell: tab** | `mira-mobile/src/nav.ts:19-24` `TABS`; pinned `pure.test.ts:62-64` | REUSE — DO NOT TOUCH | No 6th tab. Enter inside `chat` tab (label "Notebook", `nav.ts:21`) | `nav.ts`, `App.tsx:169-180` |
| **Sensor entry point** | Add-sources sheet `NotebookScreen.tsx:1039-1291`, option rows `:1151-1170` | EXTEND | One `sheet-option` row "Sensor" beside the four existing; mode picker in a `Sheet` | `NotebookScreen.tsx` |
| **Sensor host chrome** | `Sheet.tsx:20-52` (auto BACK `:31`, Escape `:36-41`); `BackDismiss` `:60-63` | REUSE | Mode picker + evidence card + Ask-MIRA CTA live in `Sheet`. Camera viewfinder is NOT a Sheet (`.sheet` max-height 80%, `app.css:357-361`) — use local state + `BackDismiss` (delete-dialog pattern `NotebookScreen.tsx:306`) | `Sheet.tsx`, `app.css` |
| **BACK unwind** | `App.tsx:87` `closeTopTransientLayer()` → `:88` tab handler → `:89` minimize; `NotebooksTab.tsx:57-64`; `NotebookScreen.tsx:163-165` returns `false` always | REUSE | Chain = viewer → sheet → notebook → list → minimize. Any Sensor overlay MUST `useTransientLayer` or it is unclosable | `transient-layer.ts:22-49` |
| **Do NOT add a panel** | `NotebookScreen.tsx:44` `type Panel` (Sources·Chat·Studio) | DO NOT BUILD | Sensor is a transient instrument, not a 4th panel | — |
| **LOOK: photo intake** | `native-pick.ts:128` `pickNameplatePhoto()` (gallery picker, `FilePicker.pickImages`); web `<input capture="environment">` `NotebookScreen.tsx:1274-1288` | EXTEND | v0 uses the picker. Camera-first capture does not exist (`captureNameplatePhoto` undefined anywhere; #3353) | `native-pick.ts` |
| **LOOK: park photo → evidence card** | `nameplate/recognize/route.ts:51`, park-before-recognize `:88-107`, MIME sniff `:73-86`, `evidence[]`+`review` `:174-208`; pinned `recognize.test.ts:154,209` | REUSE | This is LOOK's server door. Do NOT use `recognize-nameplate/route.ts` (notebook-free) — it never parks the photo | `nameplate/recognize` |
| **LOOK: describe-this-photo** | `mira-hub/src/lib/nameplate/passes.ts:580` `togetherVisionCall` (`VisionCall` `:568`); only caller is `__tests__/nameplate-passes.test.ts` | MISSING (helper exists, no route) | One thin Hub route over `togetherVisionCall` + `resolveRecognitionImage` + `effectiveImageMime` + `parkOrReuseFile` + `attachFileToTargets`. No new provider client | `passes.ts`, `detect.ts:77`, `image-mime.ts:50`, `workspace-files.ts:203,501` |
| **LOOK: OCR text as citable evidence** | `photo-ocr.ts:84`; wired only `files/route.ts:242-255`; gated `nodeId && capability==="viewable"` | EXTEND | Post to `/api/files` with an `equipment_notebook` target (`uploadFileToTargets` `resources.ts:637`). Mobile's only `/api/files` call is `AssetsTab.tsx:277` with `cmms_asset` → OCR never runs today | `photo-ocr.ts`, `files/route.ts` |
| **LOOK: capture quality (blur/glare)** | `capture-quality.ts:317` `assessCapture()`; pure; zero callers | REUSE | Client-side retake hint. Thresholds uncalibrated (`:28-38`) — never hard-block | `capture-quality.ts` |
| **LOOK: photo cited → shows photo** | `origin_file_id` `084:34-36`; `originFileIdsByDoc` `equipment-notebooks.ts:720`; mobile `NotebookScreen.tsx:260-264,725-738`; `sse.ts:19-23` | REUSE — DO NOT BUILD | Ingest LOOK doc with `origin_file_id=<photo fileId>`; the chip opens the photograph automatically | — |
| **READ: QR scan** | `ScanView.tsx:14-141`; states `:12`; manual fallback `:124-139` | EXTEND | Reuse verbatim; parameterize hardcoded `"← Assets"` (`:83`) | `ScanView.tsx` |
| **READ: tag grammar + trust** | `tags.ts:49 extractAssetTag`, `:38 isTrustedDeepLink`; hub `scan-target.ts:10`, `asset-tag.ts:30`; contract `docs/contracts/asset-tag-grammar.json` | REUSE | Feed every decoded payload through `extractAssetTag` | `tags.ts`, `scan-target.ts` |
| **READ: scan → notebook** | `scan-landing.ts:44 resolveScan`, `:79 openNotebookTransition`; `assets/[id]/notebook/route.ts:44` (idempotent, 409 race `:90-98`) | REUSE | Lands in the SAME notebook. Widen `via` from literal `"qr"` (`scan-landing.ts:26,54`) to `AssetSelectionMethod` so manual entry records `manual_entry` (update `scan-landing.test.ts:29,36`) | `scan-landing.ts` |
| **READ: nameplate → component + manual** | `ComponentNameplateFlow.tsx:36`; reducer `nameplate-flow.ts:163-294`; `confirm/route.ts:174-408`; `confirmYieldedCitableSource` `resources.ts:887-891` | DUPLICATE — DO NOT BUILD | Invoke as-is. Needs `notebookId` (hard prop) | — |
| **READ: bind/confirm asset (L1→L2)** | `PUT /api/equipment-notebooks/[id]/asset` `[id]/asset/route.ts:48-105`; `ASSET_SELECTION_METHODS` `equipment-notebooks.ts:76-84`; `bindNotebookAsset` `:458` nulls `confirmedBy` for qr/nfc `:506` | REUSE (no client today) | Zero UI callers. One call gives L2; server derives `confirmedAt` | `[id]/asset/route.ts` |
| **READ: identity chip** | `notebook-asset-card.ts:42 assetCardState` (4 tones, `VIA_LABEL` `:33-40`); rendered by nothing | REUSE | Render it. Requires un-dropping `asset` in `resources.ts:269-281 toNotebook()` | `notebook-asset-card.ts`, `resources.ts` |
| **READ: fault-code extraction** | `knowledge-graph/extractor.ts:36-37,58` (TS, pure); `uns_resolver.py:370` (Python, bots only) | DUPLICATE — DO NOT BUILD a third | Use `extractEntitiesFromText` on OCR/technician text. The notebook chat route reaches neither today | `extractor.ts` |
| **READ: OCR label → tag** | none (no `ocrPhotoText`→`extractAssetTag` co-occurrence) | MISSING | Glue only: per-line `extractAssetTag` over OCR text → `resolveScan` | new glue |
| **Barcode / DataMatrix / NFC / mic / motion** | absent (`qr-scanner ^1.4.2` only; no Capacitor sensor plugins `MM/package.json:13-29`; manifest `INTERNET:61`,`CAMERA:65`) | MISSING — out of v0 | Report as absent | — |
| **REPLAY: raw substrate** | `tag_events` `033:56-93`, GIST `uns_path` `:152`; `tag_event_diffs` `037:47-88`; `machine_state_window` `040:62-79`; `run_diff.from/to_event_id` `040:40-49` | REUSE | Filter on `uns_path <@ ltree`; `equipment_entity_id` is nullable and unindexed | migrations |
| **REPLAY: fault-anchored window query** | closest: `run_engine/store.py:546 readings_for_window` (Python, no HTTP, no `ingested_at`); `signal-history/route.ts:22-113` (5-min fixed `:18`, numeric only, no quality); `i3x/data-access.ts:144` (hardcodes `freshness:"live"` `:179`) | MISSING | The ONE genuinely new data thing: a Hub route `GET /api/assets/[id]/replay?at=&pre=&post=` porting `readings_for_window` SQL + `tag_event_diffs`, tenant-scoped, returning both timestamps and quality | new route |
| **REPLAY: fault window object** | relay `fault_window_id` (`037:76-77`, `tag_diff_logger.py:293-323`, `get_evidence` `historian_postgres.py:266`, `relay_server.py:492,730`) — **dormant**: no-op unless `fault_trigger_tags` set (`tag_diff_logger.py:295-296`), only `TAG_DIFF_CONFIG_JSON` sets it (`tag_diff_historizer.py:84-89`), nothing in repo does | EXTEND (dormant) — do not depend on | Use `machine_state_window.state='faulted'` + its anchored `run_diff` rows as the de-facto window (`state_windows.py:69-145`). Resolves ui-live's "solved query" claim: solved in code, NULL in prod | — |
| **REPLAY: "what MIRA thinks now"** | `buildMachineMemoryResponse` `machine-memory-response.ts:92-188`; `deriveContextIntelligence` `machine-context-intelligence.ts:147`; `next_check` from `run_diff.metadata` `machine-memory.ts:125` | REUSE | Header of the REPLAY card. `active_conditions` = newest ≤5 `run_diff`, not "currently active" | — |
| **REPLAY: timeline UI** | none (only sparkline `MachineMemoryCard.tsx:343-368`) | MISSING | Build the list component on mobile; port `StatusPill :285`, `LiveTagRow :313`, `ago :391`, `dedupeDiffs :374` vocabulary | new mobile component |
| **REPLAY: mobile client** | none (`grep machine-memory\|signal-history` in `mira-mobile/src` = 0) | MISSING | One `resources.ts` function per Hub route | `resources.ts` |
| **Evidence card in the Q1 conversation** | `FilePreview.tsx:267`, `SourceThumb :293`, `useFileBytes :33`; `MediaViewer.tsx:31` (blob URL only); citation sheet `NotebookScreen.tsx:708-837`; chips `:550-562,606-618`; `answer-markdown.test.tsx:71,89,96` forbids `<img>`/`<a>` in answers | REUSE | Evidence image goes through `FilePreview`/`SourceThumb`, never markdown. Machine-evidence card = a discriminated entry in the turn's `evidence[]` (see composition row) | — |
| **Ask-MIRA grounding with evidence window** | `renderMachineEvidenceSection` `machine-context-packet.ts:75-122` (four-bucket instruction `:119`), `buildMachineContextPacket :146-177`; consumed ONLY at `assets/[id]/chat/route.ts:432,537` with `sanitizeMachineMemoryField :194-204`; notebook seam `chat/route.ts:654-656` | EXTEND (port) | Copy the block into the notebook route: base → machine section → `appendManualContext`. Anchored-window variant of `fetchMachineMemory` (`machine-memory.ts:51-128`) keeps the `EvidenceWindow` shape (`machine-memory-response.ts:48-52`) | both chat routes |
| **Basis honesty on turns** | `EvidenceBasis` `notebook-chat-types.ts:117-123`; CHECK `084:24-32`; route hard-codes binary at `chat/route.ts:983-993`; web badge only for `general_reasoning` `NotebookChat.tsx:124-135` | EXTEND | Emit `live_machine_evidence` (fresh) / `machine_history` (replay). No migration. NULL on non-served turns (`general-mode.test.ts:214`) | `chat/route.ts` |
| **Sensor Session composition (no new table?)** | turns: `073:87-99` + `081:101-105` + `084:24-26`; `recordTurn(… evidence: unknown[])` `equipment-notebooks.ts:1116-1124`; files/links `resources.ts:508-529,617-657`; WO `work_orders.source_run_diff_id` (060) + `client_key` (074) | **YES — composes without a new table** | Session = notebook id + turns (question/answer/basis/asset snapshot/`evidence[]` JSONB carrying `{kind:"machine_evidence", run_id, window_id, from_event_id, to_event_id, observed_at, ingested_at}`) + file links (`role:"photo"`) + WO via `source_run_diff_id`. Constraints: `listTurns` assumes `{docId}` `:1288-1291` and `enrichCitationsWithOrigin :747` must tolerate the discriminator; mobile types evidence as `EvidenceCitation[]` (`notebook-chat-utils.ts:158`). **Hole:** no `work_orders.notebook_id/turn_id` — a conversation-derived WO carries provenance only via `description` or `source_run_diff_id` | — |
| **Freshness / stale / live honesty** | `command-center-freshness.ts:20,36,58,106,124`; `machine-current-state.ts:33-59`; `FRESHNESS_COLOR/LABEL/TITLE` `command-center/page.tsx:499-518`; gate `tools/cv101_live_gate.py:88` (CLI/CI only) | REUSE | One freshness model. "Live unavailable" is docs-only (`dogfood-system.md:132,393`, PRD `:172`) — must be built from `Verdict.cause` vocabulary `cv101_live_gate.py:66-72` | — |
| **Read-only guards** | `test_drive_packs_readonly.py:78-115,190`; `test_architecture.py:130-199` (Contract 5); `machine-context-packet.test.ts:152` SELECT-only; `033:171-177` REVOKE UPDATE/DELETE | REUSE | Sensor adds zero write paths; no SQL seeding of `tag_events` | — |
| **WO handoff** | `Workorders.tsx:347-457 Create` (one UUID `client_key` `:362`); `offline-queue.ts:68,105`; `work-orders/route.ts:188-193,262,312-313`; Hub prefill `prefill.ts:20`, `MachineMemoryCard.tsx:416` | REUSE / EXTEND | Prefill the existing `Create`; add `source_run_diff_id` to `CreateWorkOrderInput` (`resources.ts:112-121`) — server already accepts it (`route.ts:181`) | — |
| **E2E tooling** | `tools/mobile-e2e/journey.py`, `run.sh` (uiautomator text, no pixels); reports SKIP for camera/cellular/release-signing (`journey.py:19-23`) | REUSE | Add Sensor steps; camera legs remain SKIP | `tools/mobile-e2e/` |

---

## 3. Things we thought were missing but already exist

- **Four-bucket "observed / documentation / inference / next checks" prompt instruction** — `machine-context-packet.ts:119`, already sanitized by the caller; Python mirror `live_snapshot.py:637`. Sensor writes no prompt.
- **All six `basis` values are DB-legal with no writer** for `live_machine_evidence` / `machine_history` (`084:26-32`; grep confirms no writer).
- **Evidence window type + run/window ids** — `EvidenceWindow` `machine-memory-response.ts:48-52`, `LatestRun.run_id :20`, `LatestWindow.window_id :29`; event anchors `run_diff.from/to_event_id` (`040:19-23`, written `machine_memory.py:99-110`).
- **Untyped `evidence` JSONB on turns** — zero-migration structured evidence (`073:96`, `recordTurn :1124`).
- **Complete in-notebook READ flow** with 9-state reducer and honest terminal reasons (`nameplate-flow.ts:322-350`).
- **General vision call** (`passes.ts:580`) and **multi-pass reading** (`passes.ts:748`), both unwired in prod.
- **Capture-quality assessor** (`capture-quality.ts:317`), **evidence classification** (`evidence.ts:267,513`) returned by recognize and discarded by mobile (`resources.ts:813` maps only candidate/rawObservation/confidence).
- **Identity chip state machine** (`notebook-asset-card.ts:42`) and **L2 confirm route** (`[id]/asset/route.ts:47`), both with no consumer.
- **Anomaly → WO prefill** with `source_run_diff_id` persistence (060; `prefill.ts:20`).
- **Idempotency everywhere**: `attachFileToTargets` key (`resources.ts:617`), `clientKey` on confirm (`confirm/route.ts:219`), `client_key` on WO (`route.ts:262`), notebook open race-safe (`assets/[id]/notebook/route.ts:90-98`).
- **SSE machine-memory push** (`stream/route.ts:9-17`) and mobile SSE client (`mira-mobile/src/lib/sse.ts`).
- **CV-101 fault fixtures + DB-free CLI** (`mira-crawler/tests/fixtures/machine_memory/*.json`, `python -m run_engine.machine_memory --fixture`).
- **Pasted-text → citable source** (`NotebookScreen.tsx:1201-1229`) — the only existing zero-Hub-change way to inject a replay narrative into `sourceDocIds`.
- **Resume guard for picker round-trip white screens** (`resume-guard.ts:46-65`).

---

## 4. Hard constraints and contracts Sensor must not break

| Contract | Pinned by |
|---|---|
| Exactly 5 tabs, in order | `mira-mobile/src/lib/__tests__/pure.test.ts:62-64` |
| BACK LIFO + idempotent unregister | `transient-layer.test.ts:34-46` |
| Answers never render `<a>`/raw HTML/`<img>` | `answer-markdown.test.tsx:71,89,96` |
| `askNotebook` signature; Enter-sends; Retry byte-identical; STRM-1/2 | `notebook-composer.test.tsx:63-206` (adding exports is safe; changing signature is not) |
| Chat history 12-line tail, stopped turns excluded | `chat-history.test.ts:35,48` |
| SSE frame order `content* → sources → evidence → [usage] → status → [followups] → [DONE]` | `chat-stop-persist.test.ts:139,157` |
| New frame kinds MUST be added to `FRAME_KINDS` or silently dropped | `notebook-chat-types.ts:156-171` |
| `answer_status` is a 3-value CHECK; stopped = `error` + text | `073:92-93`, `notebook-chat-types.ts:14-31` |
| `basis` 6-value CHECK; NULL on refusal; `general_reasoning` = zero citations | `084:26-32`; `general-mode.test.ts:191,201,214`; `chat/route.ts:963,897` |
| Citations filtered to `[n]` used; machine evidence never in `citations`/`sourceSnapshot` | `chat/route.ts:342-347,964-965,975` |
| `MACHINE CONTEXT` wording; asset snapshot on answered/abstain/safety | `chat-asset-context.test.ts:106-192` |
| History between system and last evidence-bearing turn | `answer-hygiene.test.ts:81,91,99` |
| Zero chunks + sources selected → abstain without provider call | `chat-boundary.test.ts:97,117` |
| Never Gemini under canonical seam | `chat-canonical-seam.test.ts:195` |
| Safety stop before retrieval/provider | `safety-classifier.ts:82`; `chat/route.ts:427,513-524` |
| Unresolvable asset → 422 `uns_required` with a sentence in `error` | `chat/route.ts:482-502`; mobile renders verbatim (`client.ts:198-208`) |
| Chat scope requires positive trust (`user_confirmed`/`verified`) | `equipment-notebooks.ts:1093-1104`; `files-nameplate.test.ts:239,288,374` |
| Client never mints `matchState:"verified"` or `asset_confirmed_*` | `[id]/sources/route.ts:27-33`; `[id]/asset/route.ts:13-16`; `files/route.ts:141-157` |
| Park before recognize; component nameplate never renames notebook | `recognize.test.ts:154,209,265`; `confirm.test.ts:320` |
| Bytes decide MIME; SVG never viewable; 8 MB image cap | `recognize.test.ts:138,385,408`; `recognize/route.ts:32-35` |
| Exact nameplate status/error copy strings | `files-nameplate.test.ts:411` |
| `node_id` scopes documents, `equipment_entity_id` names the machine | `equipment-notebooks.ts:367-371`; `assets/[id]/notebook/route.ts:17-21` |
| Tag grammar cross-surface; both suites execute the contract | `tag-grammar-shadow.test.ts:15`, `tag-grammar-contract.test.ts:14,28`; `docs/contracts/asset-tag-grammar.json` |
| One-pipeline ingest (no SQL into `tag_events`/`live_signal_cache`) | `tests/test_architecture.py:130-199` |
| Machine packet is SELECT-only; sanitizer applied to every field | `machine-context-packet.test.ts:152,183` |
| `MachineMemoryResponse` byte-identical GET vs stream | `machine-memory-response.ts:5-9`; `stream/__tests__/route.test.ts:10` |
| Machine-memory route: empty = 200; generic error = 500; `$1::uuid`/`$2::ltree` shape | `machine-memory/__tests__/route.test.ts:59,231,263` |
| `live_ratio` per-scan not per-row | `tests/test_cv101_live_gate.py:284,301,318,325` |
| `next_check` text parity with `plc/conv_simple_anomaly/anomaly_log.py` | `mira-crawler/tests/test_anomaly_rules_parity.py` |
| Fieldbus read-only (no write FCs / write-ish defs) | `mira-bots/tests/test_drive_packs_readonly.py:78-115,190` |
| WO `client_key` UUID once per logical create; `"closed"` 500s in prod → `"completed"` | `work-orders/route.ts:188-193`; `Workorders.tsx:303-306,361-362` |
| Native fingerprint bare identifier | `native-fingerprint-wiring.test.ts:37-58` |
| Sign-out purge prefixes | `offline-queue.ts:146` — add any Sensor local prefix |
| Mobile CI is path-filtered | `.github/workflows/ci.yml:691-697` — Hub-only Sensor PRs skip the mobile suite |

Env flags that change behavior: `MIRA_CANONICAL_SEAM`, `MIRA_ENFORCE_APPROVED_RETRIEVAL` (compose default `false`, **prod `true`** per `docs/architecture/convergence/units/evidence/approved_context_retrieval/2026-08-27-prod-runtime-proof.md:12-18` — the discovery-sweep docs saying "ships OFF" are stale), `MIRA_ENFORCE_APPROVED_ASK` (asset chat only), `PHOTO_OCR_ENABLED` (both hub and mira-ask, default 0), `NAMEPLATE_DETECT_ENABLED` (0), `TOGETHERAI_API_KEY` (503 without), `MIRA_RUN_DIFF_ENABLED` (**default OFF — no windows/anomalies written**), `MIRA_MACHINE_MEMORY_UNS_PATHS`, `TAG_DIFF_CONFIG_JSON`, `NEON_DATABASE_URL`.

Retrieval-gate consequence: only nameplate confirm writes `knowledge_entries.verified=true` (`confirm/route.ts:333 markNameplateDocVerified`). Photo OCR chunks, node-door uploads, and confirm-imported OEM manuals land `verified=false` and retrieve zero chunks under the prod gate. Any LOOK text lane is invisible to chat unless a human review precedes `markNameplateDocVerified`.

---

## 5. Minimal new-code list for S1–S4, and what NOT to build

Slice labels assumed: S1 = shell/entry, S2 = LOOK, S3 = READ, S4 = REPLAY **[UNVERIFIED — S1–S4 were not defined in the audits]**.

**S1 — Sensor entry + shell (mobile only)**
- `mira-mobile/src/screens/NotebookScreen.tsx`: one `sheet-option` row near `:1165`; `const [sensorOpen,…]`; `<Sheet label="Sensor">` with three mode buttons. ~30 lines.
- `mira-mobile/src/screens/ScanView.tsx:83`: `cancelLabel` prop (default "← Assets").
- `mira-mobile/src/lib/offline-queue.ts:146`: add Sensor prefix to `PURGE_PREFIXES` only if any local cache is introduced.

**S2 — LOOK**
- Hub: `mira-hub/src/app/api/equipment-notebooks/[id]/look/route.ts` (new): multipart image → `effectiveImageMime` → `parkOrReuseFile` → `attachFileToTargets(role:"photo")` → `resolveRecognitionImage` → `togetherVisionCall(prompt)` → return `{fileId, description, attachment}`; on 502/503 still return `fileId`. Mirror `recognize/route.ts` shape; scrub provider errors (`recognize/route.ts:214`).
- Mobile: `resources.ts` `lookAtPhoto(notebookId, image)`; card = `SourceThumb` + description text + "Ask MIRA about this" → `sendQuestion` in the mounted `NotebookScreen`.
- Optional: call `assessCapture` client-side for a retake hint (no block).

**S3 — READ (glue only)**
- `scan-landing.ts:26,54`: widen `via` to `AssetSelectionMethod`; `ScanView` manual path passes `manual_entry`; update `scan-landing.test.ts:29,36`.
- `resources.ts:269-281 toNotebook()`: map `asset` binding; `resources.ts:919-946`: map `discoveryReason`/`oemRequestUrl`.
- `resources.ts`: `bindNotebookAsset(notebookId, assetRef, selectedVia)` over `PUT /api/equipment-notebooks/[id]/asset`; render `assetCardState` (port the pure function or duplicate its 40 lines — flag as the one permitted copy).
- Optional glue: OCR text lines → `extractAssetTag` → `resolveScan`.

**S4 — REPLAY**
- Hub: `mira-hub/src/app/api/assets/[id]/replay/route.ts` (new, GET, `sessionOrDemo`): resolve `uns_path` via the `kg_entities` bridge (extract the SELECT at `machine-memory-response.ts:102-112` into an exported helper rather than a 4th copy); anchor = `?at=` or latest `machine_state_window.state='faulted'`; return `tag_events` (with `event_timestamp` **and** `ingested_at`, `quality`) plus `tag_event_diffs` ordered by `event_timestamp` for `[at-pre, at+post]`; `withTenantContext`; `isUndefinedRelationOrColumn` degradation; distinguish "no rows" from "table missing".
- Hub: `equipment-notebooks/[id]/chat/route.ts` at `:654-656`: when `resolveBoundAsset` is resolved, `buildMachineContextPacket` + `renderMachineEvidenceSection(packet, sanitizeMachineMemoryField)` appended to the system prompt; accept optional `replayWindow` body field; set `basis` at `:983-993` to `live_machine_evidence` / `machine_history` by `FreshnessSummary.overall`; push a discriminated `{kind:"machine_evidence",…}` entry into `evidence[]` and make `enrichCitationsWithOrigin :747` / `listTurns :1288-1291` skip non-`docId` entries. Add any new frame kind to `FRAME_KINDS`.
- Mobile: `resources.ts` `getReplay(assetId, opts)`; a timeline list component (each row shows its own `event_timestamp`, quality, and the freshness label — never asserts "live"); header from `buildMachineMemoryResponse` summary; "Live unavailable" banner from the freshness roll-up; "Create WO" prefilling `Create` with `source_run_diff_id` (add to `CreateWorkOrderInput :112-121`).
- Web: `NotebookChat.tsx:124-135` badge per basis; `ChatBody` `notebook-chat-utils.ts:97-101` gains `mode`/`replayWindow`.

**Do NOT build**
- A 6th tab, a 4th notebook panel, a second bottom sheet, a second camera surface, a second attach sheet.
- A Sensor evidence type (use `NameplateFact` shape, `evidence.ts:63`) or a Sensor turns/session table.
- A second prompt builder / evidence renderer (TS + Python mirrors already exist).
- A second freshness model, a second fault-code extractor, a second UNS resolver, a second tag grammar.
- A fourth copy of the asset→`uns_path` bridge SELECT.
- Anything via `assets/[id]/chat/route.ts` (different conversation store) or `recognize-nameplate/route.ts` (loses the photo) or relay routes directly from the phone.
- SQL seeding of `tag_events`; any Modbus/EtherNet-IP write; any native Capacitor plugin in v0.
- A `basis` seventh value (needs migration) or a `"stopped"` `answer_status`.

---

## 6. Open questions needing a decision (max 5)

1. **Mode wire name "REPLAY" collides with the live-gate cause `NO-GO: REPLAY`** (`cv101_live_gate.py:67`) and with WO `replayed`/eval replay. *Recommendation:* ship the mode as `history` on the wire (`basis='machine_history'` already matches); keep "Replay" as UI copy only.
2. **Which clock is the REPLAY axis?** `signal-history` deliberately uses `ingested_at` (`route.ts:14-16`, #2429, report-by-exception freezes `event_timestamp`); fixtures and `readings_for_window` use `event_timestamp`. *Recommendation:* return both; order by `event_timestamp`; render `ingested_at` as a secondary column and flag divergence (that divergence IS the replay signature, `cv101_live_gate.py:160-161`).
3. **Should the notebook route adopt the approved-context refusal gate** (`approved-context.ts:20-60`, currently asset-chat only `:564-565`) once it carries machine evidence? *Recommendation:* yes for machine evidence only (mirror `approvedLiveSignalCount` `:571`); keep document retrieval behavior unchanged so the beta gate stays green.
4. **Turn → work-order provenance has no column.** *Recommendation:* v0 uses `source_run_diff_id` for REPLAY-derived WOs and a structured line in `description` for LOOK/READ-derived; defer `work_orders.notebook_turn_id` to a post-v0 migration.
5. **Machine-evidence entries inside `evidence[]` vs a new SSE frame.** *Recommendation:* JSONB entry with `kind` discriminator (zero migration, survives reload via `listTurns`), plus reuse of the existing `evidence` frame — no new frame kind, so `FRAME_KINDS` and `chat-stop-persist.test.ts:139` are untouched.

---

## 7. Fixture plan

**REPLAY fixture (real fault window, deterministic, no DB)**
- Primary: `mira-crawler/tests/fixtures/machine_memory/cv101_estop.json` (tenant `e88bd0e8-8a84-4e30-9803-c0dc6efb07fe`, `uns_path=enterprise.home_garage.conveyor_lab.conveyor_1`) via `python -m run_engine.machine_memory --fixture …` (`machine_memory.py:24-26,358-411`) → yields `machine_state_window` (`estopped`/`faulted`) + anomaly `run_diff` with `from_event_id`/`to_event_id`/`window_id`. Secondary: `cv101_comm_stale.json` for the stale-honesty negative test; `cv101_healthy_idle.json` as the "nothing to replay" control.
- Staging: only legal path is `POST /api/v1/tags/ingest` through `ingest_batch` (`tag_ingest.py:203`), with `MIRA_RUN_DIFF_ENABLED=1` + `MIRA_MACHINE_MEMORY_UNS_PATHS` set, else no windows are written. SimLab scenarios A–F (`simlab/scenarios.py:118,185,244`) give fault codes but are `simulated=true` → freshness `simulated`, gate NO-GO: PROVENANCE by design (`cv101_live_gate.py:117-130`) — good for the "simulated is never live" badge test, not for a live proof.
- Do not rely on relay `fault_window_id` (NULL in prod config) or `GET /api/runs/{id}` (501).
- Required negative test (dogfood spec `:416`): frozen `event_timestamp` + advancing `ingested_at` ⇒ banner "Live unavailable", basis `machine_history`, never `live_machine_evidence`.

**LOOK fixture (#3437 boundary)**
- **[UNVERIFIED]** No audit references #3437; the only cited camera boundary is #3353 (Android WebView degrades `<input capture>` to a chooser) and `journey.py:19-23` (real camera = SKIP, never PASS).
- Verified photo lane: gallery/picker → `pickNameplatePhoto()` (`native-pick.ts:128`) → `POST …/nameplate/recognize` with `NAMEPLATE_RECOGNIZER=fixture` (`nameplate/index.ts:302`) → park + link proven by `recognize.test.ts:154,209`. Use this lane for LOOK e2e; treat the MIME sniff fixtures (`recognize.test.ts:385,408`) as the file corpus.
- Unverified lanes: camera-first capture (does not exist), photo OCR from mobile (unreachable — `files/route.ts:242` needs a node target mobile never sends), `togetherVisionCall` route (not built). The emulator journey must continue to report SKIP for the physical camera leg; device proof remains Mike-only.
