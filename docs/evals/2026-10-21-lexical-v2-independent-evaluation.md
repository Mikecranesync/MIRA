# `NOTEBOOK_LEXICAL_V2`: independent evaluation evidence package (2026-10-21)

**Verdict: NO-GO for production.** The owner accepted it on 2026-10-21.

- **The retrieval gain is supported on development data.** Release is blocked on refusal, safety, absolute-quality and latency evidence.
- **#4572 remains a release blocker** until a valid production-equivalent refusal evaluation resolves it.
- **This package authorizes nothing.** No production activation, no threshold change, no further sealed-set read.

**Who did what:**
- **Independent evaluator:** BRAVO (session `01QHPC3j…`).
- **Executor:** Charlie 1 (session `01R9pPdj…`). That session also authored the flag (#4556) and #4578, so the executor is not independent of the change under test. The evaluator wrote `scorecard.py`, so its math was cross-checked against independent implementations (§4).

## 1. References

| Item | Where |
|---|---|
| Benchmark scorecard and pre-registration | PR #4589, branch `feat/benchmark-acceptance-scorecard` (run pin `9d22076c1`) |
| Release blocker: refusals | Issue #4572 |
| ON ranking non-determinism | Issue #4597 |
| Evaluation baseline and gates of record (owner-accepted provisional policy) | #4578, merged `163fce698`: `docs/evals/retrieval-eval/release-gates.md` |
| Feature and staging A/B | #4556, #4557; #4571 (`docs/evals/2026-10-21-notebook-lexical-idf-staging-ab.md`) |
| Raw dev receipts | branch `eval/bench-4589-dev-receipts` @ `9660297a9` (`docs/evals/benchmark-acceptance/receipts-2026-10-21-dev/`) |
| Receipts and verdict comments | #4589: `[BENCH-RUN-RECEIPTS]`, `[INDEPENDENT-EVAL-REVIEW]`, `[INDEPENDENT-EVAL-VERDICT]` |
| Unanswerable-set sizing (≥ 44) | #4584 |

## 2. Configuration receipts (production-equivalent, lexical only)

- **Arms:** `NOTEBOOK_LEXICAL_V2` 0 vs 1, and nothing else differs.
  - The script unsets `NOTEBOOK_HYBRID_RETRIEVAL` and `NOTEBOOK_RERANK`. This was verified under `/bin/bash` 3.2 by exporting hybrid=1 in the calling shell.
  - The calling environment was empty.
  - `MIRA_ENFORCE_APPROVED_RETRIEVAL` was unset in both arms.
- **Build:** `mira-hub` at `9d22076c1`. `npm ci` ran in the pinned worktree; lockfile blob `b4239099a8`, lockfile sha256 `96ac26ff…`.
- **Inputs:** dev questions sha256 `b2aaac38…` (77 questions, 19 manuals).
- **Database:**
  - Throwaway Postgres `:55432/t4`, schema `ke_schema.sql` (a pg_dump from PG 17.11, created 2026-10-20 by the T4 session).
  - **Limitation:** that it came from staging is that session's record, re-verified by no one.
  - Contamination: 0 public rows, 0 doc overlap. The run tenant held 7,127 rows across 19 docs. 0 harness errors, 0 empty result sets, 0 gold mismatches.
- **Raw-file hashes** (sha256 prefix; full values in `SHA256SUMS` on the receipts branch):
  - off-k10 `cdb8fce5`, on-k10 `76b3f4de`;
  - partial (`24499d31e`) off-k10 `73ca6ce1`, on-k10 `26bc7403`;
  - latency reps `rep1-off 453fcaea`, `rep2-on af6627db`, `rep3-on f27d5551`, `rep4-off 7fd57ed8`, `rep5-off 67afb513`, `rep6-on 0f0eef97`.

## 3. Results (recomputed independently)

| k | metric | OFF | ON | b / c | exact p | manual-cluster 95% | #4578 status |
|---|---|---|---|---|---|---|---|
| 10 | Recall@5 | 46/77 | 64/77 | 2 / 20 | 0.0001 | +12.5 … +36.5 pp | supported |
| 10 | hit@6 | 51/77 | 66/77 | 3 / 18 | 0.0015 | +6.6 … +35.6 pp | supported |
| 10 | hit@1 | 31/77 | 42/77 | 8 / 19 | 0.052 | +1.4 … +26.7 pp | observed |
| 6 | Recall@5 | 48/77 | 66/77 | 4 / 22 | 0.0005 | +11.1 … +37.5 pp | supported |
| 6 | hit@6 (production call shape) | 52/77 | 69/77 | 3 / 20 | 0.0005 | +8.6 … +38.6 pp | supported |
| 6 | hit@1 | 31/77 | 41/77 | 9 / 19 | 0.087 | +0.0 … +25.7 pp | observed |

MRR@10 at k10: 0.487 → 0.668.

**Short result sets, the #4572 mechanism:**
- OFF returns fewer than topK chunks on **16/77** (k10) and **15/77** (k6). ON returns a full set on **77/77** at both.
- ON fills those slots without gaining the accepted page on **14** (k10) and **13** (k6).
- That is row-level evidence that IDF ordering supplies near-miss context where the old path returned little. It does not measure refusals.

**Latency at k6, replicated** (order off, on, on, off, off, on; nearest-rank):

| arm | p95 per rep (ms) |
|---|---|
| OFF | 158, 171, 173 |
| ON | 650, 212, 217 |

- Typical ON vs OFF p95 is about **+27%** (217 vs 171).
- That is over the criteria's +10% and #4578's ×1.2, and within the spec's 388 ms absolute cap.
- One ON rep (650 ms) is unexplained. It matches the original run's 685.
- ON queries returning more than topK chunks are 8–9× slower (median 369 / 620 ms).

**Non-determinism (#4597):**
- ON reorders between identical runs: 4/77 at k10, and 3–21/77 at k6.
- OFF reorders on 0/77 across 4 runs.
- The effect on binary metrics is small (hit@6 is 69 in every k6 ON run, hit@1 41–43), but it is product behaviour.
- Likely cause: float summation order in `sum(ln(...))`. The ORDER BY tie-break itself is complete.

## 4. Verification receipts (how each number was checked)

- **Raw files:** all match `SHA256SUMS`. The per-file prefixes above were recomputed on BRAVO.
- **`tools/benchmark-acceptance/independent_recompute.py`** is a separate minimal implementation, not `scorecard.py`. It uses scipy's exact binomial and #4578's `cluster_bootstrap_diff`.
  - It produced every number in §3, and they agree with the executor's scorecards.
  - Command: `python3 tools/benchmark-acceptance/independent_recompute.py <receipts-dir>`.
- **Scorer math cross-check:**
  - `scorecard.py`, #4578's `stats.py` and scipy agree for McNemar over b, c ≤ 12 and for Wilson over n ≤ 79.
  - The paired identity OFF − b + c = ON holds on all rows.
- **Scorer tests:** `python3 -m pytest tools/benchmark-acceptance/test_scorecard.py` gives 21 passed. 14 named mutations are caught (README table). `shellcheck tools/benchmark-acceptance/run_on_data_node.sh` is clean.
- **Run script:** verified end to end under macOS `/bin/bash` 3.2 with npm and npx stubbed: all 4 passes run, both scorecards are written, and no worktree is left behind.

## 5. Gate status (criteria doc and #4578 gates of record)

| Gate | Status | Evidence |
|---|---|---|
| Q1 Recall@5 ≥ 0.90 | **FAIL** | 0.831 (k10) |
| Q2 MRR@10 ≥ 0.85 | **FAIL** | 0.668 (k10) |
| Q6 primary gain ≥ 5 pp | PASS (target only) | +23.4 pp |
| Q7 secondary regression ≤ 2 pp | PASS | none |
| #4578 R1 / spec gate 1 (top-6 ≥ 64/77; McNemar p < 0.05; no **net** top-1 loss; p95 ≤ 388 ms) | **quality PASS, latency MIXED** | top-6 66 (k10) and 69 (k6); p 0.0015 / 0.0005; top-1 31 → 42 / 41 (net gain). ON p95 exceeds 388 ms in 2 of 4 k6 runs (685, 650) and is within it in 2 (212, 217). |
| #4578 R2 (sealed; gained ≥ lost) | aggregate only, from gate 2 | top-6 36 → 48/60. **Not re-read**, per policy. |
| S1 / #4572 refusals | **UNRESOLVED, release blocker** | only staging-stack 6/7 (invalid under #4578 V4/V5; reading chosen after the fact) |
| S2–S5, Q3–Q5, #4578 A1/A2/S2/S3 | **NOT MEASURED** | no production-config answer-stage evidence |
| P1 latency | **NEEDS APPROVAL** | about +27% typical, one unexplained 650 ms rep |
| D1 production parity of the rollout path | **OPEN** | `docker-compose.saas.yml` does not forward `NOTEBOOK_LEXICAL_V2` |
| V1 sample (≥ 100 / 20 / 20) | **FAIL** | 77 answerable, 0 unanswerable, 0 safety in this run |

## 6. Known protocol limitations

1. **Executor independence:** the executor authored the flag and the gate policy. Mitigated by raw-row recomputation.
2. **Evaluator independence:** the evaluator authored `scorecard.py`. It has not yet had a Codex review, which is required before it becomes the single verdict engine (owner decision 1).
3. **The dev set is tuning data,** so the quality results are diagnostic. The only sealed evidence is gate 2's prior aggregate.
4. **S1's 6/7 reading was chosen after the results were known.** All three readings (5/7, 6/7, 4/7) fail.
5. **Two pre-execution corrections (amendment A1)** fixed problems in the evaluator's own handoff: a second sealed read was withdrawn, and two run-script defects were fixed.
6. **The schema provenance** (staging) has not been independently re-verified.
7. **Wilson and McNemar intervals assume independent questions.** The manual-cluster bootstrap is the interval of record.
8. **The k6 scorecard's "MRR@10"** is computed over 6 results. The pre-registration takes Q1 and Q2 from k10 only.

## 7. Outstanding work, for the next evaluator session

1. **A refusal evaluation in production configuration** on ≥ 20 frozen unanswerable cases (#4584 recommends ≥ 44), drawn fresh, never from the sealed set. Paired vs OFF, with zero losses required. This resolves or confirms #4572.
2. **Explain the 650 ms ON rep,** or re-measure, before any P1 approval request.
3. **Answer-stage gates:** citation correctness, safety-warning placement, fabrication. These need a budget decision from the owner.
4. **Re-measure after the #4597 fix** (deterministic ordering) and any answer-stage evidence floor.
5. **A Codex review of #4589** before `scorecard.py` becomes the single verdict engine.
6. **#4593** goes to a separate code reviewer, outside the evaluator role.
