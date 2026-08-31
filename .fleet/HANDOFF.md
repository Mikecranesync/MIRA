# FLEET-001 Handoff — Safety-frame persistence gap

## Objective
Persist the safety hard-stop marker server-side so a reloaded turn is
distinguishable from a normal `answered` turn. A LOTO/arc-flash refusal was
previously persisted with `evidence: []`; on reload the safety identity was
lost and the warning rendered as a plain assistant answer.

## Commits (branch `fleet/chatui-slice-01`, do NOT push — Charlie reviews)
| SHA | Contents |
|-----|----------|
| `995d3d5f0` | Code change: SafetyNoticeEntry type + persistence + hydration + tests |
| `e0baa6e1e` | Adds `.fleet/TASK.md` + `.fleet/HANDOFF.md` |

**HEAD: `e0baa6e1e`**

## Files Changed
| File | Change |
|------|--------|
| `mira-hub/src/lib/notebook-chat-types.ts` | Added `SafetyNoticeEntry` type + `isSafetyNoticeEntry` guard (modelled after existing `isMachineEvidenceEntry`) |
| `mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts` | Both safety-stop branches now persist `[{kind:"safety_notice",trigger}]` in `evidence[]` instead of `[]`; imported `SafetyNoticeEntry` |
| `mira-hub/src/components/equipment/notebook-chat-utils.ts` | `splitEvidence` now extracts `safetyNotice`; `persistedTurns` surfaces it on the hydrated turn; `PersistedTurn.evidence` and `HydratedTurn` types updated |
| `mira-hub/src/app/api/equipment-notebooks/__tests__/chat-safety-stop.test.ts` | Updated existing persistence assertion (now expects evidence with entry) + 1 new trigger-match test |
| `mira-hub/src/components/equipment/notebook-chat-utils.test.ts` | 4 new round-trip tests + existing `splitEvidence` deep-equals updated for `safetyNotice: null` |

## Decisions Made
1. **No migration.** `evidence` is an existing `jsonb` column with no per-entry constraint (migration 073 defines the column only). A new entry kind is additive.
2. **`SafetyNoticeEntry` rides in `evidence[]`**, not a new column. Exact same pattern as `MachineEvidenceEntry` and `VisualObservationEntry` — discriminated by `kind`.
3. **`enrichCitationsWithOrigin` requires no change** — it already skips entries with no `docId`.
4. **`splitEvidence` returns `safetyNotice: SafetyNoticeEntry | null`** (at most one per turn). Existing callers that only destructure `citations`/`machineEvidence`/`visualEvidence` are unaffected.
5. **`HydratedTurn.safetyNotice`** is optional so non-safety turns carry no field (not `null`).

## Failed Approaches
- Appended new tests using `require()` — ESM environment rejects CJS require. Switched to top-level `import { splitEvidence }` (already in scope via the file's existing imports). Second vitest run (after stale transform cache cleared) showed all tests green.

## Test Results (verified 2026-08-31, vitest v3.2.4)
```
 ✓ src/components/equipment/notebook-chat-utils.test.ts (35 tests) 19ms
 ✓ src/app/api/equipment-notebooks/__tests__/chat-safety-stop.test.ts (8 tests) 7ms

 Test Files  2 passed (2)
      Tests  43 passed (43)
   Start at  08:06:52
   Duration  319ms
```

Key tests proving the round-trip:
- `safety_notice round-trip (FLEET-001) > splitEvidence extracts a safety_notice entry without treating it as a citation` ✓
- `safety_notice round-trip (FLEET-001) > persistedTurns restores safetyNotice on a reloaded safety turn` ✓
- `safety_notice round-trip (FLEET-001) > persistedTurns does NOT surface safetyNotice as a citation` ✓
- `safety_notice round-trip (FLEET-001) > a normal answered turn with no safety_notice has safetyNotice undefined` ✓
- `notebook chat safety hard-stop > persists the stop with a safety_notice entry so hydration can restore it` ✓
- `notebook chat safety hard-stop > safety_notice trigger matches the X-Safety-Stop header` ✓

## Corrections Applied (2026-08-31)

Charlie's independent review returned **PASS WITH KNOWN LIMITATION** on `e0baa6e1e`.
Two findings were raised and are now fixed:

### BLOCKING — 6 tsc errors in test files (no production code touched)
All 6 errors were in test files only:
1. Duplicate `splitEvidence` import at line ~453 — **deleted**; `PersistedTurn` added to the existing import block at line 266 instead.
2. Two `rows` literals with `kind` widened to `string` — **annotated** `const rows: PersistedTurn[] = [...]` on lines 466 and 485.
3. `domainMock.recordTurn.mock.calls[0]` possibly-undefined / out-of-range tuple — **cast** via `unknown` to `[string, string, Record<string, unknown>][]`.

**tsc output (mira-hub, filtered to the two files):**
```
$ cd mira-hub && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "notebook-chat-utils.test|chat-safety-stop.test" ; echo "exit-marker done"
exit-marker done
```
No errors for either file.

**vitest output:**
```
 ✓ src/components/equipment/notebook-chat-utils.test.ts (35 tests) 22ms
 ✓ src/app/api/equipment-notebooks/__tests__/chat-safety-stop.test.ts (8 tests) 15ms

 Test Files  2 passed (2)
      Tests  43 passed (43)
   Start at  08:25:15
   Duration  562ms
```

### IMPORTANT — commit message scope clarification
The original commit `e0baa6e1e` overstated the technician-visible effect.
**Scope clarification: this entire slice (995d3d5f0 + e0baa6e1e) is data-layer only — no visible client change yet. `safetyNotice` is now persisted and hydrated on the server side, but NotebookChat.tsx has no `safetyNotice` renderer and mobile sse.ts has no reader. Rendering lands in a later slice.**

## Blockers
None. The change is self-contained.

## Next Action
Charlie independently reviews the corrected branch. The client-side
rendering of `safetyNotice` on reload (showing the safety warning UI badge on a
reloaded turn) is NOT in this slice — that is the consumer work for the PR that
owns mira-mobile / Hub chat UI, per ADR-0038 item 3. This slice closes the
server-side persistence gap only.
