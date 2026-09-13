# FactoryLM ChatGPT-Style UI Replacement — Audit + First Slice

**Date:** 2026-09-12 · **Node:** BRAVO · **Lane:** PR #3751 refocused (UI-replacement/cutover)
**Base SHA:** `f8913760b` (PR #3746 tip = full canonical stack #3731→#3737→#3741→#3745+camera)
**Head SHA:** `9401e42ed` · **Branch:** `v7/chatgpt-ui-replacement` (local, NOT pushed)
**Worktree:** `~/Mira-worktrees/v7-chatgpt-ui-3751` (isolated)

---

## A. Architecture audit (brief §11–12)

### KEEP — correct, reused unchanged
- `packages/factorylm-interaction/**` — domain contract: `types.ts` (InteractionTurn/Thread/Part, HostHooks, PlatformAdapter), `reducer.ts` (ShellState/ShellAction state machine), `adapters.ts`, `fixtures.ts`. The narrowest boundary; every surface honors it.
- `packages/factorylm-ui/src/parts.tsx` (PartRenderer — canonical part interpreter), `SourceViewer.tsx` (citation overlay), `Overlay.tsx`/`focus.ts` (modal/focus), `SendError.tsx`, `ThreadHeader.tsx`, `Inspector.tsx`, `AttachmentMenu.tsx`, `assistant/AssistantThread.tsx` + `assistant/runtime.tsx` (assistant-ui viewport/autoscroll).
- `packages/factorylm-theme/**` — design tokens.
- `mira-mobile/src/unified/**` (`to-interaction.ts`, `notebook-tree.ts`, `capacitor-adapter.ts`) — canonical mobile adapters.
- `mira-mobile/src/screens/NotebookScreen.tsx` — the real send/scope/upload/citation/retry/stop/streaming owner (`sendQuestion → askNotebook`). GUARDED legacy, reused as a seam — **not edited** (staying exception-free).
- `mira-mobile/src/api/client.ts` — cookie jar + native HTTP transport.

### REUSE — behavior stays, presentation trimmed (this slice)
- `packages/factorylm-ui/src/Sidebar.tsx` — data (projects/machines/recent) reused; render re-ordered to ChatGPT hierarchy.
- `mira-mobile/src/screens/UnifiedRoot.tsx` / `UnifiedChat.tsx` — canonical hosts; only home-screen suggestion wiring trimmed.
- `packages/factorylm-ui/src/ProjectTree.tsx` — machine links now the only machine surface (Machines section removed).

### REPLACE — presentation did not meet ChatGPT target (this slice)
- `Composer.tsx` — removed disabled Voice stub and the machine-picker chip; row is now `+ / input / send`. Scan stays in the attachment menu; machine context moved to the bar.
- `Conversation.tsx` (`ConversationBar`) — removed always-on Ask/Work toggle and the status chip; now one quiet context line (project / folder / machine), rendered only when context exists.
- `assistant/AssistantThread.tsx` (`FirstRun`) — greeting alone by default; grounding line only when the host supplies one; no default grounding claim.

### DELETE / RETIRE — parallel/legacy, after cutover (NOT this slice)
- `mira-mobile/src/screens/V6Root.tsx`, `mira-mobile/src/v6/**`, the `"v6"` arm of `ChatUiChoice` — PR-branch-only on #3751, absent from `origin/main`. Retirement = "don't carry forward on this branch," not a guarded main deletion.
- The `ChatUiChoice` switch (`lib/chat-ui-pref.ts`) + surface arms in `App.tsx` (`v2`/`legacy`/`unified`) + `MoreTab` `onChatUiChange` — collapse to unconditional unified mount at cutover.
- Legacy five-tab shell (`NotebooksTab`/`AssetsTab`/`MoreTab`) — rollback path, retired last.

### §12 required answers
1. **Behavior the new UI needs** — all canonical: send/stream (`NotebookScreen`→`askNotebook`), thread identity (hub migration 087), Projects/threads (#3741 `UnifiedRoot` threads/`startNewThread`/`homeVisible`), general mode (#3745 `mode:"general"` when scope empty), attachments/camera (#3746 adapter), citations (`SourceViewer`/`PartRenderer`).
2. **What diverged from ChatGPT** — voice stub + machine picker in the composer row; always-on Ask/Work toggle + status chip above every turn; a top-level Machines section competing with Projects; a default grounding paragraph + suggestion chips on the home screen. All addressed.
3. **V6Root ideas worth keeping** — only the *concept* "new chat with no machine," already delivered canonically by #3741 (home/threads) + #3745 (general mode). No code salvage.
4. **Minimum new component tree** — none. The target boundary (`FactoryLMShell` → Sidebar/Conversation/Composer/EvidenceView) already exists in `packages/factorylm-ui`; the slice edits presentation inside it, adds nothing.
5. **How presentation consumes behavior without duplicating logic** — UI renders `ShellState` and invokes `HostHooks`/`PlatformAdapter`; `UnifiedChat` bridges `NotebookScreen`'s real send path into those hooks. No domain logic in the UI.
6. **The boundary interfaces** — `@factorylm/interaction` types + reducer (state), `HostHooks` (send/stop/retry/citation), `PlatformAdapter` (device I/O). These are the presentation↔product seam.
7. **Retirement path** — (1) prove golden flow [done]; (2) prove Projects/attachments/citations/camera incrementally; (3) parity vs legacy; (4) make unified the build default; (5) remove `ChatUiChoice` switch; (6) drop `V6Root.tsx`+`v6/**`+`"v6"` arm (branch-only, clean); (7) retire UnifiedRoot legacy presentation remnants; (8) retire five-tab shell. **Preserve** compat commit `94bf74ea0` (dogfood-V7-3751 worktree) — do not delete.
8. **Blockers to a thin presentation-only slice** — one, below (lifecycle guard gap).

---

## B. Golden UI slice — evidence (brief §22–25)

### Current state
The canonical stack (#3746 tip) already wires the full golden flow end-to-end; the shell's presentation diverged from ChatGPT. This slice trims presentation only.

### What changed
`feat(ui) 4a94250ac` — 10 files, +80 / −154. Composer (voice/machine removed), ConversationBar (mode toggle/chip removed → one context line), Sidebar (ChatGPT order, Machines section removed), FirstRun (greeting-first). Tests updated to the new contract. **No** change to reducer, HostHooks, PlatformAdapter, `NotebookScreen`, send path, or thread model.
`docs(ui) 9401e42ed` — 7 golden-flow screenshots.

### Technical evidence
```
Typecheck (mobile): PASS   npx tsc --noEmit → exit 0
Build (mobile):     PASS   npx vite build → built in 1.22s
Tests (mobile):     662/663 — 1 PRE-EXISTING failure at base
                    (src/unified/__tests__/to-interaction.test.ts: stale composite
                     thread-id assertion 'notebook-nb-1' vs 'notebook-nb-1:thread-legacy')
Tests (shared UI):  210/210 — my run. Baseline at base = 211.
                    NET −1: deliberately deleted "opens navigation to change the machine
                    when the surface cannot scan" (the composer machine-picker it asserted
                    is gone). No regressions; the other 4 changed suites re-pass on the new contract.
Toolchain note:     shared-UI suite requires bun 1.4.0 (workspace-pinned). bun 1.3.11
                    mis-resolves assistant-cloud 0.1.43 (missing deriveRunOutcome export)
                    → 14 spurious import errors. Not a code issue.
```

### Visual evidence (against LIVE backend app.factorylm.com, real authenticated session)
Golden flow proven: New Chat → typed "What is a VFD… deceleration setting during aggressive braking?" → **real streamed MIRA answer** (markdown, headers, lists) → opened sidebar (thread in Projects) → navigated away to Harrington Hoists thread (28 real turns) → reopened UT ACCEPTANCE thread → **question + answer restored intact**.
Frames in `docs/promo-screenshots/2026-09-12_chatgpt-ui-*.png` (also `~/mira-dogfood/v7-chatgpt-ui-3751/`):
new-chat · conversation · multiline-composer · sidebar(Projects+threads) · reopened-thread · keyboard-safe-composer (mobile 412×915) · shell+citation (desktop 1440×900, ui-lab fixture — has lab chrome, not real-auth).

### Disclosure
Authenticated as `mike@cranesync.com` (his own product) to satisfy the real-backend evidence requirement. The VFD Q/A persisted a thread in his live workspace under the "UT ACCEPTANCE 2026-08-24" notebook — deletable if unwanted.

---

## C. What remains blocked
1. **Lifecycle-guard gap (merge-gate blocker).** `tools/ui_surface_lifecycle_guard.py --base f8913760b --head HEAD` FAILS on `mira-mobile/src/screens/__tests__/unified-chat.test.tsx` (a one-line `.fl-chip` → `.fl-conversation__bar` assertion change forced by removing the chip). The charter (UNIFIED_UI_CUTOVER.md §"guarded paths") says *"docs, screenshot evidence, tests, and test-only configs/tooling stay open,"* but the guard's OPEN-test allowlist only lists `mira-mobile/scripts/__tests__/` and `mira-mobile/tests/` — **not** `mira-mobile/src/screens/__tests__/`. So this is a guard-vs-charter gap, not a genuine legacy-presentation violation. Do NOT self-fix the guard (trusted control plane).
2. **New-chat thread isolation — not yet proven.** Send from home surfaced a thread of **10 turns (5 Q/A pairs)**, not the ~2 a fresh isolated thread would show. Conversation-persists-and-reopens = PASS; but whether New Chat creates a *distinct* server thread (its own id) vs landing in the notebook's legacy thread is unverified. Reopen was via the project row, not the specific new-chat thread row.

## D. Decision needed (Mike)
1. Clear the guard for this lane: apply `legacy-ui-exception` to the PR, **or** authorize adding `mira-mobile/src/screens/__tests__/` to the guard's OPEN-test allowlist (a separate trusted-control-plane change). Either unblocks the exact-SHA review + push.
2. Push authorization for `9401e42ed` so the independent exact-SHA review can run (protocol §6; currently local-only).

## E. Best next action
Smallest next slice: verify new-chat thread isolation (send from a fresh New Chat, confirm a distinct server thread id with 2 turns via `getNotebookDetail`), then wire the reopen proof to the specific thread row. In parallel, get the guard decision (C1) so the slice can enter review.
