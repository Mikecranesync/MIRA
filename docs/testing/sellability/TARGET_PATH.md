# Sellability investigation — Target Path, evidence, and readiness verdict

**Date:** 2026-08-19 · **Branch:** `investigate/sellability-retrieval` · **Base:** `5dfcbb894`
**Environment:** staging only. No deploy, no writes, no production traffic.

---

## Target Path

### Primary bottleneck

`_extract_fault_codes` refused to recognise a fault code in natural technician
phrasing, so the only deterministic authoritative answer path — the structured
`fault_codes` lookup — never fired, and fault questions fell through to prose
ranking.

### Evidence

The `fault_codes` table already holds the answers:

```
('F004','PowerFlex 525','Allen-Bradley','Undervoltage')
('F013','PowerFlex 525','Allen-Bradley','Ground Fault')
```

Raw production `recall_knowledge`, real embedding, staging corpus:

| query | extracted | rank 1 |
|---|---|---|
| "PowerFlex 525 **showing** F004…" | `['F004']` | `['structured_fault']` ✅ |
| "**Got an** F013 on a PowerFlex 525…" | `[]` | parts-catalog prose ❌ |

The gate required a fault-context word (`fault|error|…|showing|display`) within 3
tokens. **7 of 10 realistic phrasings carry none.** Its docstring justified this
with "real technician messages carry context" — the 100-question live probe
(`docs/testing/probe-100/`) measured the opposite.

Downstream, this is what produced the 8/100 citation rate: with no structured
row, the PowerFlex 520-series **spare-parts catalog** (front covers, finger
guards, EMC cores) outranks the fault table, MIRA correctly refuses to answer a
fault question from finger-guard rows, and the technician is told the
documentation does not exist — for a fault whose row is in the corpus.

### What is working and must not be disturbed

Measured, and all of it held through the change:

- **Grounding / refusal.** MIRA refusing to answer from parts-catalog rows was
  *correct behaviour*. The defect was upstream. Citation enforcement untouched.
- **Safety.** 9/9 hazard cases caught in the live probe; canned STOP fails closed.
- **Refusal precision.** 7/7 must-refuse cases still refuse after the fix — the
  change adds recall without buying it with false authority.
- **Right-vendor evidence.** 10/10 both before and after.

### Smallest fix with highest expected product impact

Let a recognised **product name** anywhere in the query license fault-code
extraction, in addition to the existing context-word proximity rule. A product
name is a *stronger* disambiguator than a context word — "F013" beside
"PowerFlex 525" is unambiguous in a way "F013" beside "drive" is not. No shape
rule is relaxed, so `BAY-12`, `RE-DO`, `525` and `Micro820` stay rejected. One
function, ~15 lines.

### What we explicitly will NOT fix yet

- **No new retrieval lane.** #3183 (`manual_nav`) already implements hierarchical
  doc→section→passage retrieval, additive and uncalled. Building another would
  duplicate it. If section-level ranking is still needed after this fix, that PR
  is the vehicle.
- **No RRF / ranking rewrite.** The ranking was a symptom. #3176 is also open on
  `neon_recall.py`.
- **No ontology work.** The identifier fix costs 15 lines; formalising fault-code
  semantics as types would be the more complex way to reach the same place.
- **No embedder provisioning for `stg`.** Real, but separate (below).
- **No `staging_questions.yaml` edit.** That moves the baseline and hides the defect.

### Success metric

Fault-family evidence reaches the prompt, without buying recall with false
authority: **fault ≥90%**, **refuse = 100%**, repeatability **≥95%**.

---

## Result — 25-case sellability benchmark, 3 repeats

Deterministic, at the retrieval layer, via production `recall_knowledge`.
**Not** a chat benchmark: the fix is not deployed to the staging bot, so a live
Telegram re-run would measure `main` and prove nothing about it.

| family | n | before (clean `main`) | after |
|---|---|---|---|
| **fault** | 8 | **2 / 8 — 25%** | **8 / 8 — 100%** |
| evidence | 10 | 10 / 10 — 100% | 10 / 10 — 100% |
| refuse | 7 | 7 / 7 — 100% | 7 / 7 — 100% |
| **overall** | 25 | **19 / 25 — 76%** | **25 / 25 — 100%** |

