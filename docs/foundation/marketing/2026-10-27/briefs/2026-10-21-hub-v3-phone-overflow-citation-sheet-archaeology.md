# Hub /v3 phone overflow and citation sheet: archaeology (read-only)
Repo Mikecranesync/MIRA, main tip **d1d1511de47822f6badd722af0a9b3943b7873f0**, read 2026-10-21 ET. No edits, PRs or comments.
Shared-UI lane #3626 (F004 M2, draft #4303): parts.tsx, conversation.css, factorylm-interaction types.ts, hub to-interaction/hub-host-logic/hub-host, mobile unified chat.

## Item 1: thread overflow (bubble about 646px, answer about 644px at 390px). Verdict: **FINISH**
- /v3 uses the assistant-ui surface (`hub-host.tsx:891` conversationSurface="assistant"). Containers:
  - `packages/factorylm-ui/src/conversation.css:259-269` `.fl-thread__viewport`: `display:grid` with **no grid-template-columns**, so it gets an implicit `auto` column.
  - `conversation.css:273` `.fl-turn--aui`: `display:grid`, also **no template**, so an `auto` column. Rendered by `assistant/AssistantThread.tsx:101-108` (MessagePrimitive.Root/Parts).
  - `conversation.css:282-286`: the assistant `.fl-part--text` has `max-inline-size:75ch`. At 15px that is about 644px, which matches the measured width exactly. This is a cap, not a floor, so the track itself is wider than 390px.
  - User bubble: `conversation.css:64` (78%) and `:241` (90% under 48rem). 90% of a track of about 718px is about 646px, which matches.
  - `.fl-part--text` (`conversation.css:69`) has no `overflow-wrap`/`min-inline-size:0`.
