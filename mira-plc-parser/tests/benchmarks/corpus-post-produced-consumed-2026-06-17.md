# Corpus Benchmark — Post-Produced/Consumed — 2026-06-17

**Parser version:** 3.27.8  
**Corpus:** 422 L5X files (JeremyMedders/LogixLibraries + reh3376/acd-l5x-tool-lib + 3 local)

## Results

| Status | Count |
|---|---|
| **FULL** | **419** |
| PARTIAL | 1 |
| MINIMAL | 0 |
| UNSUPPORTED | 1 |
| ERROR | 1 |
| **TOTAL** | **422** |

## What changed in this run

- **Produced/Consumed tag parsing**: Added `tag_type: str = ""` field to the
  `Tag` IR. `_parse_tag()` now captures `@TagType` (Base/Alias/Produced/Consumed).
  `analyze()` counts `produced_consumed`. Coverage gap check fires only when
  Produced/Consumed tags are present but `ext.produced_consumed == 0`.

- Result: the 10 files with `Produced/Consumed tags` gaps are now FULL (they
  were already extracting the tags — just without the type annotation).

- **6 new tests** in `tests/test_produced_consumed.py` (85/85 total passing).

## Remaining non-FULL files

| Status | File | Reason |
|---|---|---|
| PARTIAL | Cooker_1_AutoLogic_Program.L5X | 1 SFC routine (SFCContent) — not yet parsed |
| UNSUPPORTED | Par_Cast_AOI.L5X | Rockwell ForceProtectedEncoding — encrypted, undecodable |
| ERROR | PLC100_Mashing_Detailed.L5X | File encoding error (binary/non-UTF-8) |

## Session trajectory

| Milestone | FULL | Change |
|---|---|---|
| Baseline (28-file corpus) | 6 | — |
| Post-AOI Phase 1.1 (422 files) | 299 | +293 |
| Post-Module Phase 1.3 | 384 | +85 |
| Post-FBD Phase 1.2 + formula fix | 409 | +25 |
| Post-Produced/Consumed tag_type | **419** | **+10** |
