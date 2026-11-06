# Overnight nitpicks 2026-10-25: archaeology
Main tip: `cb7545e456a610cfdd060d144a62eced82dc3932` (2026-10-25 03:48 ET, #4755). Read-only. Source: /workspace/nitpick/overnight-latest.md. Nothing reproduced live.
"Lane" = held #3626 shared-UI lane (packages/factorylm-ui/* and the /v3 adapter mira-hub/src/factorylm-ui/hub-host*, to-interaction.ts), draft #4303.
PR searches: none found for any of these numbers except #4755 (fix for #4751).

## #4749 Phone citation sheet too small, covers header — FINISH, S, #4372, LANE
- Code: packages/factorylm-ui/src/SourceViewer.tsx:38 bare iframe; conversation.css:214 `.fl-source-viewer` fixed `inset-block:0`, z-index 5 (covers the header), `overflow:auto`; :219 document width min(48rem,96vw); :222 frame `min-block-size:60vh`. Href only `#page=N` (mira-hub/src/factorylm-ui/to-interaction.ts:179).
- Prior: same fix as #4685 (FINISH S) and #4684 (CONNECT loading/snippet) in the 10-25 remaining brief; related #4668, #4431. No branch or PR.
- Tests: media-previews.test.tsx:106-117, media-links.test.ts:21-42 (pin the href).
- Smallest fix: one PR for #4684 + #4685 + #4749. Under 48rem make the document viewer full-screen with a slim sticky title bar (manual, page, Close) and frame `flex:1` with no nested scroll; append `&zoom=page-width&pagemode=none`. Pinch-zoom inside the native PDF iframe on mobile browsers is UNVERIFIED.

## #4750 Raw "[3]" with no chip under "not grounded" — FINISH, S, #4372, partly LANE
- Code:
  - Server: chat route.ts. In general mode (`docGrounded = chunks.length>0`, :2420) markers are stripped by makeGeneralBracketStripper (:461, applied at :3921/:3966 only when `!docGrounded`).
  - In grounded mode, `citationsUsedInAnswer` (:820-826) keeps citations whose id appears as `[n]`, but a marker with no matching citation is never removed from the text.
  - The "not grounded" badge comes from an empty citation set.
  - Likely mechanism (UNVERIFIED): retrieval returned chunks (grounded path, so no stripping), the model wrote [3] for an id outside the set or one dropped later (uncited/validation filtering), so sources ended up empty while the text kept `[3]`.
  - The client already has the right regex only for Copy: packages/factorylm-ui/src/answer-actions.ts:70 drops unresolved markers.
- Prior: 10-20 archaeology #8 FINISH (draft #4476: route drops uncited sources without renumbering), #4667, #4689. Draft #4476 is the natural home.
- Smallest fix: server side, after the final answer, strip `[n]` that don't resolve to a kept citation (reuse makeGeneralBracketStripper's regex filtered by the id set) before release and persist; plus the renumbering in #4476. The "the excerpts say" wording goes to Notebook Prover, not code. The server part isn't in the lane; the client fallback (reusing answer-actions.ts:70 in render) is in the lane.

## #4751 Sent bubble drops line breaks — ALREADY FIXED (closed)
- Fixed by PR #4755, commit `cb7545e4` "fix(hub): keep the technician's own line breaks in the sent bubble (#4751)", which is the current main tip. Verdict REUSE (nothing to do). Staging deploy of cb7545e4 is UNVERIFIED.

## #4752 Send before projects load → "Couldn't reach MIRA — Still loading your projects" — FINISH, S, #4372, LANE
- Code:
  - mira-hub/src/factorylm-ui/hub-host.tsx:649 (home, `homeSendPlan` loading) and :654 (`!detail` inside a notebook) throw `NO_PROJECT_ERROR` (hub-host-logic.ts:344).
  - Composer catches it, and SendError.tsx:77 always renders the heading "Couldn't reach MIRA" above the message (:64 sets the text).
- Prior: same root as #4682 (loading treated as empty, hub-host.tsx:326-327) and #4688; the unpushed `fix/v3-list-loading-state` claim (watcher comment on #4688; not on the remote). #4695 fixes (#4740/#4743/#4744/#4745) already keep typed text while loading. Test: hub-host-logic.test.ts:155.
- Smallest fix: disable Send with a "Loading your projects…" hint while `notebooks===null` or `!detail` (or queue the send and auto-fire on load); and let SendError skip the "Couldn't reach" heading for a loading-class error. Bundle with #4682.

