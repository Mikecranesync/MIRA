# ERRATA — RESULTS-rewrite-round.md (independent re-check, CHARLIE 2026-10-30, investigator-harness session)

Method: two independent recomputations from the raw rows (`.planning/2026-10-30-investigator-harness/verify/v1/TABLE.md`,
`verify/v2/FINDINGS.md`) + a fresh re-run of the production arm on clean origin/main 524106a06
(`.planning/2026-10-30-investigator-harness/baseline/`, ranked_pages byte-identical to the archived rows on all 7 sets).
**Verdict unchanged:** the pre-registered frozen arm fails regression; neither arm reaches the T-1 bar. 53/59 cells match exactly.

| # | RESULTS says | Correct | Evidence |
|---|---|---|---|
| 1 | oem-index (clean 116) off = 86 | **87** (the shipped #4979 code; 86 came from a pre-proof dev checkpoint `final3`) | baseline/oem-index-off-k10.jsonl; final4 + proof-cand agree |
| 2 | "would need ~35/45" | **38/45** (Wilson LB 71.2%; 35/45 → LB 63.7%) | wilson() |
| 3 | regression "frozen" column for oem-fault / oem-index / robust | those rows ran with **0% rewrite coverage** = the vector-lane ablation, not hybrid+rewrite. True frozen-with-rewrites: oem-fault 129/174, oem-index 70/116 | posthoc/oem-*-frozen-with-rewrites-k10.jsonl; cache arithmetic 185+336=521 |
| 4 | robust "running at write time" | ablation-equivalent arm **928/1264 vs off 979 (−51)**; finished 9 min after RESULTS was saved; never published | t1-scratch-snapshot/heldout/robust-frozen-k10.jsonl |
| 5 | oem-index lost ids "pf4m ×5" | pf4m ×7 (aggregate +5/−21 correct) | verify/v1 |
| 6 | rewrite-only pooled LB "23%" | 23.2% (rounding) | — |
| 7 | rewrite/sha256.txt covers rewrites.json | stale: cache grew 330→521 after the manifest was written | sha256 mismatch |
| 8 | (process) | oem-*/robust frozen rows, all post-hoc rows and run_posthoc.sh lived only in an ephemeral scratchpad; now preserved in `.planning/2026-10-30-investigator-harness/t1-scratch-snapshot/` | — |
| 9 | (provenance) | rewrite arms ran on 524106a06 + uncommitted 2-file diff sha256 85400e9c…; production retrieval code identical 1f2ef9695 → 524106a06 | provenance/t1-rewrite-tree.txt |
| 10 | cost "~$0.0004/question" | this round's measured bench rate ≈ $0.00027/question | rewrites.json spent_usd / entries |
