# Benchmark acceptance for `NOTEBOOK_LEXICAL_V2`: pre-registration (2026-10-21)

> **Amendment A1 (2026-10-21, before any execution).** These changes withdraw instructions; no threshold changes:
> 1. **The sealed unseen set is not run again.** #4578's `docs/evals/retrieval-eval/release-gates.md` (provisional policy, owner-accepted 2026-10-21) says R2 is run *once per change*, and gate 2 already ran it for this candidate. The "declared second read" below is **withdrawn**. The gate-2 aggregate (top-6 36→48 of 60, top-1 16→?) is cited as external evidence instead.
> 2. **The S1 reading is not pre-registered.** The 6/7 answer-text choice was made after #4571's results were known. All three readings (5/7, 6/7, 4/7) are reported, and all fail S1's 100% rule, so the verdict does not depend on the choice.
> 3. **#4578's gates are the established project gates.** They are R1/R2/A1/A2/S1–S3/P1/D1 (P1 there is p95 ≤ 1.2× baseline; here it is ≤ 10%, the stricter of the two). This document's criteria are reported alongside them, never instead of them.
> 4. **Intervals assume independent questions.** Questions cluster by manual, so the Wilson and McNemar results here can be too narrow. #4578's manual-cluster bootstrap (`tools/retrieval_eval/stats.py`) is the interval of record for any "supported" claim.

This document is frozen before any run on the candidate. The scorer, its definitions and the gate thresholds live in `tools/benchmark-acceptance/` (README there; the tests are mutation-proven).

- **Do not change** the scoring rules, thresholds or expected answers after execution begins.
- **Source:** the owner's "MIRA Retrieval Evaluation — Exact Benchmark Acceptance Criteria" (2026-10-21).
- **Status of the thresholds:** proposed release criteria, not approved policy. The stricter project gates (spec §6) are reported separately and are not replaced.

## Question

