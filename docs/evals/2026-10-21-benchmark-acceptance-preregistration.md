# Benchmark acceptance for `NOTEBOOK_LEXICAL_V2`: pre-registration (2026-10-21)

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

**MRR@10 needs `topK: 10`**, while production calls `topK: 6`. A larger topK can change candidate generation, so the run records both `topK=10` (for MRR@10 and Recall@5) and `topK=6` (for hit@6, the existing project gate). This is a disclosed difference from production, not parity.

**#4571's staging A/B (hybrid + rerank on) is a second comparison**, and it is not production parity. Its numbers are cited as external evidence and labelled as such.

## Datasets (frozen; sha256 recorded in the run manifest)

| Set | n | Role | Read rule |
|---|---|---|---|
| Development, 77 questions, 19 manuals (`tools/evidence-runoff/bench/`, PR #4555) | 77 | diagnostic; source of the failure taxonomy | per-question allowed (already development data) |
| Sealed unseen (`docs/evals/evidence-runoff/UNSEEN_SET_PROTOCOL.md`, sealed `500ff2e63`) | 60 answerable + 7 unanswerable | qualification | **aggregate only**; the per-question JSONL is written to a gitignored path and not read |

The sealed gold and the corpus stay on the node that holds them (CHARLIE). The scorer and harness travel; the sealed data doesn't.

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

1. Record the environment:
   ```bash
   git rev-parse HEAD > run/sha.txt
   sha256sum <questions.json> <gold.jsonl> > run/inputs.sha256
   ```
2. Run the retrieval harness once per arm × topK × set.
   - Harness: `tools/benchmark-acceptance/retrieval_rank.ts`, a T4 pattern that emits scorecard JSONL rows.
   - Arms: `NOTEBOOK_LEXICAL_V2=0` and `1`.
   - topK: 10 and 6.
3. Score:
   ```bash
   python3 tools/benchmark-acceptance/scorecard.py rows.jsonl \
     --external external.json --out scorecard.json --md scorecard.md
   ```
