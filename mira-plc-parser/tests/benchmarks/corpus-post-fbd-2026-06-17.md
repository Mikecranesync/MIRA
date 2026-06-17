# Corpus Benchmark — Post-FBD (Phase 1.2) — 2026-06-17

**Parser version:** 3.27.7  
**Corpus:** 422 L5X files (JeremyMedders/LogixLibraries + reh3376/acd-l5x-tool-lib + 3 local)

## Results

| Status | Count |
|---|---|
| **FULL** | **409** |
| PARTIAL | 11 |
| MINIMAL | 0 |
| UNSUPPORTED | 1 |
| ERROR | 1 |
| **TOTAL** | **422** |

## What changed in this run

- **Phase 1.2 — FBD routine parsing**: Each `<Sheet>` in `<FBDContent>` is now
  converted to a `Rung`-shaped record. `IRef.Operand` → `refs`, `ORef.Operand`
  → `outputs`, `Block.Type`/`Function.Type` → `instructions`, `Block.Operand`
  and nested `Array.Operand` → `refs`. The gap check now only fires when FBD
  sheets are present but `ext.fbd_sheets == 0`.

- **Coverage formula fix**: For `Program`/`Routine`/unknown exports, the
  denominator now uses only `ctrl_tags_target + prog_tags` — context AOI
  `parameters` and `local_tags` (which are supporting references, not the
  export's target content) are excluded. Previously 26 files showed MINIMAL
  (~5–18%) despite full extraction; all now score correctly.

- **18 new tests** in `tests/test_fbd_parsing.py` (79/79 total passing).

## PARTIAL files (all at 100% coverage)

All 11 PARTIAL files are legitimately extracted but carry known-gap features:

| Gap type | Files |
|---|---|
| Produced/Consumed tags — not classified | 10 |
| SFC routine (SFCContent) — silently skipped | 1 |

## Non-recoverable

| Status | File | Reason |
|---|---|---|
| UNSUPPORTED | Par_Cast_AOI.L5X | Rockwell ForceProtectedEncoding (`EncryptionConfig="9"`) — encrypted, undecodable |
| ERROR | PLC100_Mashing_Detailed.L5X | File encoding error (binary/non-UTF-8 content) |

## Session trajectory

| Milestone | Before | After | Delta |
|---|---|---|---|
| Baseline (28-file corpus) | 6 FULL, 14 UNSUPPORTED | — | — |
| Post-AOI Phase 1.1 (422 files) | — | 299 FULL, 86 UNSUPPORTED | +293 FULL |
| Post-Module Phase 1.3 | 299 FULL | 384 FULL | +85 FULL |
| Post-FBD Phase 1.2 + formula fix | 384 FULL, 26 MINIMAL | **409 FULL** | +25 FULL, -26 MINIMAL |
