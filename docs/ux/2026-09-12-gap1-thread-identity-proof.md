# Gap 1 — New Chat and thread identity: evidence packet

**Parity authority:** `docs/architecture/convergence/CHATGPT_PARITY_CONTRACT.md` §5 Gap 1 / §6 Slice A
**Lane:** PR #3757, branch `v7/chatgpt-ui-replacement`
**Head SHA:** `06949115e2d8cbc1ab0245c5417e2e5fafad31fd` (base `f8913760b`, the #3746 stack tip)
**Date:** 2026-09-12

## What this slice proves

The contract's foundational requirement: *"A UI that looks like ChatGPT but
appends New Chat messages to an old server thread is not ChatGPT-like
behavior."* This packet proves the canonical implementation does NOT do that —
and root-causes the one live observation that suggested it might.

## Root cause of the earlier live anomaly (before state)

The 2026-09-12 live golden-flow run against `app.factorylm.com` observed a
reopened New Chat showing ~10 turns instead of 2. Root cause, now proven:

- `mira-hub/db/migrations/087_notebook_thread_identity.sql` is **not on
  `origin/main`** (`git cat-file -e origin/main:…/087_… → missing`). It ships
  in unmerged PR #3741, which is part of this lane's base stack.
- Production therefore has no `thread_id` column and its routes ignore
  `?threadId=` / body `threadId`, so every read returns the notebook's whole
  default conversation. The client did everything right; the deployed server
  predates thread identity.

This is a **deployment-lag fact, not a client or design defect**. No
presentation logic papers over it (contract §8): the fix is the canonical
stack merging and deploying, which is human-gated.

## After state — proof at every layer of the branch

### Server truth on real Postgres (new in this slice, commit `06949115e`)

`mira-hub/tests/integration/notebook-thread-identity.integration.test.ts`
(runs via `vitest.integration.config.ts` against real Postgres with
migrations 000→087 applied by `scripts/setup-integration-db.mjs`, which now
includes 087). Result: **6/6 pass** (plus the pre-existing owner integration
test 2/2 — 8/8 total). Proven on the actual schema, RLS, and constraint:

1. A New Chat turn persists its client-generated `thrd_…` id **verbatim**.
2. Reading that thread returns **only its own turn** — none of the five turns
   from a busy pre-existing default conversation leak in.
3. The new thread **appears in `listThreads`** with `turnCount: 1`, a title
   derived from its first question, ordered newest-first.
4. Re-reading the **exact thread id** restores question + answer intact
   (the "navigate away → reopen the exact thread row" step).
5. The legacy/default conversation is isolated in the **other direction** too
   (its 5 turns, nothing from the new thread).
6. A second New Chat mints a second **independent** thread; all three
   conversations coexist under one notebook.
7. Another technician's thread list never shows my private threads (086
   ownership composes with 087 identity).
8. 087's CHECK constraint rejects a malformed thread id **at the database**.

### Route plumbing (pre-existing on branch, re-run green)

- `GET /api/equipment-notebooks/[id]/?threadId=` parses/normalizes and passes
  `threadId` to `listTurns`; invalid ids → 400
  (`history-owner.test.ts`).
- `POST …/chat/` persists the request's `threadId` via `recordTurn`, isolated
  from ownership (`turn-ownership.test.ts`).
- `listTurns`/`recordTurn` SQL shape asserted (`notebook-turn-owner.test.ts`).
- Hub unit tests for these files: **99/99 pass**.

### Client identity + routing (pre-existing on branch, re-run green)

- Home send / sidebar New chat generates a fresh `thrd_` id, remounts
  `NotebookScreen` keyed on `notebook:thread`, never destroys the old thread;
  opening a thread row passes that row's exact id
  (`unified-root.test.tsx`, `unified-chat.test.tsx`: **16/16 pass**).
- `NotebookScreen` threads the id through both reads and sends:
  `getNotebookDetail(id, { threadId })` and `askNotebook(id, …, { threadId })`
  (`NotebookScreen.tsx:273,1145`).

### Suite health at this head

- Shared UI contract (bun 1.4.0): **210/210 pass**.
- `mira-mobile` `tsc --noEmit`: **0 errors**.
- Lifecycle guard over `f8913760b..HEAD`: flags only the pre-existing
  `mira-mobile/src/screens/__tests__/unified-chat.test.tsx` guard-vs-charter
  gap (contract §12.3 — being repaired separately, not in this lane). The new
  hub test lives in the open `mira-hub/tests/` subtree precisely so this slice
  adds **zero** new guard exceptions.

## Acceptance matrix (contract §7)

| Gap 1 acceptance item | Branch (code + tests) | Live deployed host today |
|---|---|---|
| New Chat → blank conversation | PASS | PASS (observed 2026-09-12 live run) |
| Send → distinct server thread ID created | PASS (persists verbatim, real Postgres) | UNVERIFIED — prod lacks 087 |
| Only that conversation's turns appear | PASS (isolation both directions) | FAIL — root-caused above |
| Thread appears in Recent/history | PASS (`listThreads` + draft row client-side) | UNVERIFIED — prod has no thread list |
| Reopen exact thread row → intact restore | PASS (exact-id re-read intact) | FAIL — superset returned (same root cause) |
| No leak from older/legacy thread | PASS | FAIL — same root cause |
| No new store/thread model/parser/root UI created | CONFIRMED — reuses #3741's model end to end | — |

**Gap 1 verdict: PASS at every branch layer; live-host PASS is blocked solely
on the canonical stack (#3731→#3737→#3741→#3745→#3746 + this lane) merging
and deploying — a human-gated action this lane does not take.**

## What remains unverified

- Full HTTP-level E2E on a deployed host (blocked as above).
- Streaming answer content inside a brand-new thread on a live backend (the
  earlier live run proved streaming; the thread-scoped read of it needs 087).

## Next gap (contract §6 order)

**Slice B — Sidebar interaction parity**: mobile drawer open/select/close
behavior, selected-thread state, rename/archive/delete contextual controls,
Recent ordering. Client thread titles currently come from the server's
first-eight-words rule (`threadTitleFromQuestion`) — adequate for Slice B
entry.
