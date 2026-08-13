# Retrieval probe — first measurement, and it argues against the proposed fix

**Date:** 2026-08-09
**Tool:** `tests/regime1_telethon/campaign/retrieval_probe.py`
**Corpus:** staging Neon, embeddings via local Ollama `nomic-embed-text` (`embedded=True` on every probe below — so this is production-strength retrieval, not the weakened lexical-only fallback)

## Why this exists

`docs/superpowers/specs/2026-08-09-fabricated-parameter-grounding-hole.md` (#3165)
ends with a blocker: a grounding guard cannot be validated because **the campaign
ledger records replies but not the per-turn retrieved-source snapshot.** The same
wall stopped the #3156 lane diagnosis. This tool is that snapshot.

It calls the production entry point — `neon_recall.recall_knowledge`, the function
`rag_worker` calls — and reconstructs the query the way `rag_worker` does
(`f"{asset_identified} {message}"`), taking `asset_identified` from a `replay.py`
run because asset resolution is deterministic from the technician's own words.

## The true positive: #3165 reproduced as a measurement

`c7 / t2_005_pivot_after_fault`, turn 2 — the reply that asserted
`set P0594 = 1 [Source: Allen-Bradley PowerFlex 525, Parameter Reference]`:

```
turn 2  embedded=True  asset='Rockwell Automation, 525'  chunks=10
  query: Rockwell Automation, 525 How do I reset it?
  [0] Rockwell Automation  PowerFlex 52  manual  sim=0.781
  [1] Rockwell Automation  Bulletin 193  manual  sim=2.600
  [2] Rockwell Automation  Bulletin 140  manual  sim=0.770
  MISS P0594 — NOT in the 10 retrieved chunk(s)
```

Bulletin 193 and 140 are contactors and motor-protection devices. The fault-clear
procedure is not in the top 10, and the parameter MIRA asserted is in none of them.

## The false positives — and they kill the proposed fix

The spec's option A is "specific-claim grounding for parameter-shaped tokens."
Probed against the only other parameter tokens in the whole corpus of runs:

| run / conversation | turn | token | verdict | is the claim actually correct? |
|---|---|---|---|---|
| `c7` `t2_005_pivot_after_fault` | 2 | `P0594` | **MISS** | **No — fabricated.** True positive |
| `c1` `t1_002_fault_code_gs10` | 1 | `P09.03` | **MISS** | **Yes — correct.** False positive |
| `c1r3` `t2_000_pivot_after_fault` | 2 | `P09.03` | **MISS** | **Yes — correct.** False positive |
| `c1r3` `t2_000_pivot_after_fault` | 1 | `P09.03` | OK | correct, and supported |
| `c1r3` `t2_000_pivot_after_fault` | 2 | `P09.04` | OK | correct, and supported |

`P09.03` is `[COM1 Time-out Detection]` — the *right* parameter for a CE10 Modbus
timeout on a GS10, present in the corpus (14 rows). A retrieval-grounded guard
would have suppressed it twice.

**1 true positive, 2 false positives.** Compare the number that let CIT-006 ship:
1 TP, 0 FP across 671 replies.

### Why the false positives happen — the guard inherits the defect

Both FPs occur on queries the retrieval hole already ruins:

- `c1 t1_002` — `asset_identified` was **`None`**, so the query was the bare
  technician text (`"what's CE10 mean on my durapulse gs 10 drive???"`). Weaker
  context, weaker retrieval.
- `c1r3 t2_000` turn 2 — the query is `"AutomationDirect, GS10 How do I reset it?"`.
  That is **the exact polysemous-"reset" hole #3165 diagnosed**, on a different vendor.

So a retrieval-grounded guard is measured against a retrieval layer that is itself
broken: **wherever retrieval fails, the guard calls a correct answer a fabrication.**
It suppresses hardest precisely where MIRA is already weakest.

## Conclusion

**Do not build option A.** Grounding a claim on "was it in what we retrieved"
cannot be sound while retrieval misses the right chunk for the very question class
that triggers the guard.

Two things follow:

1. **CIT-006's corpus-wide existence check is the sounder signal**, and now we know
   *why*: it does not depend on retrieval working. `P09.03` exists in the corpus,
   so CIT-006 passes it in all three sightings; a retrieval-grounded check fails it
   in two. The weaker-looking signal is the more robust one.
2. **Fix retrieval first (the spec's option B — sense disambiguation for "reset").**
   It is upstream of #3165, #3156 and #3160, all three of which the 5-seed run
   showed collapse into the same root cause.

## Reading the output honestly

- The probe reads the corpus **as it is today**, not as it was during the run.
- `embedded` must be `true` for a result to be production-comparable. When Ollama is
  unreachable, `recall_knowledge` drops the vector and product-rerank streams, more
  claims look unsupported, and the FP count inflates. Every record carries the flag;
  a mixed set is not comparable.
- Sample size is 5 token-sightings. That is the entire population of parameter claims
  in 22 ledgers — small because MIRA rarely asserts parameters, not because the sample
  was truncated.
