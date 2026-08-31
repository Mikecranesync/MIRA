# FLEET-001 Handoff — Safety-frame persistence gap

## Objective
Persist the safety hard-stop marker server-side so a reloaded turn is
distinguishable from a normal `answered` turn. A LOTO/arc-flash refusal was
previously persisted with `evidence: []`; on reload the safety identity was
lost and the warning rendered as a plain assistant answer.

## Commit
`995d3d5f0` on branch `fleet/chatui-slice-01` (do not push — Charlie reviews).

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
- Appended new tests using `require()` — ESM environment rejects CJS require. Switched to top-level `import { splitEvidence }` (already in scope via the file's existing imports).

## Test Results
```
 ✓ src/components/equipment/notebook-chat-utils.test.ts (35 tests)
 ✓ src/app/api/equipment-notebooks/__tests__/chat-safety-stop.test.ts (8 tests)

 Test Files  2 passed (2)
 Tests  43 passed (43)
```
All 43 tests green. 8 safety-stop tests + 4 new round-trip tests.

## Blockers
None. The change is self-contained.

## Next Action
Charlie independently reviews this commit (SHA `995d3d5f0`). The client-side
rendering of `safetyNotice` on reload (showing the safety warning UI badge on a
reloaded turn) is NOT in this slice — that is the consumer work for the PR that
owns mira-mobile / Hub chat UI, per ADR-0038 item 3. This slice closes the
server-side persistence gap only.
