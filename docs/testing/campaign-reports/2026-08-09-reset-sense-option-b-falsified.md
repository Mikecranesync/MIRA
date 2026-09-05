# Option B ("retrieval sense disambiguation for reset") — falsified as a query rewrite

**Date:** 2026-08-09
**Method:** raw production `neon_recall.recall_knowledge` + direct corpus SQL against staging
Neon, embeddings via local Ollama `nomic-embed-text` (`embedded=True` on every probe).
Per `.claude/skills/retrieval-diagnostics`: production path, no harness.
**Bearing on:** #3165 (spec option B), #3156, #3160.

## Summary

Option B was specified as sense disambiguation for the polysemous word "reset" so the
fault-clear chunks stop losing to position / safety-hardware / defaults senses.
**Measured: no query-level disambiguation reaches them, because they are not
close-but-outranked — they are semantically far.** The measurement also splits the
"three issues, one root cause" claim: the PowerFlex 525 sighting and the GS10 sighting
have **different** root causes.

## 1. The target chunks are present, public and embedded

Verified in staging (`is_private = false`, `embedding IS NOT NULL`):

| page | content |
|---|---|
| PF525 p160 | "After corrective action has been taken, clear the fault by one of these methods…" |
| PF525 p160 | "1. Press Esc to acknowledge the fault…" |
| PF525 p164 | "Clear fault. • Press Stop if P045 [Stop Mode]… • Cycle drive power." |
| PF525 p160 | "A551 [Fault Clear] … Resets a fault and clears the fault queue" |

Not a coverage gap and not a NULL-embedding gap. Rules out actions 2/3 of the skill.

## 2. Query rewriting does not surface them — 7 variants, all fail

Top-10 from raw `recall_knowledge`, classified against the fault-clear PROCEDURE
(not merely the word "reset"):

| variant | GOOD in top-10 |
|---|---|
| probe baseline `"Rockwell Automation, 525 How do I reset it?"` | NONE |
| production query `"… PowerFlex 525 F004 How do I reset it?"` | NONE |
| `+ "clear the fault"` | NONE |
| `+ "clear the fault press stop cycle drive power"` | 1 — and it is a **PowerFlex 40** chunk |
| `+ full fault-clear vocabulary` | 1 — same PowerFlex 40 chunk |
| `reset` → `clear the fault` | NONE |
| `clear the fault` + procedure verbs | NONE |

> ⚠️ **A first pass reported 5/6 variants "fixed".** Its GOOD-marker matched
> `"…resetting fault F111 'Safety Hardware'"` — one of the wrong senses the spec
> explicitly names. Corrected before drawing any conclusion. The arc's rule held again:
> **every detector false-positived on first contact with real data.**

## 3. Why: the chunk is semantically FAR, not outranked

Cosine rank of the target rows among the 7,547 embedded PF525 rows:

| query | best target cos | rank within PF525 | rank in public corpus |
|---|---|---|---|
| production query | 0.58–0.62 | ~1,500–2,200 | 7,000–12,000 |
| best expansion | 0.7058 | 192 | 726 |
| best expansion (top target) | 0.7174 | 119 | 467 |
| **verbatim quote of the chunk itself** | **0.7367** | **5** | **16** |

**A query that literally quotes the chunk only reaches rank 5.** No realistic rewrite
closes a 119-rank gap when the ceiling is rank 5. Note also that the production
queries score **below the 0.70 `MIRA_MIN_SIMILARITY` floor**, so the vector stream
discards them before ranking even matters.

## 4. Lexical streams fail too, and model-scoping does not rescue them

`_recall_bm25` is an OR-fanout scored by `ts_rank_cd`, which rewards token
**repetition**. Fault-history tables ("[Fault 1 Current]… [Fault 2 Current]…") repeat
"fault" far more than the procedure text does, so they win.

