# /v3 phone composer "silent" send failure: archaeology (read-only)
Repo Mikecranesync/MIRA, main tip **6bd437aa77db04c170cb09e64291e64bf06d7353** (2026-10-22 ET). No edits or PRs.
Symptom: staging 390x844, notebook d33363a1. The first POST to /chat fails with net::ERR_CONNECTION_CLOSED; the text stays in the composer, no visible error, and a second tap works.

## Bottom line
The error is **not swallowed**. The host catches it, sets `sendError`, puts the question back in the draft and arms Retry. The banner renders where the phone can't see it. This is an **existing open issue, #4311** (opened 2026-10-07): "error renders off-screen on phone web … banner at y=5401 … what the technician sees is their question back in the composer and nothing else". Our repro matches it exactly. Verdict: **FINISH #4311**.

## (a) Error path: caught and surfaced to state, but off-screen. FINISH
- `mira-hub/src/factorylm-ui/hub-host.tsx:401` `send`; `:416` fetch POST `/api/equipment-notebooks/{id}/chat/`. ERR_CONNECTION_CLOSED reaches JS as `TypeError: Failed to fetch`.
- `hub-host.tsx:447-471` catch:
  - `retainedStreamInterruption` (`:449`) handles a partial stream.
  - Otherwise `sendFailureMessage(err)` maps "Failed to fetch" to `NETWORK_FAILURE_MESSAGE` (`hub-host-logic.ts:363-370`; #4311 defect 2 is already fixed).
  - The live turn is cleared, `dropOutgoing` (`:465`) runs, `setFailedBody` arms Retry, `set-send-error` is dispatched, and `set-draft` puts the question back (`:468`).
  - `finally` runs `setBusy(false)`.
- The composer clears the draft and error synchronously on hand-off (`packages/factorylm-ui/src/Composer.tsx:154-170`), and the host restores the draft later. That restored draft is the "text stayed" the reporter saw.
- Render: `packages/factorylm-ui/src/FactoryLMShell.tsx:201` mounts `<SendError>` (`SendError.tsx:40-80`, role=alert, Try again/Dismiss) as a sibling **between the thread and the Composer** inside `.fl-shell__main`.
- **Why nothing is seen:**
  1. **There is no CSS for `.fl-send-error*` anywhere in the repo** (grep across all *.css finds zero hits). The banner is unstyled body text.
  2. `.fl-shell__main` sets `grid-template-rows: auto minmax(0,1fr) auto` (`conversation.css:1`; `shell.css:112`) for three children. With SendError mounted there are four (header, thread, error, composer), so the composer drops into an implicit row. The sticky composer (`conversation.css:160`, `position:sticky; inset-block-end:0`) can then cover the error.
  3. Nothing scrolls the alert into view or announces it near the composer. #4311 measured it at y=5401 on 412x915. Which of 1 and 2 dominates at 390x844 on the current tip is **UNVERIFIED** (needs a DOM probe of `[role=alert]` getBoundingClientRect).
- Lane: `SendError.tsx`, `FactoryLMShell.tsx`, `conversation.css` and `hub-host.tsx` are all shared-core/#3626 lane (#4311 says to check the `[WORK-CLAIM]` on #3626 first).
- **Smallest fix:**
  - Move `<SendError>` inside the composer's sticky block (or render it at the top of `.fl-composer`) so it sits directly above the input.
  - Add `.fl-send-error` styles (fault tokens, 44px buttons).
  - Alternatively, update `grid-template-rows` to `auto minmax(0,1fr) auto auto`.
- **Proof:** a 390x844 staging script based on the #4311 `h14c_error_visibility.mjs`. Force a network failure (route.abort / offline) and assert `[role=alert]` intersects the viewport without scrolling, then Try again produces exactly one persisted turn. Unit tests: add to `packages/factorylm-ui/src/__tests__/v4-review-fixes.test.tsx` / `mobile-behavior.test.tsx` (the alert is rendered inside or adjacent to the composer), and `hub-host-logic.test.ts` already covers `sendFailureMessage`.

## (b) Reusable error/retry UI. REUSE
- `packages/factorylm-ui/src/SendError.tsx` (banner with host-retry via `hooks.onRetry`, draft fallback, Dismiss). Wired in hub: `hub-host.tsx:656` `onRetry` re-sends `failedBody` byte-identically, exposed at `:870`.
- State: `packages/factorylm-interaction/src/reducer.ts:63,326-329` (`set-send-error`).
- Mobile: `mira-mobile/src/screens/UnifiedChat.tsx:340,431-439` uses the same shared shell SendError, with `onSendErrorDismissed` and dismiss detection. The legacy `NotebookScreen.tsx:354-407` has its own retry with a stable clientRequestId.
- No toast system is needed. BUILD is not warranted.

## (c) Idempotency and duplicates. REUSE (server) + FINISH (client for the second tap)
- Server: `app/api/equipment-notebooks/[id]/chat/route.ts:1164-1170` validates a UUID `clientRequestId`. `:1200` turnId = clientRequestId. `:1461-1500` `claimNotebookTurnRequest` is claimed **before** retrieval and streaming. A finished turn gets `replay` (replayNotebookTurnResponse, `:955`), a running one gets 409 `request_in_progress` with Retry-After 2, and a changed payload gets 409 `client_request_id_reused`. So persist/claim happens before the stream, and dedupe is keyed.
- Client: `buildChatBody` (`mira-hub/src/components/equipment/notebook-chat-utils.ts:325-336`) mints a **new** `crypto.randomUUID()` per call via `chatBodyFor` (`hub-host-logic.ts:296`).
  - **Try again** (`onRetry`, `failedBody`) reuses the same key, so it is safe. #4311 measured exactly one persisted turn.
  - **A second tap on Send** (what the reporter did) builds a fresh body with a new key. If the first POST reached the server before the connection closed, a **duplicate turn is possible**. For ERR_CONNECTION_CLOSED pre-response, whether the server received it is UNVERIFIED (check the flight recorder `ids` stage `client_request_id` for that notebook/time).
- **Smallest fix:** when the composer's draft equals `failedBody.question` and the scope is unchanged, Send should reuse `failedBody.body` (same clientRequestId), i.e. route through `onRetry`. This is in the lane (hub-host.tsx).
- **Proof:** a unit test that a failed send followed by Send of the same text posts the same clientRequestId. On staging, abort the first request after the server receives it, re-send, and confirm one turn in the thread.

## (d) Prior PRs and issues
- **#4311** (open): this bug (off-screen banner, raw "Failed to fetch" now fixed in hub-host-logic, composer not cleared after retry, also handled by `draftAfterSendSucceeded` `hub-host-logic.ts:377`). Remaining: defect 1 only (verify 3 on staging, UNVERIFIED).
- #4443 (closed): Enter while answering deleted the next question; the fix is in Composer.tsx:150-153.
- #4370 (open): pilot invites, silent send failure (a different surface).
- #3998, #3996, #4126 (open): mobile photo-send retry/visibility.
- #4074 (open): carry the persisted turn id to the client.
- #4417 (open): onboarding 412 shown as "Connection lost".
- I found no open PR implementing #4311.

## Overflow fix (10-21 brief) status
- The tip still has `.fl-thread__viewport` (`conversation.css:272-281`) and `.fl-turn--aui` (`:286`) **without `grid-template-columns: minmax(0,1fr)`**. It is not fixed on main.
- conversation.css changed recently via merged #4617, #4622 and #4625 (readability, labels, composer height; `:290` scroll-margin). None of them added the template.
- Open PRs: I scanned the titles of the 100 open PRs. Only #4474 (draft, head 3261566b086dbf15e402bbe3afe4c5e9b9394ec1, "New chat in the notebook conversation header") touches the shared shell. Its files are FactoryLMShell.tsx, ThreadHeader.tsx, shell.css, tests and mira-mobile/tests/unified-chat.test.tsx, **not conversation.css**. **No open PR implements the overflow fix.** Per-file checks on the other open PRs: UNVERIFIED (titles unrelated).
- Note: #4474 touches `FactoryLMShell.tsx`, the same file as the SendError placement fix, so coordinate.