## #4753 Tab title always "FactoryLM Hub" — BUILD (tiny), S, #4372, LANE (hub-host)
- Code: mira-hub/src/app/layout.tsx:21-23 sets `default:"FactoryLM Hub"` with `template:"%s · FactoryLM Hub"`; mira-hub/src/app/v3/page.tsx sets no metadata, and /v3 is client-routed by query string, so the template never applies. No `document.title` anywhere in the /v3 code.
- Prior: none.
- Smallest fix: a useEffect in hub-host.tsx setting `document.title = \`${threadTitle ?? projectName ?? "Home"} – FactoryLM\``, prefixed "● " while a turn is outgoing.

## #4754 Long answers open scrolled to the bottom — FINISH, S, #4372, LANE
- Code: packages/factorylm-ui/src/useConversationFollow.ts:88-90 runs `node.scrollIntoView({block:"end"})` on the latest turn while following. AssistantThread.tsx:245-246 has the primitive's autoscroll off, so this hook is the only scroller.
- Prior: #4680 (auto-scroll fix; re-check says fixed) and follow-ups #4710/#4714 in the same hook. Tests: conversation-follow.test.tsx, phone-readability.test.tsx:105.
- Smallest fix: when the last turn is an assistant answer that has finished (or once it grows past the viewport height), scroll its top under the question into view (`block:"start"`) and stop following; add a test case to conversation-follow.test.tsx.

## A. Attach sheet dead after creating a project until reload — REPAIR-class, filed as FINISH, S-M, #4732 (round trip: project → attach manual), LANE
- Code:
  - Create: hub-host.tsx:685-686 `createNotebook` then `select({notebookId:id, threadId:newThreadId()})`.
  - Attach: packages/factorylm-ui/src/Composer.tsx:119-127 captures `state.thread.id` at pick time; :101 shows only pending items whose `threadId === state.thread.id`.
  - Upload needs `detail.notebook.nodeId` (hub-host.tsx:654/657, hub-attachments.ts:88-94 returns "failed" when nodeId is missing).
- Candidate mechanisms (UNVERIFIED, needs a repro with DevTools):
  - (a) The shell thread id changes after the pick (selection → detail load), so the chip is filtered out at :101 and looks "dead".
  - (b) `detail` for the new notebook never loads/refreshes after create, so `!detail` blocks the send (:654) and nodeId stays null.
  - (c) The attachment menu's `busy` state is stuck from the create flow.
- Prior: no issue filed yet; related to the #4682/#4688 loading cluster and #4695 (thread-loading draft fixes #4740-#4745 touched the same selection/landing reducer).
- Smallest fix: after createNotebook, await the detail fetch (as the sendFromHome path does at :605) before handing control back, and key pending attachments on the selection rather than the transient shell thread id. Add a regression test in hub-host-logic/hub-attachments.

## B. No upload progress or indexing status; "add the manual" for about 5 minutes after upload — BUILD (status UI) + CONNECT (freshness), M-L, #4732, LANE for the UI
- Code:
  - Upload: mira-hub/src/app/api/namespace/node/[id]/files/route.ts POST. It's synchronous ingestPdfToNode (~:382-392) returning `indexed:true`, or 202 `{indexed:false, indexing:true}` when another request holds the ingest claim (~:378, :400).
  - Client: hub-attachments.ts:166-185 does a single POST with no progress events, and treats `!indexed` (including the 202 indexing case) as a hard "couldn't be read" failure. That message is wrong for `indexing:true`.
  - Refusal text: chat route.ts:3139 "…Add the manual for the equipment…".
  - Why answers lag about 5 minutes is UNVERIFIED. Candidates:
    - the notebook source snapshot / validateChatSources (:1546) doc list doesn't include the new upload until detail refetch (`docIds` comes from stale `detail`, hub-host.tsx:657);
    - async embedding / NOTEBOOK_HYBRID_RETRIEVAL lag;
    - a retrieval cache.
- Prior: 10-20 archaeology #10/#11 (manual-acquisition banner, #4556 hybrid flag); Codex #4024 F5 fail-closed upload; ARPK 1b dedup (route comment); #4686 (wrong name after dedup).
- Smallest fix:
  - (1) CONNECT: after a successful upload, refetch detail so `docIds` includes the new doc before the next send. This is cheap and likely the main cause.
  - (2) Treat `indexing:true` as pending, not failed, and poll GET files until indexed.
  - (3) BUILD: a progress/"Indexing…" chip on the attachment (Attachment.status already supports non-ready states in @factorylm/interaction). Upload byte progress needs XHR instead of fetch.
