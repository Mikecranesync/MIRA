# FLEET-002 Handoff — render the persisted safety-stop marker

## Objective
FLEET-001 (PR #3517, HELD) closed the server-side gap: a LOTO/arc-flash safety
hard-stop persists as `evidence: [{kind:"safety_notice", trigger}]` and
`persistedTurns()` already surfaces it as `HydratedTurn.safetyNotice`. Neither
the LIVE stream path nor the client component rendered anything distinct for
it. This slice adds the client-side render: one visually-distinct STOP badge,
sourced from the same `SafetyNoticeEntry` shape on both the live SSE path and
the reload/hydration path.

## Files changed
- `mira-hub/src/components/equipment/notebook-chat-utils.ts`
  - `StreamResult` gets `safetyNotice: SafetyNoticeEntry | null` (mirrors the
    `machineEvidence`/`visualEvidence` null-default pattern exactly).
  - `readNotebookStream()` initializes `safetyNotice: null` and adds
    `else if (frame.kind === "safety") out.safetyNotice = { kind: "safety_notice", trigger: frame.trigger }`.
    Shaped as a `SafetyNoticeEntry` so it satisfies `isSafetyNoticeEntry` and
    the same downstream consumer (`Bubble`) as the hydrated path.
- `mira-hub/src/components/equipment/NotebookChat.tsx`
  - Import `AlertTriangle` (lucide-react) and `SafetyNoticeEntry` (type-only).
  - `ChatTurn` gets `safetyNotice?: SafetyNoticeEntry` (doc-comment style
    matches `machineEvidence?`/`visualEvidence?`).
  - `post()`'s `postNotebookChat(...)` destructure now includes `safetyNotice`;
    the turn update sets `...(status === "answered" && safetyNotice ? { safetyNotice } : {})`,
    same conditional-spread pattern as `machineEvidence`/`visualEvidence`.
  - `Bubble()` gets a new render block for `turn.safetyNotice`, placed right
    after the `insufficient_evidence` caption and before the machine/visual
    evidence cards. Visually distinct from the muted evidence chips: red
    border/text/background using `var(--status-red)` / `var(--status-red-bg)`
    (FactoryLM UI-style fault/stop tokens — `.claude/rules/ui-style.md`), an
    `AlertTriangle` icon, `data-testid="safety-notice-badge"`, content
    `"Safety stop — {trigger}"`.
  - `persistedTurns()`'s `HydratedTurn.safetyNotice` flows into `ChatTurn` via
    the existing direct assignment in
    `mira-hub/src/app/(hub)/equipment/[id]/page.tsx` (`setInitialTurns(persistedTurns(data.turns ?? []))`)
    — that IS the "mapping" the task spec pointed at. No second field, no
    edit needed there: `HydratedTurn` already had `safetyNotice` from
    FLEET-001; `ChatTurn` just needed to declare the same field so the
    structural assignment carries it through, and TypeScript now actually
    types it instead of silently dropping it as an unknown excess property.

## Decisions made
- **One producer per field, one render branch.** `readNotebookStream` and
  `persistedTurns` both produce a bare `SafetyNoticeEntry | undefined/null` on
  the turn; `Bubble` reads `turn.safetyNotice` once. No second component, no
  parallel type.
- **Gated on `status === "answered"`** in the live-path turn update, matching
  the doc comment on `NotebookSafetyFrame` in `notebook-chat-types.ts`
  ("The turn still reports `status: 'answered'`") and matching how
  `machineEvidence`/`visualEvidence` are gated — consistent, not new
  behavior.
- **Badge placement**: after `insufficient_evidence`, before machine/visual
  evidence — a safety escalation reads before "what grounded this answer".
- **Never a citation**: `SafetyNoticeEntry` has no `docId`; the render block
  is not inside the citations/`passages` rendering, and `splitEvidence`
  (already shipped in FLEET-001) already excludes it from `citations`.
- **No layout shift when absent**: `{turn.safetyNotice && (...)}` — same
  pattern as every other conditional block in `Bubble`; no wrapper renders
  when the field is unset.

## Failed approaches
None — the shape was fully pinned by FLEET-001's types (`SafetyNoticeEntry`,
`isSafetyNoticeEntry`, `HydratedTurn.safetyNotice`) and by the existing
`machineEvidence`/`visualEvidence` precedent in the same file, so this was a
straight mechanical extension of an established pattern. No dead ends.