| BM25 variant | GOOD in top-10 |
|---|---|
| production query, unscoped (today's behaviour) | NONE |
| production query, scoped `model_number ILIKE '%525%'` | NONE |
| sense-expanded, unscoped | NONE |
| sense-expanded **and** model-scoped | NONE |

Scoping to the resolved model — the obvious next lever — changes nothing.

## 5. What DOES reach them: high-specificity phrase anchors

Only phrase-level lexical match finds the procedure. Loose phrases are useless
(`"clear fault"` matches 227 Rockwell rows, mostly parameter tables), but the
low-frequency **procedural** phrasings are precise:

| phrase | rows in public corpus |
|---|---|
| `clear the fault by one of these methods` | 17 |
| `clears the fault queue` | 18 |
| `to reset the fault` | 6 |
| `resetting a fault` | 4 |
| `acknowledge the fault` | 29 |
| `cycle drive power` | 42 |

Model-scoped over that set: **PF525 → 10 distinct rows, 8 of them the actual
procedure** (2 marginal: a PM-motor-config appendix and a USB-utility page, both via
`cycle drive power`). PowerFlex 70 → 7/7 correct. PowerFlex 4M → 2/2 correct.

## 6. The PF525 and GS10 sightings are NOT the same defect

The 5-seed run concluded #3156 + #3160 + #3165 collapse into one root cause. At the
retrieval layer that is **half right**:

| | PowerFlex 525 | AutomationDirect GS10 |
|---|---|---|
| rows for the model | 7,547 | **11** |
| manufacturer rows | — | 4,295 (`model_number` mostly blank) |
| fault-clear procedure phrases | 113 | **0** |
| diagnosis | procedure present, **unreachable** | procedure **absent from the corpus**; model tagging broken |

`"AutomationDirect, GS10 How do I reset it?"` cannot be fixed by any retrieval change —
there is no GS10 fault-clear procedure in the corpus to retrieve, and 4,295 of the
4,306 AutomationDirect rows are not tagged with a model at all. That is an **ingest /
tagging** problem, and it should be tracked separately from #3165.

## 7. Conclusion

- **Do not build Option B as a query rewrite / sense expansion.** Falsified above;
  the ceiling for a verbatim query is rank 5, and realistic queries sit at rank 119+
  and below the cosine floor.
- **Do not build Option A** either — already falsified at 1 TP / 2 FP
  (`2026-08-09-retrieval-probe-first-measurement.md`).
- The only mechanism the evidence supports is a **deterministic phrase-anchored
  fault-clear lookup**, scoped to the resolved model, injected the way the existing
  `structured_fault` stream already is. That is what this branch implements next.
- **File the GS10 corpus/tagging gap separately** — it is not a retrieval defect.

## 8. What shipped instead — RET-001, the fault-clear procedure stream

`neon_recall._fault_clear_search` + `_wants_fault_clear`, injected above the fused
streams the way `structured_fault` already is. Strictly **additive**: at most
`MIRA_FAULT_CLEAR_LIMIT` (default 3) rows, never suppresses or reorders anything
else — which is why it can default on. Kill switch `MIRA_FAULT_CLEAR_STREAM=0`.

Arms only on the conjunction of (a) a reset/clear verb, (b) a fault actually in play
(a fault word, or a fault-code-shaped token after product names are stripped so
"GS10" can't pose as a code), and (c) **no competing reset object**. It reuses the
product names stage 3 already resolved rather than adding a second resolver.

### Live result, same query, stream OFF vs ON (staging, `embedded=True`)

| case | OFF (today) | ON |
|---|---|---|
| `"Rockwell Automation PowerFlex 525 F004 How do I reset it?"` | GOOD **NONE** | GOOD **[0, 1, 2]** |
| `"… PowerFlex 525 F004 how do I clear the fault"` | GOOD NONE | GOOD [0, 1, 2] |
| NEG `"… F004 what does it mean"` | — | stream did not fire |
| NEG `"… F004 how do I reset it to factory defaults"` | — | stream did not fire |
| NEG `"… how do I wire the safety relay"` | — | stream did not fire |
| `"AutomationDirect GS10 CE10 How do I reset it?"` | GOOD NONE | GOOD NONE — **expected**, §6 corpus gap |

Rows now returned for the #3165 query: PF525 p160 *"After corrective action has been
taken, clear the fault by one of these methods"*, p135 *"[Fault Clear] … Resets a
fault and clears the fault queue"*, and the *"Press Esc to acknowledge the fault"*
step. That is the content the P0 reply fabricated `P0594` in place of.

### Two defects found in this work's own tests, by mutation

Both failed in the optimistic direction, the same way everything else in this arc has:

1. **The model-scope test was vacuous.** It asserted the model string was in the
   params dict — which is built regardless — so deleting `AND model_number ILIKE …`
   from the SQL left all 28 tests green. The model scope is the precision guard that
   keeps a PowerFlex 40 chunk out of a 525 answer, i.e. the worst possible place for
   a toothless test. Now asserts the predicate is in the SQL.
2. **The fail-safe test was vacuous.** It asserted `out == []`, which
   `recall_knowledge`'s outer handler produces on *any* exception. Now asserts the
   other streams' rows survive a broken fault-clear stream.

Four mutations are recorded as having teeth: dropping the competing-object
suppression, dropping the model scope, never injecting, and removing the intent gate.

### Also caught live, not by a test

The first live run returned two near-copies of the *same* "Press Esc" step and never
returned the more useful "Clear fault • Press Stop • Cycle drive power" — the
`ORDER BY left(content, 200)` was alphabetical, so the row budget went to whatever
sorted first. Replaced with a phrase-specificity ranking (`prio`).

## Reproduce

```bash
cd /c/wt-qc
PYTHONIOENCODING=utf-8 doppler run -p factorylm -c stg -- py -3 <scratch>/diag_reset_sense2.py     # 7 query variants
PYTHONIOENCODING=utf-8 doppler run -p factorylm -c stg -- py -3 <scratch>/diag_cosine_gap.py       # cosine rank of the targets
PYTHONIOENCODING=utf-8 doppler run -p factorylm -c stg -- py -3 <scratch>/diag_scoped_bm25.py      # BM25 ± model scope
PYTHONIOENCODING=utf-8 doppler run -p factorylm -c stg -- py -3 <scratch>/diag_specific_phrases.py # phrase specificity
```
