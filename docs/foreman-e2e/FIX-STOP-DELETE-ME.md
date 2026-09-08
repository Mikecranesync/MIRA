# Foreman e2e fix→stop harness — DELETE ME

Intentional defect for spawn→fix→stop_worker proof (2026-09-08).

## Defect
E2E_STATUS=FIXED
E2E_BUG=none
FIXED_BY_SHA=4a971bb9419d857b8d8a5080d29d062532add60f

## Required fix (Claude)
1. Change `E2E_STATUS=BROKEN` to `E2E_STATUS=FIXED`
2. Change `E2E_BUG=missing_colon_after_label` to `E2E_BUG=none`
3. Append one line: `FIXED_BY_SHA=<40-char base SHA you started from>`
4. Touch no other paths. Push to this branch only. Do not merge.
