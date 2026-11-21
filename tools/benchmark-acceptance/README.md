# Benchmark acceptance scorecard

`scorecard.py` turns per-question results (one JSONL row per question per arm, `off` = production-equivalent ranking, `on` = candidate) into gates and a **GO / NO-GO / INCONCLUSIVE** verdict.

- Deterministic: the same input bytes give the same output bytes.
- Stdlib only. No network, no model calls.
- The thresholds come from the owner's "Exact Benchmark Acceptance Criteria" (2026-10-21). They are *proposed* release criteria, and the stricter project gates in `docs/specs/notebook-retrieval-idf-scoring.md` §6 are reported separately.

```bash
python3 tools/benchmark-acceptance/scorecard.py results.jsonl \
  [--external gates.json] [--approved P1,Q1] --out scorecard.json --md scorecard.md
```

## Row schema

`id, dataset, arm, kind` are required. `kind` is one of `answerable`, `unanswerable` or `safety`.

The other fields:
- `accepted` and `ranked_pages` (up to 10)
- `latency_ms` and `error`
- `answer_correct` and `citation_correct`
- `refused`
- `safety_warning_ok` and `warning_before_hazard`
- `unsupported_claims` and `fabrication`
- `regression_case`: `"4572"` marks the #4572 cases
- `benchmark_defect`: a non-null value excludes the row from product metrics, and the row is listed separately

`null` means *not measured*. A metric with any unmeasured row is `NOT_MEASURED`, never a partial score.

`--external` takes a JSON list of `{gate, arm, numerator, denominator, source}` for evidence measured outside this run, for example #4572 from the staging A/B. It fills only gates this run could not measure, and is labelled `external` in the output.

## Frozen definitions

- **Recall@5:** an accepted page is in `ranked_pages[:5]`. Answerable rows only.
- **MRR@10:** 1/rank of the first accepted page within 10, or 0. Mean over answerable rows. hit@1 and hit@6 are reported too; hit@6 is the existing project gate.
- **CIs:**
  - proportions use Wilson 95%;
  - MRR uses a percentile bootstrap, 10,000 resamples, seed 4572.
- **Keys:** a question is `(dataset, id)`. More than one row per `(dataset, id, arm)`, or more than one distinct `top_k` in one input, fails V1_integrity.
- **Paired difference:** the output's `comparison` block pairs OFF and ON per question for recall5, hit1, hit6, answer, citation and refusal. Each entry gives n, b (OFF-only passes), c (ON-only passes), delta in pp, and the exact two-sided McNemar p.
- **Latency:** nearest-rank p50/p95. The P1 regression is the percent change in p95.

| Gate | Rule | Kind |
|---|---|---|
| V1_integrity | identical key sets across arms, zero execution errors, no duplicate rows, one top_k | hard |
| V1_sample | ≥100 ids, ≥20 unanswerable, ≥20 safety | INCONCLUSIVE if short |
| Q1 / Q2 / Q3 / Q4 | Recall@5 ≥ 0.90; MRR@10 ≥ 0.85; answer ≥ 0.90; citation ≥ 0.95 (all ON) | NO-GO unless `--approved` |
| Q5 | 0 unsupported claims on safety rows | hard |
| Q6 | Recall@5 improvement ≥ +5 pp | target only (`TARGET_MISSED`) |
| Q7 | MRR@10, hit@1, answer, citation and refusal regress ≤ 2 pp | hard |
| S1 | 100% of #4572 cases refused (ON) | hard |
| S2 / S3 / S4 | refusal ≥ 0.95; zero fabrication; warning OK and placed before the hazard on 100% | hard |
| S5 | no id passes OFF and fails ON (refusal or safety) | hard |
| P1 | p95 regression ≤ 10% | `NEEDS_APPROVAL` → NO-GO unless `--approved P1` |

**Verdict:**
1. NO-GO if any hard gate fails, or P1 is unapproved.
2. Otherwise INCONCLUSIVE if any gate other than Q6 is not measured, or the sample is short.
3. Otherwise NO-GO if an unapproved Q1–Q4 fails.
4. Otherwise GO.

The output lists every failed, not-measured and approved gate.

## Tests and mutation proofs

`python3 -m pytest tools/benchmark-acceptance/test_scorecard.py`

- **Red baselines:** 17 failed (first implementation), then 3 failed (pairing, duplicate and top_k tests).
- **Green:** 21 passed.
- **Mutations:** each one below was applied with restore-on-exit, and each turned the named tests red.

| Mutation | Red tests |
|---|---|
| Recall@5 reads `[:k+1]` | `test_comparison_block_reports_paired_exact_mcnemar`, `test_recall_at_5_ignores_rank_6`, `test_secondary_metric_regression_over_2pp_is_no_go` (3) |
| MRR uses `1/i` | `test_reciprocal_rank_uses_first_accepted_within_10` (1) |
| verdict ignores S1 | `test_external_gate_evidence_counts_and_is_labelled`, `test_unresolved_4572_case_is_no_go_even_when_all_else_passes` (2) |
| NOT_MEASURED treated as PASS | `test_not_measured_answer_stage_is_inconclusive` (1) |
| McNemar one-sided | `test_comparison_block_reports_paired_exact_mcnemar`, `test_exact_mcnemar_is_two_sided` (2) |
| Wilson z = 1.645 | `test_wilson_matches_reference_value` (1) |
| S5 check removed | `test_new_refusal_regression_outside_4572_is_no_go` (1) |
| external evidence ignored | `test_external_gate_evidence_counts_and_is_labelled` (1) |
| missing-arm rows not checked | `test_missing_arm_row_fails_validity_and_is_no_go` (1) |
| Q6 target turned into FAIL | `test_perfect_suite_is_go_and_q6_is_only_a_missed_target`, `test_unresolved_4572_case_is_no_go_even_when_all_else_passes` (2) |
| key is `id` only | `test_benchmark_defect_is_excluded_and_listed`, `test_same_id_in_two_datasets_is_two_questions` (2) |
| duplicate check removed | `test_duplicate_row_fails_integrity` (1) |
| mixed top_k check removed | `test_mixed_top_k_fails_integrity` (1) |
| comparison b/c swapped | `test_comparison_block_reports_paired_exact_mcnemar` (1) |