- Root cause: grid `auto` tracks take the min-content of their widest descendant, and grid items default to `min-width:auto`. One unbreakable descendant (a long URL or filename, the manual-download notice with a raw PDF URL (prior finding #10), or a nowrap chip) therefore widens the whole column past the viewport, and every bubble then sizes off that wider track. Which element is the trigger is **UNVERIFIED** (needs a DevTools min-content probe). The structural defect is verified in the CSS.
- Earlier fixes: #3731 (24c4f0f2) added `.fl-source__title{overflow-wrap:anywhere}` (`conversation.css:91`) only. #3733 is the same overflow class on the mobile sheet heading and is still open. I found no earlier fix to the thread track. The shallow clone limits git-log depth, so the history search is partial (**UNVERIFIED**).
- Smallest fix (lane: conversation.css): `.fl-thread__viewport, .fl-turn--aui { grid-template-columns: minmax(0,1fr); }`, plus `.fl-turn--aui > * { min-inline-size:0 }` and `.fl-part--text { overflow-wrap:anywhere; }`.
- Proof: at 390x844 on /v3, `document.documentElement.scrollWidth === 390`, and the bubble and paragraphs measure ≤ 390 minus padding. Add a case to `packages/factorylm-ui/src/__tests__/mobile-behavior.test.tsx` / `assistant-thread.test.tsx` (CSS string assertion on the template). Rerun the existing suite under packages/factorylm-ui.

## Item 2: chip rows 491px, Copy at x=-47. Verdict: **FINISH (same root cause)**
- The chip is `parts.tsx:430-444` (button `.fl-part.fl-source`), styled at `conversation.css:90-91`: `inline-size:fit-content; max-inline-size:100%`, with the title already set to `overflow-wrap:anywhere`.
- `max-inline-size:100%` resolves against the inflated track from item 1, so a chip can reach 491px. The chip's own wrapping is fine once the track is bounded. Copy at x=-47 is the actions row (`AssistantThread.tsx:110-119`, `conversation.css:48,58`) in a page that is scrolled sideways. That is a symptom, not a separate bug.
- Optional follow-up: add `.fl-source__locator{overflow-wrap:anywhere}` (the locator falls back to an 80-char quote, `to-interaction.ts` sourceFor). The duplicate-long-title problem is issue #4563, which is separate.
- Proof: same 390px probe. Chip `getBoundingClientRect().right` ≤ 390 and Copy x ≥ 0.

## Item 3: citation sheet has no preview or snippet. Verdict: **CONNECT** (preview: REUSE plus FINISH #4431)
- The sheet is `packages/factorylm-ui/src/SourceViewer.tsx:16-37`. It renders kind label, `<h2>` title, locator and the "Open document in a new tab" link. It shows an iframe only when `isSameSite(href)` (`:25,34`). Off-site manuals (shared-library `sourceUrl`) therefore get only a link, which is exactly the screenshot.
- The snippet data already exists: `EvidenceCitation.quote: string|null` (`mira-hub/src/lib/notebook-chat-types.ts:52`) is in the SSE sources frame (`chat/route.ts:3040,3187,4675`). It is dropped at `mira-hub/src/factorylm-ui/to-interaction.ts` `sourceFor` (about lines 195-206), which only uses the quote as a locator fallback. `SourceReference` (`packages/factorylm-interaction/src/types.ts:187-196`) has **no snippet field**.
- The page preview exists for parked files. `citationHref` (`to-interaction.ts:~176-183`) serves `/api/namespace/files/{id}/#page=N`. The classic `(hub)/equipment/[id]/source/[docId]/page.tsx:50,79` iframe uses the same route. There is no page-image or thumbnail renderer anywhere: grep for pdfjs/pdftoppm/page-image found only server ingest/OCR.
- #4431 (open) is "citation sheet shows an empty PDF frame" (same-site iframe blank on the phone). #3733 (open) is the mobile `.sheet` heading overflow in `mira-mobile/src/app.css:357`.
- Smallest step (all files in the lane): add an optional `snippet?: string` to `SourceReference` in types.ts, set it from `citation.quote` in `sourceFor`, and render it in `SourceViewer.tsx` as a quoted block. Also add `overflow-wrap:anywhere` on the `h2`. A real page image would be BUILD. Defer it, and track the iframe work under #4431.
- Proof: extend `mira-hub/src/factorylm-ui/to-interaction.test.ts` (quote → snippet) and `packages/factorylm-ui/src/__tests__/media-previews.test.tsx`/`conversation.test.tsx` (sheet renders the snippet). Then check on staging at 390px. Whether staging `quote` is non-null for shared-library chunks is **UNVERIFIED**.

## Lane membership (#3626)
| File | Lane |
|---|---|
| packages/factorylm-ui/src/conversation.css | YES |
| packages/factorylm-ui/src/parts.tsx | YES |
| packages/factorylm-interaction/src/types.ts | YES |
| mira-hub/src/factorylm-ui/to-interaction.ts, hub-host.tsx | YES |
| packages/factorylm-ui/src/SourceViewer.tsx | not listed (UNVERIFIED; shared package) |
| packages/factorylm-ui/src/assistant/AssistantThread.tsx | not listed, no change needed |
| mira-hub/src/components/equipment/notebook-markdown.tsx | no, no change needed |

## PR and issue overlap
- **#4608** is an open PR, head `0b5c319f3dc3fe69aa0b637bbca8841beea45b30`. It touches only `mira-hub/src/factorylm-ui/GuidedProcedure.tsx` and `.test.ts`, so **no overlap**.
- **#4561–#4569 and #4613–#4616 are ISSUES, not PRs.** All are open and none has a fix in flight. Related ones:
  - #4563: chips repeat a long title, page number tiny, no section or snippet. This is item 3 and the snippet step closes part of it.
  - #4613: 15px answer text and 11–12px labels. Same CSS file, different rules.
  - #4616: no scroll to the new turn after Send. Touches the thread viewport, so coordinate with item 1.
- Open PRs touching these files: none found by title scan of the 100 open PRs. Per-file diffs were checked only for #4608 (partly UNVERIFIED).

## Suggested grouping
- PR A (lane, CSS only): items 1 and 2.
- PR B (lane): snippet passthrough plus sheet heading wrap (item 3, #4563 part, #3733 parity for mobile `app.css` optional).
- #4431 iframe or page preview stays separate.

## Addendum: TP700 fresh-thread retest
Tip d1d1511de47822f6badd722af0a9b3943b7873f0. Screens: /workspace/punchlist/prover/tp700-retest-1.png and tp700-retest-fresh.png.

**Key observation from the screenshots:** the "existing thread" did not ground 2/2 cleanly. In tp700-retest-1.png the *identical* question "What is the permitted supply voltage range for the TP700 Comfort?" was **refused once** ("I can't find… so I won't guess", General badge) and **grounded on the next ask** (+19.2 V to +28.8 V, p.223), in the same thread. Fresh thread 52d70150 refused with "The provided excerpts do not state…". That wording comes from the grounded prompt (GENERAL_SYSTEM_PROMPT forbids it, `route.ts:337`), so excerpts were supplied and the turn ran grounded. The variance is per-turn, not per-thread.

### 1) Route chain: one canonical path (verified)
- `mira-hub/src/factorylm-ui/hub-host.tsx:482-515`: composeAndSend calls `composeHubSend`, then `chatBodyFor(question, composed.scope ?? fallbackScope, history, sel)`.
- `hub-host-logic.ts:284-306`: chatBodyFor sets `threadId` and adds `mode:"general"` **only if docIds is empty** (`:305`).
- `hub-host.tsx:416`: `POST ${API_BASE}/api/equipment-notebooks/{id}/chat/`.
- `app/api/equipment-notebooks/[id]/chat/route.ts:1153` (general = body.mode), `:1182` (sanitizeHistory), `:1546-1547` validateChatSources(`lib/equipment-notebooks.ts:1174-1204`, notebook-level `equipment_notebook_sources`, positive trust only).
- Then `route.ts:2027` builds the retrievalQuery (`buildRetrievalQuery` + `englishSearchQuery`) and `:2040` sets notebookRetrieval.
- The notebook lane is `:2227` `retrieveNodeChunks(…, {docIds, rawQuery: message, identity, validatedDocScope:true})` (lib/manual-rag.ts). An OEM-corpus lane `retrieveManualChunks` (`:~2197`) is used only when notebook sources aren't validated and an OEM identity exists.
- Other paths: general mode only fires on zero docIds, which is not this case. Manual acquisition (`notebook-manual-acquisition.ts`, imported at `route.ts:67-75`, blocks around `:2332/:2442`) is a side-effect and status path, **not** a substitute answer path. No ask_api, pipeline or Open WebUI path is involved. The scope is notebook-level: `fallbackScope`, the same for every thread in the notebook. Thread-level attached sources only add a composed photo/file scope.

### 2) Why a fresh thread retrieves or answers differently (ranked)
1. **Generation/abstention variance with p.223 marginal in top-6.** The same question in the same thread both refused and grounded, which is the strongest evidence. With topK 6 (`route.ts:2230`), BM25-only when NOTEBOOK_HYBRID_RETRIEVAL is off (`capabilities/hybrid-retrieval.ts:26`, `manual-rag.ts:1636`), and refusal/entailment downgrades (`route.ts:~533-601`), a borderline chunk or rank yields either answer. Whether p.223 was in the refused turns' excerpts is UNVERIFIED (needs the Turn Flight Recorder `retrieval` stage or staging logs for thread 52d70150).
2. **History reaches the model, not retrieval.** `buildProviderMessages` (`route.ts:765-779`) puts prior turns, including an earlier grounded "+19.2–28.8 V" answer, into the prompt. That primes the old thread; a fresh thread has none. The retrieval rewrite `buildRetrievalQuery` (`lib/notebook-query.ts:710-727`) returns the message unchanged unless `isReferentialFollowup` (`:604-617`: ≤5 words or pronoun/follow-up patterns). This 11-word self-contained question is **not** rewritten, so retrieval input is identical across threads. Likely, but the history effect is UNVERIFIED.
3. **Hybrid/lexical v2 off on staging.** BM25 alone ranks a spec table weakly against prose. The staging flag value is UNVERIFIED (Doppler not read).
4. **Scope missing at thread creation.** Low likelihood: an empty scope would have sent `mode:"general"` (`hub-host-logic.ts:305`), and the refusal text proves a grounded turn. A race on fresh detail load (cf. #4479 draft) is UNVERIFIED but inconsistent with the evidence.
5. **First-turn special case (greeting/intent/manual-status gate).** I found none that changes retrieval for this message. The manual-status gate only appends the banner. Low.

### 3) Mapping onto the Oct 20 majors (no new lanes)
- **#10 banner. Verdict REPAIR (unchanged), confirmed by the retest:** the banner sits under the grounded p.223 answer. `withManualSearchStatus` (`to-interaction.ts:521-540`) appends to the last assistant turn regardless of grounding, and `currentManualSearchStatus` (`notebook-manual-acquisition.ts:1087-1158`) does not treat the indexed "TP700/TP900/TP1200 Comfort" manual as covering the TP700 Comfort identity. The es-ES OUTDOOR URL is interpolated by `acquisitionDeclineText` (`:1020-1031`).
  - Smallest step (server-side, no lane files): return null status when an indexed notebook source covers the model, or when the turn is grounded. Keep the URL as a link field, not in the message text.
  - Proof: on d33363a1 the grounded TP700 answer shows no banner after reload. Add a unit test in the acquisition tests: an indexed multi-model manual means a null status.
- **#11 inconsistent retrieval. Verdict FINISH #4556 + CONNECT NOTEBOOK_HYBRID_RETRIEVAL (unchanged); add one diagnostic.**
  - Pull the flight-recorder retrieval stage for the refused turns (thread 52d70150, plus the refused turn in the old thread) and check whether the p.223 chunk was in the top-6. If yes, the cause is generation/abstention (route refusal handling, a #4514 follow-up inside the same lane). If no, it is ranking, fixed by #4556 lexical v2 or hybrid on.
  - Proof: the same TP700 question asked 3× in 3 fresh threads all ground with the p.223 citation (+19.2 to +28.8 V), with the flags as set on staging.