Repeatability 25/25. Retrieval latency p50 1.49 s, max 2.65 s. Baseline was run
against the clean `main` checkout with `product_present` verified absent.

Every fault case reaches `structured_fault` **at rank 1** after the fix.

---

## Verdict: PILOT-ONLY

Not GO, and not NO-GO.

**Why not NO-GO.** The capability is real and now measurable: for a supported
asset, fault questions resolve to an authoritative cited row at rank 1, the right
manual reaches the top 5 for every documentation question tried, refusal
precision is perfect, and safety is 9/9. That is a product.

**Why not GO.** Three things a paying customer would hit that are not yet proven:

1. **The fix is not deployed or observed live.** Deterministic before/after is
   strong evidence, not the same as a measured live citation rate. The 8/100
   number should be re-measured on the deployed fix before any revenue promise.
2. **One asset family is proven.** Everything here is PowerFlex 525/520-series.
   The mechanism generalises (it is identifier-shape based, not code-specific),
   but generalisation is asserted, not measured.
3. **Two gate defects remain open** (#3335) — a conceptual question gets gated,
   and a supplied-but-unknown model is asked for again. Both are visible in the
   first five minutes of a demo.

### Per-surface readiness

| surface | readiness | basis |
|---|---|---|
| **One-machine Ask MIRA pilot** | **PILOT-ONLY** | 25/25 retrieval; needs deploy + live re-measure |
| Drive Commander | not assessed | out of scope this session |
| PLC Parser | not assessed | out of scope |
| PrintSense | not assessed | out of scope |
| Tag Mapper | not assessed | out of scope |
| "Ask any factory anything" | **NO-GO** | one asset family proven; breadth is the untested claim |

---

## Convergence triage (Phase 8)

| item | class | why |
|---|---|---|
| #3334 fault-code extraction | **SELLABILITY BLOCKER** | fixed in this branch |
| #3335 gate misfires | **SELLABILITY BLOCKER** | demo-visible; isolated, not fixed |
| Deploy + live re-measure of the 8/100 rate | **SELLABILITY BLOCKER** | the claim itself |
| `stg` has no embedder configured | **RELIABILITY BLOCKER** | staging silently measures a degraded path |
| #3331 ORDER BY tiebreaker | **RELIABILITY** | amplifier, cheap, no longer on the critical path |
| #3326 staging-gate variance | **DEFER** | a symptom of #3334; re-measure after deploy |
| #3183 manual_nav lane | **DEFER** | may be unnecessary now; decide after live re-measure |
| Broad architecture convergence | **DEFER** | nothing here required it |
| "Parts catalog outranks fault table" as a ranking defect | **SUPERSEDED** | symptom, not cause |

---

## Corrections to my own earlier findings

- The Python BM25 stream uses **OR-fanout `to_tsquery`**, not `plainto_tsquery`.
  The AND-semantics claim in `docs/testing/probe-100/FINDINGS.md` applies to the
  **Hub TS path** (`manual-rag.ts`), not the bot path.
- "Retrieval ranks the parts catalog above the fault table" (#3334 title) is the
  **symptom**. The cause is one extractor function.
- My earlier rank probe ran embedding-free and therefore measured a degraded
  branch. Every measurement in this document used a real 768-dim embedding.

## Known gaps in this work

- Two phrasings still miss: "F013 on the 525" and "We keep getting F004 on that
  PowerFlex" — bare model references. Fixing them means widening
  `_extract_product_names`, which also feeds `_product_search` and
  `_rerank_for_equipment`; deliberately out of the minimal change.
- The benchmark scores **retrieval**, not answer text. A chat-level benchmark is
  the right next step once the fix is deployed.
- 4 pre-existing failures in `test_recall_min_similarity_behavior.py`
  (`TestWorkerPassesTriageThreshold`) fail identically on clean `main`; not
  caused by, and not fixed by, this change.
