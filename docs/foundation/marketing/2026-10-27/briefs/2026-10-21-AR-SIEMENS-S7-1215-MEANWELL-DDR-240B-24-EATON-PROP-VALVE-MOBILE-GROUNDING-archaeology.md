# AR-2026-10-21 SIEMENS S7-1215 / MEANWELL DDR-240B-24 / EATON KBSDG4V: mobile grounding archaeology
MIRA main tip: d1d1511de47822f6badd722af0a9b3943b7873f0 (shallow fetch, 2026-10-21). Read-only. Answer not researched, and MIRA was not called.

## Verdict: CONSOLIDATE (primary, standing hold) + CONNECT (manuals)
## Gate: BLOCKED

## Technician need
Grounding and potential-equalization design for a 24 V mobile retrofit with a negative-to-chassis battery. Questions: whether to bond the DDR-240 -Vo, how to handle valve 0 V, PE and PLC 0 V, shield ground loops, and the EMC risk of a floating output. This is a design question, not an active fault.

## Current product path (SUT lock)
mira-mobile/src/api/resources.ts askNotebook -> mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts -> mira-hub/src/lib/manual-rag.ts retrieveNodeChunks -> citation SSE.
With no manual attached, route.ts uses GENERAL_SYSTEM_PROMPT (line ~325): the answer comes from general knowledge, is labelled "not this machine's manual", carries no citations, and is not allowed to decode part numbers. A general answer is possible today, but a grounded, cited one is not.

## Per-manual corpus table
| Manual | Status | Evidence |
|---|---|---|
| Siemens S7-1200 system manual (EMC/grounding chapter) | ABSENT | Mentioned only in mira-scan-monday/backend/known_equipment.py:139-143 (asset alias incl. "1215c") and machine-print-pack examples. Not in mira-crawler/sources.yaml or tools/seeds. 4th Siemens freeze. |
| Siemens KTP400 Basic | PARTIAL (model token only) | manual-rag.ts:290 maps `6AV2123-2DB03 -> KTP400`. No document is ingested. sources.yaml:229-231 has only the TP700/900/1200 Comfort operating instructions. #4141 seed binds only TP1200 Comfort. |
| MEAN WELL DDR-240 | ABSENT | Only a meanwell.com domain hint in mira-scan-monday/backend/manual_search.py:114 (outside the SUT) and the cv-101 print-pack example. "DDR-240" has 0 hits. |
| Eaton/Vickers KBSDG4V | ABSENT | 0 code or seed hits. The only "Vickers" hit is docs/playbooks/linkedin-group-reactivation.md, which is unrelated. |
| SICK absolute encoder | ABSENT | No SICK manual source. The mira-crawler/manual_scrape_targets.csv hit is "McKissick", a false positive. Other hits are tests and blog text. |

## What already exists
- The general-knowledge lane in route.ts, with honesty guards (lines 325-337).
- The Hub safety guard in mira-hub/src/capabilities/answer-safety-check.ts. Its electrical hazard regex (line 174) covers voltage, LOTO, breaker, disconnect and shock, but not ground, bond, PE, equipotential or EMC. The LLM judge (line 239) covers hazardous energy and actions. Design advice on bonding would probably be judged "safe" or "educational" (UNVERIFIED, not executed).
- answer-validation.ts has energized-electrical and LOTO patterns, but no grounding or bonding category.
- PRs #4471, #4485 and #4509 are UNVERIFIED. This pass searched main only; their PR diffs were not opened. On main, no grounding classifier exists.
- The answer_radar/ harness has runs up to staging-2026-09-29-ae03a3877. No run covers this freeze.

## Duplication
mira-scan-monday/backend/manual_search.py and known_equipment.py are a parallel, non-SUT manual and equipment registry. Do not wire them in, and do not count them as the corpus.

## Keep
manual-rag.ts model tokens (KTP400), the mira-crawler/sources.yaml + tools/seeds/*.sql ingestion path, answer-safety-check.ts, answer-validation.ts, and answer_radar/.

## Retire / avoid
mira-scan-monday manual_search as a corpus source. Excluded: pipeline, bots, ask_api, Open WebUI.

## Smallest step
Batch-CONNECT the Siemens set: the S7-1200 system manual (incl. EMC/grounding chapter) and the KTP400 Basic operating instructions, through sources.yaml + a seed in the #4141 style. Then add the MEAN WELL DDR-240 datasheet, the Eaton KBSDG4V catalog and the SICK encoder manual. Optionally, extend the safety-check vocabulary with grounding/bonding (BUILD, needs Foreman).

## Unblock criteria
1. S7-1200 system manual + KTP400 manual ingested and bound to a Siemens notebook node.
2. DDR-240 datasheet and KBSDG4V manual ingested (the SICK encoder manual is optional).
3. retrieveNodeChunks returns the EMC/grounding chunks for this question, and citation SSE shows them.
4. The standing CONSOLIDATE hold is lifted by Foreman/Mike.

## Proof to rerun
- `rg -il "S7-1200|KTP400|DDR-240|KBSDG4V" mira-crawler/sources.yaml tools/seeds/`
- the manual-rag-model-scope integration test
- an answer_radar Hub batch run on this freeze through the SUT