Does `NOTEBOOK_LEXICAL_V2=1` (#4556) qualify for production, compared with production-equivalent ranking (`=0`)?

## Arms (production parity, §4)

| Arm | `NOTEBOOK_LEXICAL_V2` | Hybrid / rerank | Notes |
|---|---|---|---|
| `off` | 0 | off | Production's configuration: `factorylm/prd` sets neither `NOTEBOOK_HYBRID_RETRIEVAL` nor `NOTEBOOK_RERANK` |
| `on` | 1 | off | Same build, same inputs; only the flag differs |

**What is held identical across arms:**
- `retrieveNodeChunks` at the recorded commit SHA;
- the same chunking (`chunkText(1000, 120)`, one page at a time) on a throwaway local Postgres with staging's `knowledge_entries` schema;
- doc-scoped retrieval with `validatedDocScope`.

**MRR@10 needs `topK: 10`**, while production calls `topK: 6`. A larger topK can change candidate generation, so every set is scored twice, as separate scorecards (the scorer rejects mixed top_k):
- **topK=10:** Q1 Recall@5, Q2 MRR@10, Q6, Q7 and the paired comparison.
- **topK=6:** P1 latency (production's call shape), hit@6, and spec gate 2's paired hit@6 McNemar.

This is a disclosed difference from production, not parity. Each arm is its own process with an untimed warm-up pass before the timed one.

**#4571's staging A/B (hybrid + rerank on) is a second comparison**, and it is not production parity. Its numbers are cited as external evidence and labelled as such.

## Datasets (frozen; sha256 recorded in the run manifest)

| Set | n | Role | Read rule |
|---|---|---|---|
Each set gets its own scorecards; sets are never pooled. Development is diagnostic, and unseen is the qualification read.

| Development, 77 questions, 19 manuals (`tools/evidence-runoff/bench/`, PR #4555) | 77 | diagnostic; source of the failure taxonomy | per-question allowed (already development data) |
| Sealed unseen (`docs/evals/evidence-runoff/UNSEEN_SET_PROTOCOL.md`, sealed `500ff2e63`) | 60 answerable + 7 unanswerable | qualification | **aggregate only**; the per-question JSONL is written to a gitignored path and not read |

The sealed gold and the corpus stay on the node that holds them (CHARLIE). The scorer and harness travel; the sealed data doesn't.

**Second read of the sealed set, declared:**
- The protocol allows one evaluation per release candidate, and gate 2 already read this candidate's aggregate.
- This is a second aggregate-only read, and its only reason is the metrics gate 2 did not compute (Recall@5, MRR@10 at topK=10).
- The set is not burned. The scorecard's gate details can name ids (V1 errors, S5 regressions), so for the sealed run only the verdict line and the aggregate table are read, never the per-question JSONL or the detail cells.

## Budget

**$0.** Retrieval gates only, with zero tokens (owner decision, 2026-10-21). The answer-stage gates (Q3–Q5, S2–S4) are `NOT_MEASURED` by this run.

## Known gaps, declared before the run

- **V1_sample fails by construction.** There are 7 unanswerable cases (20 needed) and no frozen safety set (20 needed). Authoring and sealing those cases is a separate follow-up.
- **Answer-stage gates are not measured,** because the budget is $0.
- **The safety signal from #4571 is 12/15 Stranger Walk red lines in both arms.** Whether those 3 are "mandatory safety-warning cases" in the §3 sense is unconfirmed, so they are cited, not scored.

## External evidence, entered before the run (`--external`)

```json
[{"gate": "S1", "arm": "on", "numerator": 6, "denominator": 7,
  "source": "docs/evals/2026-10-21-notebook-lexical-idf-staging-ab.md (staging stack, hybrid+rerank ON; answer-text refusal check)"}]
```

**Why S1 uses 6/7.** The A/B gives three readings for the same 7 unanswerable turns:
- 5/7 by the walk scorer, which counts any cited turn as not refused;
- **6/7 by answer text**, from the notebook chat's own `isRefusal` classifier;
- 4/7 by stream status `insufficient_evidence`.

Answer text is what the technician reads, and it is the product's own classifier, so it's the fairest reading. All three fail S1's 100% rule, so the choice does not change the verdict.

## Decision rule (mechanical; `scorecard.py verdict`)

1. Any hard-gate FAIL (V1_integrity, S1–S5, Q5, Q7) or an unapproved P1 regression → **NO-GO**.
2. Otherwise, any unmeasured gate or a short sample → **INCONCLUSIVE**.
3. Otherwise, an unapproved Q1–Q4 fail → **NO-GO**.
4. Otherwise → **GO**.

**Expected outcome given the declared evidence:** NO-GO, because S1 is entered as 6/7 external evidence. Only a production-config refusal measurement of the 7 cases can change S1.

**Separately reported project gates:**
- **Spec gate 2:** no net hit@6 loss on unseen, by exact McNemar.
- **Spec latency invariant:** p95 ≤ 388 ms. The criteria doc's own latency gate (p95 regression ≤ 10%) is stricter.

## Run commands (on the data node)

`tools/benchmark-acceptance/run_on_data_node.sh` does all of it for one set:
- it pins the branch SHA in a throwaway detached worktree, removed on exit, and never touches the shared checkout;
- it records the SHA and input sha256;
- it runs both arms at topK 10 and 6 with hybrid and rerank unset;
- it writes `<set>-<arm>-k<topK>.jsonl` and one scorecard per topK.

```bash
export BENCH_PG=postgres://bench@localhost:55432/bench   # throwaway Postgres, staging knowledge_entries schema (as T4)
bash tools/benchmark-acceptance/run_on_data_node.sh dev    <dev-77 questions.json>   run/
# (unseen run withdrawn by amendment A1: R2 runs once per change)
```

`run/external.json` is the JSON in "External evidence" above. Pass it to the unseen (qualification) run only.

## Evidence package status (criteria §5)

| Item | Status |
|---|---|
| 1. Per-question results | produced by the run (development: readable; unseen: written, not read) |
| 2. Scorecard with num/den and CIs | `scorecard.json` / `.md` per set and topK |
| 3. Baseline vs candidate | the scorecard's `comparison` block (paired, exact McNemar) |
| 4. Failure taxonomy | **pending**: written from the development set after the run |
| 5. Commands, environment, config, SHA | this document plus `run/sha.txt` and `run/inputs.sha256` |
| 6. GO/NO-GO naming every failed gate | the scorecard verdict |
| 7. Top three improvements | below; ranked before the run, revisited after |

### Top three improvements (expected impact, effort)

1. **An answer-stage minimum-evidence floor for #4572.**
   - Refuse when no retrieved chunk carries a term from the question's distinguishing span, instead of letting near-miss IDF matches reach generation.
   - Impact: high, because it unblocks S1, the only declared hard fail. Effort: small; deterministic, no tokens.
2. **Author and seal 20+ refusal and 20+ safety cases** under the unseen protocol (two labellers, sha256 sealed before any run).
   - Impact: high, because V1_sample cannot pass without them and S2–S4 stay unmeasured. Effort: medium.
3. **Widen the notebook safety trigger to isolation phrasing.**
   - "isolate the 24 V supply" and "disconnect the supply" currently match nothing, because `safety-phrases.ts` is substring-only and the shared list is exempted by `EDUCATIONAL_QUESTION_RE` (grumpy-review finding, 2026-10-20).
   - Impact: closes a live S4-class miss. Effort: small; a word-bounded regex gated by `DEFINITIONAL_RE`.
