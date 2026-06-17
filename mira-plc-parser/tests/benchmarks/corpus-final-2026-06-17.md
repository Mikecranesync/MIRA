# Corpus Benchmark — Final Session — 2026-06-17

**Parser version:** 3.27.9  
**Corpus:** 422 L5X files (JeremyMedders/LogixLibraries + reh3376/acd-l5x-tool-lib + 3 local)

## Results

| Status | Count |
|---|---|
| **FULL** | **420** |
| PARTIAL | 0 |
| MINIMAL | 0 |
| UNSUPPORTED | 1 |
| ERROR | 1 |
| **TOTAL** | **422** |

## What changed in this run (SFC parsing)

- **Phase 1.5 — SFC routine parsing**: Each `<Step>` in `<SFCContent>` is
  now converted to a Rung-shaped record. `Step.Operand` → `refs`,
  nested `Action.Operand` → `refs`. Gap check fires only when SFC steps
  exist but `ext.sfc_steps == 0`.

- `analyze()` now counts `sfc_steps`.

## Non-recoverable (both correct behavior)

| Status | File | Reason |
|---|---|---|
| UNSUPPORTED | Par_Cast_AOI.L5X | Rockwell ForceProtectedEncoding (`EncryptionConfig="9"`) — encrypted AOI body |
| ERROR | PLC100_Mashing_Detailed.L5X | Binary/non-UTF-8 encoding — likely a binary or corrupted export |

## Full session trajectory (starting from PR #2091 baseline)

| Milestone | FULL | Delta | Notes |
|---|---|---|---|
| Baseline (28-file corpus) | 6 | — | Starting state |
| Phase 1.1 — AOI parsing (422 files) | 299 | +293 | |
| Phase 1.3 — Module parsing | 384 | +85 | |
| Phase 1.2 — FBD routine parsing | 409 | +25 | |
| Coverage formula fix (context AOI inflation) | 409→409 | 0 FULL, -26 MINIMAL | Fixed 26 false MINIMAL |
| Produced/Consumed tag_type field | 419 | +10 | |
| Phase 1.5 — SFC routine parsing | **420** | **+1** | |
| **TOTAL** | **420 / 422 = 99.5%** | | 1 encrypted + 1 binary |

## 85 tests, 85 passing
