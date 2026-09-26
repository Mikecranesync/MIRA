# Sellability investigation — STATE (2026-08-19)

Worktree: /Users/charlienode/mira-sellability  branch investigate/sellability-retrieval
Base: 5dfcbb894

## ROOT CAUSE FOUND (Phase 1-2 complete)

fault_codes table HAS the answers:
  ('F004','PowerFlex 525','Allen-Bradley','Undervoltage')
  ('F013','PowerFlex 525','Allen-Bradley','Ground Fault')

recall_knowledge stage 2 does a DETERMINISTIC structured lookup via
_extract_fault_codes() -> recall_fault_code(). When it fires, the answer is
rank 1 with stream ['structured_fault'].

DEFECT: _extract_fault_codes (neon_recall.py:286) requires a fault-context word
(fault|error|alarm|trip|code|warning|drive|vfd|inverter|showing|display|
flashing|reading) within _FAULT_PROXIMITY=3 tokens. Natural technician phrasing
has none, so the stage never fires and the query falls through to prose ranking
where the PARTS CATALOG outranks the fault table.

Measured: 7 of 10 realistic fault phrasings extract NOTHING. 5/5 false-positive
controls correctly stay empty.

  "PowerFlex 525 showing F004..."   -> ['F004'] -> structured_fault rank 1
  "Got an F013 on a PowerFlex 525"  -> []       -> parts catalog

## CORRECTION to my earlier FINDINGS.md
Python BM25 uses OR-fanout to_tsquery, NOT plainto_tsquery. The AND-semantics
claim applies to the Hub TS path (manual-rag.ts), not the bot path. The
"parts catalog outranks fault table" observation is a SYMPTOM of the extractor
miss, not the root cause.

## TARGET PATH
Let a code-shaped token co-occurring with a recognised PRODUCT NAME count as a
fault code, without requiring a context word. Smallest possible change; shape
rules unchanged so BAY-12/RE-DO/525/Micro820 still rejected.

## DO NOT
- build a new retrieval lane (#3183 manual_nav already exists, additive)
- touch neon_recall ranking (#3176 open on that file)
- loosen grounding/citation/safety
- edit staging_questions.yaml

## NEXT
- implement + regression tests
- Phase 5 gate defects (#3335)
- Phase 6 sellability benchmark
