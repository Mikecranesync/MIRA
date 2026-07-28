# FactoryLM Industrial Technician Dataset v0 Readiness Package

Build id: `2026-07-27-technician-dataset-v1`

Verdict: BLOCKED for paid training. The candidate corpus is review-ready, but no records were automatically marked gold or approved.

## Counts

- Candidate records: 211
- Eligible training records now: 105
- PrintSense candidates: 149
- Drive Commander candidates: 62
- Candidate train-side lineages: 24
- Held-out lineages reserved: 5
- Review decisions applied: 106
- Approved decisions: 104
- Corrected decisions: 1
- Rejected decisions: 1
- Hold-out decisions: 0
- Eligible training records before decisions: 0
- Eligible training records after decisions: 105
- Valued uncertainty/refusal/correction records: 77
- Safety-sensitive records: 87
- Real or human-corrected share: 100.00%
- Synthetic share: 0.00%

## Review Decision Intake

- Decision schema: `factorylm.technician-dataset.review-decision.v1`
- Candidate JSONL is immutable; reviewer actions append to a separate JSONL ledger.
- Exact duplicate decision events are idempotent; changed decisions for an existing record id are rejected.
- Append command: `py -3 -m factorylm_ai.dataset.technician_v0 --stage readiness --decisions-path docs/zta/technician-dataset-v0/review-decisions/decisions.jsonl --append-decision decision.json`
- Rebuild command: `py -3 -m factorylm_ai.dataset.technician_v0 --stage readiness --decisions-path docs/zta/technician-dataset-v0/review-decisions/decisions.jsonl --out-dir docs/zta/technician-dataset-v0`

## Paid Gate

- Verdict: `PAID_GATE_PASS`
- Blocking checks: 

## No-Action Proof

- dry_run=true
- executed=false
- upload_occurred=false
- fine_tune_job_created=false
- endpoint_created=false
- authorization_consumed=false
- spend_occurred=false
- deployment_occurred=false

## Artifacts

- behavior_coverage: `docs\zta\technician-dataset-v1\reports\behavior_coverage_report.json`
- benchmark: `docs\zta\technician-dataset-v1\reports\base_vs_tools_benchmark.json`
- candidate_jsonl: `docs\zta\technician-dataset-v1\candidate_dataset.jsonl`
- candidate_manifest: `docs\zta\technician-dataset-v1\candidate_manifest.json`
- composition: `docs\zta\technician-dataset-v1\reports\real_vs_synthetic_composition_report.json`
- duplicate_leakage: `docs\zta\technician-dataset-v1\reports\duplicate_leakage_report.json`
- frozen_benchmark: `docs\zta\technician-dataset-v1\reports\frozen_benchmark_baseline.json`
- inventory_report: `docs\zta\technician-dataset-v1\inventory_report.md`
- lineage_plan: `docs\zta\technician-dataset-v1\reports\lineage_split_report.json`
- phase3_paid_gate: `docs\zta\technician-dataset-v1\reports\phase3_paid_gate_report.json`
- rejection_report: `docs\zta\technician-dataset-v1\reports\rejection_report.json`
- review_cv101: `docs\zta\technician-dataset-v1\review-packages\cv101_review_package.md`
- review_decision_report: `docs\zta\technician-dataset-v1\reports\review_decision_report.json`
- review_drive: `docs\zta\technician-dataset-v1\review-packages\drive_review_package.md`
- review_printsense: `docs\zta\technician-dataset-v1\review-packages\printsense_review_package.md`
- reviewed_jsonl: `docs\zta\technician-dataset-v1\reviewed_dataset.jsonl`
- reviewed_manifest: `docs\zta\technician-dataset-v1\reports\reviewed_manifest.json`
- rights_report: `docs\zta\technician-dataset-v1\reports\rights_report.json`
- source_registry: `docs\zta\technician-dataset-v1\source_registry.json`
- token_cost: `docs\zta\technician-dataset-v1\reports\token_cost_estimate.json`