## What was NOT touched (per task scope)
- `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts` — untouched.
- `mira-hub/src/app/labs/**`, `mira-mobile/` — untouched.
- `SAFETY_STOP` prose text, `answer_status` semantics — untouched.
- No migrations, no deploy, no merge, no push (local commit only, on
  `fleet/chatui-slice-02`).

## Tests run + results (real output)

### `bun run vitest run src/components/equipment/notebook-chat-utils.test.ts src/components/equipment/NotebookChat.test.tsx`

```
 RUN  v3.2.4 /Users/charlienode/MIRA-worktrees/fleet-001-review/.cao/worktrees/ae32acdb/mira-hub

 ✓ src/components/equipment/notebook-chat-utils.test.ts (37 tests) 8ms
 ✓ src/components/equipment/NotebookChat.test.tsx (24 tests) 33ms

 Test Files  2 passed (2)
      Tests  61 passed (61)
   Start at  09:13:55
   Duration  430ms (transform 72ms, setup 0ms, collect 217ms, tests 41ms, environment 0ms, prepare 65ms)
```

New tests added (all passing, part of the 61):
- `notebook-chat-utils.test.ts` → `describe("readNotebookStream — safety hard-stop frame (FLEET-002)")`:
  - a `safety` frame produces `StreamResult.safetyNotice`, never a citation
  - absent `safety` frame → `safetyNotice` stays `null`
- `NotebookChat.test.tsx` → `describe("Bubble — safety notice badge (FLEET-002)")`:
  - renders the STOP badge for a live-shaped turn (`safetyNotice` set directly)
  - renders the SAME badge for a hydrated-shaped turn (via `persistedTurns`)
  - no `safetyNotice` → no badge (byte-identical, no layout shift)

### `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "notebook-chat-utils.test|NotebookChat.test"`

```
(empty — grep exit code 1, no matches)
```

Verified this is a real "no errors in my touched test files" result, not a
suppressed-error illusion: ran full `tsc --noEmit -p tsconfig.json` (exit 2,
58 lines of pre-existing errors in unrelated files — `route.test.ts` files
under `api/assets`, `api/cmms/sso`, `api/equipment-notebooks/.../nameplate`,
`api/hub/status`, `api/mira/ask`, `lib/__tests__/drive-pack-suggestion.test.ts`,
`tests/e2e/upload-probe.spec.ts`). Confirmed these are baseline/pre-existing,
not introduced by this slice, by stashing my 4 changed files (`git stash push -u`
with a unique tag, applied by exact SHA, dropped by exact SHA after restoring
— never a bare `git stash pop`), re-running `tsc --noEmit -p tsconfig.json`
against the unmodified base branch, and diffing the two full outputs:
byte-identical (58 lines both times, `diff` printed nothing). My 4 touched
files (`notebook-chat-utils.ts`, `NotebookChat.tsx`, `notebook-chat-utils.test.ts`,
`NotebookChat.test.tsx`) introduce zero new tsc errors anywhere in the project.

## Current commit SHA
See `git log -1 --format=%H` on `fleet/chatui-slice-02` after this handoff is
committed — this file is committed together with the code change in the same
commit, so the SHA reported back to the supervisor via `send_message` is the
one to check out.

## Blockers
None.

## Next action
Charlie (independent reviewer) reviews this commit adversarially, same
process as FLEET-001. No self-approval. No push performed or requested by
this worker.
