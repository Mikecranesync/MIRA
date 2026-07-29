# PrintSense variance rerun — post-#2701 causal confirmation + configuration decision table

**Date:** 2026-07-15 UTC = evening of **2026-07-14 America/New_York** (see Timestamps below)
**Stack under test (all on main):** #2698 `7c2ef472` · #2699 `0e55a5d5` · #2700 `afea72ae` ·
#2701 `83955481` · #2705 `8a9cdad7` · #2706 `416200ed` — VERSION 3.146.8.
**Run:** `printsense.benchmarks.variance_study`, 5 runs × {opus-xhigh, opus-high, opus-medium},
upright sheet-20, canonical rubric (type_text lane), one Batches job
`msgbatch_01KzkAF7p3KEJ2GUWX7bZEfG`. Standard-rate total $3.92 → **batch-billed ≈ $1.96**
(stg Doppler, operator-authorized rerun). Raw rows: `2026-07-15-variance-rerun-rows.json`
(run 1 for comparison: `2026-07-14-variance-run1-rows.json`).

## 0. Timestamps & provenance (timezone reconciliation)

All GitHub timestamps are **UTC**; the work happened the **evening of 2026-07-14
America/New_York (EDT, UTC−4)** and crossed midnight UTC — that is the whole cause of the
mixed 07-14/07-15 dates. Precisely:

- Ladder merges: 2026-07-15 **01:59:06Z → 02:16:50Z** = 2026-07-14 **21:59 → 22:17 EDT**
  (#2698 01:59:06Z · #2699 02:01:42Z · #2700 02:06:00Z · #2701 02:09:33Z · #2705 02:13:29Z ·
  #2706 02:16:50Z).
- Rerun batch `msgbatch_01KzkAF7p3KEJ2GUWX7bZEfG`: submitted ≈ 02:18Z, results collected
  **02:25Z = 22:25 EDT 2026-07-14** (row/graph file mtimes).
- Filename convention: this file and its rows JSON carry the **UTC** date (07-15); run 1's rows
  file carries the **local** date (07-14; it ran ≈ 20:04–20:30 EDT = 00:04–00:30Z on 07-15 UTC).
  One working session, one evening.

**Input identity:** `01_sheet20_upright.jpg`, 1,866,158 bytes, sha256 `1f5ced99ba4a60d5…`
(reproduce with `hashlib.sha256` over the gitignored eval-inputs copy).

**Rows-file caveat:** `2026-07-14-variance-run1-rows.json` was graded under the **pre-#2705
grader** (no type_text lane; device = 2 tags @ 20 pts) and pre-#2701 gates — its per-run
`is_A`/`import_verdict` fields are NOT on the canonical scale; §1's regrade line and §2's fresh
table are canonical. Both raw files are preserved unmodified (never overwritten).

**Consistency check:** re-running `variance_study.summarize()` over both committed rows files
reproduces every figure in the tables below exactly (means, stdevs, F1s, per-run and total costs).

## 1. Causal confirmation — the #2701 question

> Did the fiber-cable `duplicate_identifier` false positives disappear, with no new hard failures?

**Yes, twice over:**

| evidence | before #2701 | after #2701 |
|---|---|---|
| Regrade of the SAME 15 saved run-1 graphs (deterministic, free) | 10/15 import-FAIL, all `duplicate_identifier` on `-W5469`/`-W5497` (cross-section) | **1/15 FAIL** — a *same-section* `24VDC`/`GND` duplicate in one opus-high graph (a genuine defect, correctly blocked) |
| Fresh 15-run paid rerun (this study) | — | **0/15 import-FAIL**, 0 confident misreads, 0 trust violations |

The gate still blocks real same-section duplicates (ATV340 cases + the run-1 power-rail defect),
so this is a false-positive kill, not a gate weakening.

## 2. Fresh rerun results (canonical scale — the type_text lane now costs hedged runs 5 pts)

| config | n | score mean±sd | min | letters | all-A | misreads | import-fail | device F1 | xref F1 | $/run (std) | latency* |
|---|---|---|---|---|---|---|---|---|---|---|---|
| opus-xhigh (default) | 5 | 92.00 ± 0.00 | 92.0 | AAAAA | yes | 0 | 0.0 | 1.0 | 0.800 | $0.343 | 149 s |
| opus-high | 5 | 91.74 ± 3.38 | 87.5 | ABABA | **NO** | 0 | 0.0 | 1.0 | 0.783 | $0.238 | 73 s |
| opus-medium | 5 | 93.62 ± 1.52 | 92.0 | AAAAA | yes | 0 | 0.0 | 1.0 | **0.908** | **$0.203** | 70 s |

\* Latency is not measurable in batch mode; values are the interactive cost benchmark's n=1
measurements (`2026-07-14-printsense-cost-benchmark.md`).

`type_text` F1 = 0.0 for every run of every config — no configuration confidently asserts the
blurred `ITS.LWL-K-01.2` catalog code (they all hedge it honestly). The −5 is uniform, so it does
not bias the between-config comparison; recovering it is the `--enhance`/`--verify` path
(iterate-branch derivation), not an effort-level question.

## 3. §9 decision tables (mechanical rule; the call is the operator's)

**opus-high vs opus-xhigh — VERDICT: KEEP xhigh.**
`candidate_all_A` **FAILED** (ABABA, min 87.5); the other five checks pass. high's run-1 sweep
(5/5 A) did not replicate under the canonical scale — its base-read variance puts weak runs
below 90 once the hedged type lane costs 5.

**opus-medium vs opus-xhigh — every check passes:**
candidate_all_A ✓ · hard_failures_not_increased ✓ (0.0 vs 0.0) · misreads_not_increased ✓ (0 vs 0) ·
device_not_materially_regressed ✓ (1.0 vs 1.0) · xref_not_materially_regressed ✓ (0.908 vs 0.800 —
an improvement) · cost_lower ✓ ($0.203 vs $0.343). Mechanical verdict: SWITCH RECOMMENDED.

**Across two independent 5-run studies (30 paid runs total), medium has now gone 10/10 A-band with
the best mean score, best xref F1, and lowest cost each time; xhigh has never beaten it on any
axis except run-to-run score stability (±0.00 this run).**

## 4. What this does NOT yet prove (corpus caveat)

Both studies are repeated sampling of ONE drawing. Per the go-forward plan Step 4, the global
default does not change until the surviving configuration holds on a small stratified corpus.
Corpus inventory: dense IEC sheet ✅ (this case) · partially-legible ✅ (03_lowres, same rubric) ·
legitimate repeated identifiers ✅ (ATV340 frozen rubric) · must-say-unconfirmed (05_unrelated —
needs a rubric) · simple motor starter — **image+truth needed** · multi-page cross-reference —
**image+truth needed**. Topology/signal-direction stability metrics arrive with §8A/§8B.

## 5. Status

**Production default remains `opus-4-8 · xhigh`** (`PRINT_VISION_EFFORT` default in
`printsense/interpret.py`). Changing it requires the operator's explicit approval plus the Step-4
corpus pass. The evidence cycle's steps 1–3 are complete: ladder merged ✓ · false positives
verified fixed ✓ · provisional candidate identified (**medium**) ✓.
