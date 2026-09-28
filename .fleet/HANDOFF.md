# FLEET-002 Handoff — Safety notice rendering in NotebookChat

**Task ID:** FLEET-002
**Branch:** fleet/chatui-safety-render-02
**Worktree:** ~/Mira-worktrees/fleet-run-02
**Commit:** e08ad8593
**Base (FLEET-001):** d4abb7a0b

---

## Behaviour implemented

A safety hard-stop turn (LOTO, arc-flash, etc.) now renders as a distinct red banner in the web notebook chat on both the live and reloaded paths:

- Red #FEF2F2 background, #991B1B text, AlertTriangle icon, role="alert", data-testid="safety-notice-banner"
- Ordinary-answer affordances suppressed: no citation chips, no basis caption, no follow-up chips
- Live path: readNotebookStream now handles the `safety` SSE frame and sets StreamResult.safetyNotice; the post() callback spreads it onto the turn
- Reloaded path: persistedTurns already set HydratedTurn.safetyNotice (FLEET-001); ChatTurn now carries the field and Bubble reads it on hydration
- Backward compat: old turns with no safetyNotice are unaffected — the field is optional

## Files changed

- mira-hub/src/components/equipment/notebook-chat-utils.ts: StreamResult + safetyNotice field; readNotebookStream handles safety frame
- mira-hub/src/components/equipment/NotebookChat.tsx: ChatTurn.safetyNotice; AlertTriangle import; safety banner in Bubble; gates on followups/basis/passages
- mira-hub/src/components/equipment/notebook-chat-utils.test.ts: 2 new tests (stream picks up safety frame; absent yields null)
- mira-hub/src/components/equipment/NotebookChat.test.tsx: 6 new tests (banner renders; followups suppressed; basis suppressed; citations suppressed; reloaded turn renders banner; normal turn has no banner)

## Test results (REAL output)

  Test Files  21 passed (21)
       Tests  331 passed (331)
    Duration  ~1.0s

All 331 pass. 8 new tests added. No regressions.

## Type-check results

  npx tsc --noEmit -p tsconfig.json  =>  32 errors

32 errors = the pre-existing baseline. Zero new errors from this branch.
Pre-existing errors: src/app/api/mira/ask/__tests__/route.test.ts (6x PoolClient mock),
src/lib/__tests__/drive-pack-suggestion.test.ts (1x NormalizedProcedure),
tests/e2e/upload-probe.spec.ts (3x cookies/any). None in touched files.

## Surfaces investigated

- NotebookChat.tsx + notebook-chat-utils.ts (web): IN SCOPE — implemented
- AssetChat.tsx: uses a different dialect (isSafetyStop boolean set by server, not SSE frames); already renders safety with AlertTriangle; no change needed
- NodeChat: different untyped dialect; does not receive safety frames from the notebook route; out of scope
- mira-mobile NotebookScreen.tsx + sse.ts (legacy): no safety frame handler on either live or persisted path — OUT OF SCOPE for this branch; mobile safety rendering belongs in HELD PR #3516 (ChatV2)

## Known limitations / next action

- **Mobile safety rendering: OPEN GAP — deferred to PR #3516 (HELD).** mira-mobile ChatV2 has no safety frame handler and no `safetyNotice` rendering on either the live or reloaded path. This is a confirmed scope boundary from the Charlie independent review (CORRECTIONS-002.md §IMPORTANT #2). PR #3516 is currently HELD and may sit unresolved indefinitely — Mike's attention is needed as an epic-level item.
- historyFromTurns: safety turns are status="answered" so they ARE included in model history. The server guardrail fires again if the tech re-triggers, but this may warrant a deliberate historyFromTurns exclusion. Not changed here — note for reviewer.
- No device proof performed (no Pixel attached to this run).

## Corrections applied (CORRECTIONS-002.md — Charlie independent review)

**IMPORTANT #1 applied (commit after e08ad8593):**

Charlie found that the machine-replay card and visual-observation card were rendered unconditionally — without `!turn.safetyNotice` — unlike the citation chips, basis caption, and follow-up chips which were already gated. Unreachable in production today (a safety stop short-circuits retrieval, so those arrays are empty), but a cheap, high-value hardening given the `Bubble` component is likely to be copied to other surfaces.

Fix: added `!turn.safetyNotice &&` guard to both card rendering conditions in `NotebookChat.tsx`. Added one test (`Bubble — safety hard-stop`) asserting that a safety turn with hypothetically non-empty `machineEvidence` and `visualEvidence` renders neither card.

Test results after correction:
```
Test Files  21 passed (21)
     Tests  332 passed (332)   ← +1 from the new test
  Duration  ~1.8s
```
tsc --noEmit: 32 errors (unchanged baseline); zero new; grep for NotebookChat|notebook-chat-utils is empty.

**IMPORTANT #2: NOT touched in code.** Mobile safety rendering remains an OPEN GAP, deferred to PR #3516 (HELD). See "Known limitations" above.

## Do NOT self-approve. Charlie reviews independently.
