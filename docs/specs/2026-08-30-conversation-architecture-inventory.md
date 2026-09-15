# Current-State Conversation Architecture Inventory

**PRD:** [docs/prd/2026-08-30-chatgpt-class-ui-prd.md](../prd/2026-08-30-chatgpt-class-ui-prd.md) (Deliverable 2, Phase 0)  

**Scope:** mira-mobile + mira-hub + backend routes + evidence pipeline, at `origin/main` (worktree `C:/wt-chatui`), 2026-08-30. Synthesized from six parallel inventory slices; load-bearing claims spot-verified in-repo.

## 1. Surfaces

| Surface | Client code | Route | Wire dialect | Persistence | Stop |
|---|---|---|---|---|---|
| **Notebook chat (mobile)** — flagship | `mira-mobile/src/screens/NotebookScreen.tsx` (1,524 ln) + `src/lib/sse.ts` + `src/api/client.ts::requestStream` | `POST /api/equipment-notebooks/[id]/chat/` | Typed SSE frames | Server: `equipment_notebook_turns` (mig 073/081/084) | Real on web; client-side-only on device (#3453) |
| **Notebook chat (web)** — flagship | `mira-hub/src/components/equipment/NotebookChat.tsx` (526 ln) + `notebook-chat-utils.ts` (352 ln) | same route | Typed SSE frames | Server, same table | Real (abort reaches route; partial persisted) |
| **NodeChat** — beta-gate door | `mira-hub/src/components/namespace/NodeChat.tsx` (415 ln) | `POST /api/namespace/node/[id]/chat/` | Untyped `{content}/{sources}` + `[DONE]` + `X-Safety-Stop` header | localStorage `mira_node_chat_<id>[_doc_<docId>]`, last 40 | None |
| **AssetChat** | `mira-hub/src/components/AssetChat.tsx` (410 ln) | `POST /api/assets/[id]/chat/` | Same untyped clone dialect + `{traceId}`, `{next_check}` | localStorage `mira_chat_<id>`; `decision_traces` row server-side | None |
| **Quickstart** | `mira-hub/src/app/quickstart/page.tsx` | `POST /api/quickstart/ask` (unauthenticated, IP-rate-limited) | Plain JSON | None | n/a |
| **AssetValidateTab** (hidden consumer) | `mira-hub/src/components/AssetValidateTab.tsx` | asset chat route | 4th hand-rolled SSE parser | Q&A validation rows | None |

Not candidates: `GET /api/conversations` (Telegram work-order rollup, not chat); `mira-pipeline` :9099 (separate auth, fake streaming, no turn persistence — out of scope per Slice D).

## 2. The one typed wire contract

`mira-hub/src/lib/notebook-chat-types.ts` (267 ln) — verified. `data: <json>\n\n` frames on `text/event-stream`, terminated `data: [DONE]`. Order: `content`* → `sources` → `evidence` → [`usage`] → `status` → [`followups`]. Abstain: `sources`(empty) → `status`. Safety: `sources`(empty) → `content`* → `safety` → `status`. `sources` arrives **after** text (citations filtered to used `[n]`), so clients buffer and late-attach. Unknown `kind`s are ignored (`FRAME_KINDS` allowlist, line 244) — the sanctioned additive-extension mechanism, which already bit once when `evidence` lagged the list.

**STOPPED-TURN contract (STRM-2, verbatim in the file header):** `answer_status` is a three-value CHECK (`answered|insufficient_evidence|error`, migration 073). Client stop ⇒ server persists `error` + partial `answer_text`, `evidence=[]`. Provider failure ⇒ `error` + `answer_text=NULL`. Clients reconstruct "Stopped" from `error && text non-empty` identically live and on hydration, and exclude stopped turns from history. A first-class `stopped` value needs a Mike-gated migration.

Two parallel parsers implement this contract: `mira-mobile/src/lib/sse.ts::createChatSseParser` (176 ln) and `mira-hub/.../notebook-chat-utils.ts::postNotebookChat`. Plus three more hand-rolled parsers for the clone dialect (AssetChat, NodeChat, AssetValidateTab) — **five SSE parsers for one product**.

## 3. Transport and platform reality (mobile)

- One transport module: `mira-mobile/src/api/client.ts` (486 ln) — four doors (`request`, `uploadMultipart`, `requestStream`, `requestBinary`), hand-rolled cookie jar (`flm.cookiejar.v1` Preferences key), typed `ApiError` (6 kinds), 401 fan-out to `onAuthExpired`.
- **On device, streaming is one buffered chunk** (verified honesty note at `client.ts` ~280-300): the CapacitorHttp fetch patch fulfils the POST natively and delivers ONE Response; `onChunk` fires once; abort never reaches the server, which persists a full **answered** turn the user asked to stop. Prerequisites for real streaming: Hub CORS for `https://localhost` + WebView cookie residency — #3453, not landed; the recovery PRD §10.2 forbids moving cookies across the WebView boundary without a separate Mike-approved ADR.
- History is client-built: `buildChatHistory` (`resources.ts:1228`) — last 12 lines, stopped turns filtered — rides on every POST; the server does not read prior turns for context.
- Ship path: pure web-bundle changes go over signed OTA (Capawesome); any native plugin change is an APK release, blocked otherwise by `scripts/ota-guard.mjs`.

## 4. Persistence models (three of them)

1. **Server turns** — notebook only: `equipment_notebook_turns`, one row per Q&A pair (`question`, `answer_text`, `answer_status`, `evidence` JSONB, asset snapshot). No turn IDs on the wire, no thread IDs, no roles, no lifecycle states; hydration via `GET /api/equipment-notebooks/[id]` → `turns[]`. User turns are **not** persisted independently (`recordTurn` runs only at stream end/stop — PRD §10.8 violated today).
2. **localStorage** — NodeChat/AssetChat (keys above; verified).
3. **Nothing** — Quickstart; mobile `liveTurns` React state (lost on unmount; reload resurrects server truth, including answered turns the user "stopped" on device).

## 5. Evidence and citations

- Citations = structured `EvidenceCitation` objects on the `sources` frame, linked to answer text by literal `[n]` markers the model emits; `selector` field exists but is an unused placeholder. `citationId` is a per-turn ordinal — meaningless across turns/regeneration.
- Server-side anti-fabrication layer (must never move client-side): `validateChatSources` positive-trust gate + supersede remap (#3442/#3477), `buildCitations` dedupe/quote-window, gpt-oss marker normalization, general-mode bracket stripping, `citationsUsedInAnswer` entailment-lite, `isRefusal` citation stripping, server-resolved `originFileId` (085), server re-derivation of machine rows and photo `capturedAt`.
- `machine_evidence` and `visual_observation` share the `evidence[]` array/frame with citations, separated only by shape (`"citationId" in c`).
- **Safety frame loses identity on persistence**: stored as `answered` + SAFETY_STOP text + empty evidence — on reload indistinguishable from an ordinary answer. Mobile's parser drops the `safety` frame entirely (no case). PRD §9.2 `safety_notice` has no persisted analog.
- Three citation grammars in the repo: notebook `[n]`+frames; asset-chat's own shape; bots' `[Source: ...]` (telemetry-only, Telegram/Slack path — not these surfaces).

## 6. Governance constraints (binding on any Phase 0/1 work)

- Recovery PRD (`docs/prd/2026-08-29-technician-beta-recovery-prd.md`): 30-day stabilization-first; no thread titles/search/export/regenerate/second conversation store; honest buffered Android, no cosmetic Stop; no second chat route. Phase 0 (read-only inventory + spike) is compatible; Phase 1 shipping is not until the recovery gates exit or Mike re-decides.
- The 2026-08-27 parity PRD is HELD — its "settled laws" (AI-is-home, rename, THRD-0) are **not binding**.
- Flags: no `feature_flags` table exists. What exists: env flags (`MIRA_CANONICAL_SEAM`, verified in the notebook route) and the capability system (`mira-hub/src/lib/capabilities.ts` → `GET /api/me` `capabilities[]` → `mira-mobile/src/nav.ts` fail-closed filtering). 5-tab nav frozen; tab id `chat` (titled "Notebook").
- `/VERSION` retired (#3064); no CHANGELOG edits; FactoryLM tokens only; MIT/Apache deps only; merges + device evidence = Mike.
- Tests available: hub vitest incl. `equipment-notebooks/__tests__/{chat-canonical-seam,chat-stop-persist,chat-safety-stop,...}.test.ts` (verified); mobile has ~23 pure-logic suites incl. `sse-incremental`, `request-stream`, `composer`, `transient-layer`; hub Playwright E2E against live prod; **no mobile emulator suite exists**.

## 7. Commodity behaviors MIRA hand-rolls today (assistant-ui replacement candidates)

1. **SSE consumption loop** — five independent `getReader()`+`TextDecoder`+split-on-`data:` parsers (mobile sse.ts, notebook-chat-utils, AssetChat, NodeChat, AssetValidateTab).
2. **Streaming repaint plumbing** — `pending` state + `pendingRef` mirror + `onUpdate(partial)` patching (NotebookScreen), in-flight `ChatTurn` patch-by-id (NotebookChat).
3. **Composer mechanics** — auto-grow (two implementations: `lib/composer.ts` scrollHeight fallback; hub `field-sizing: content`), Enter/Shift+Enter/IME keyCode-229 contract, Send↔Stop swap, byte-identical failed-send retry body (`PendingSend` / `ChatBody`), restore-composer-on-failure.
4. **Scroll management** — mobile force-scroll-to-bottom on every state change (direct PRD 10.1 violation: no stick-to-bottom detection, no jump-to-latest).
5. **Message list rendering** — persisted-vs-live dual mapping, stopped-turn branch duplicated 2×, empty states, follow-up chips, suggested questions — re-implemented per app.
6. **Markdown rendering** — react-markdown+remark-gfm+remark-breaks stacks maintained twice (`AnswerMarkdown.tsx` mobile, `notebook-markdown.tsx` hub) with code-copy, table wrap, link/image neutering.
7. **Message lifecycle fictions** — client-derived `queued/running/stopping` states with no server events; `isStoppedTurn` heuristic at two call sites.
8. **Sheet/dialog chrome** — `Sheet.tsx` + `BackDismiss` (mobile); ad-hoc hub equivalents. (The transient-layer BACK **stack** itself is MIRA domain — bridge, don't replace.)
9. **Thread-state bookkeeping** — three parallel mobile stores (`turns`/`liveTurns`/`pending`), localStorage caps on hub clones, no reconciliation/IDs.
10. **Retry/error surface** — `failedSend` chip, error-bubble popping (NodeChat), per-surface error copy.

**Not commodity (MIRA domain, survives any adapter):** cookie jar + four transport doors, `buildChatHistory`, scope building (`sourceDocIds`, explicit `mode:"general"`), citation→viewer navigation chain (`originFileId` fallback, `getSourcePassage`, `FilePreview`/`requestBinary`), transient-layer BACK stack, all server-side trust gates, resume-guard, offline WO queue, OTA machinery.

## 8. PRD §9.2 message parts vs today

| PRD part | Exists today? | Where / gap |
|---|---|---|
| `text` | ✅ | `content` frames (typed route); `{content}` (clones) |
| `attachment` | ❌ as a message part | Files go through separate upload routes (`uploadSourceToNotebook` two-step, `/api/files/`); only a `visualEvidence.fileId` claim rides the chat POST. Composer has no attachment entry point on either platform. |
| `source` | ✅ structured, ⚠️ linking | `EvidenceCitation` on `sources` frame; but inline `[n]` linking is regex over rendered text (violates §12.3 by construction); `selector` unused; ids turn-scoped ordinals |
| `tool_call` | ❌ | Does not exist anywhere. LOOK/READ/REPLAY are sheet-hosted instruments (`SensorSheet.tsx`) whose results arrive post-hoc |
| `tool_result` | ❌ | Same — no lifecycle-bearing tool events; §10.5 requires net-new server events |
| `machine_evidence` | ✅ | `MachineEvidenceEntry` on `evidence` frame + `evidence[]` JSONB; server re-derives windows; notebook route only |
| `observation` | ✅ | `VisualObservationEntry`, server-verified photo claims; notebook route only |
| `status` | ⚠️ terminal-only | 3-value `answer_status`; no progress states; `queued/running/stopping` are client fictions |
| `error` | ❌ typed part | `status:"error"` overloads stop AND failure (null-text heuristic); client `ApiError` typing never reaches the wire |
| `safety_notice` | ⚠️ live-only | `safety` frame exists (typed route); dropped by mobile parser, unrendered distinctly by hub, **not persisted** — reload loses it |

Missing wholesale vs §9.1/9.3: turn IDs, thread IDs, roles on the wire, lifecycle states, model-metadata frames (model persisted server-side only).
