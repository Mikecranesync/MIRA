# FactoryLM Industrial Technician Dataset v0 Readiness Package

Build id: `2026-07-23-technician-dataset-v0`

Verdict: BLOCKED for paid training. The candidate corpus is review-ready, but no records were automatically marked gold or approved.

## Counts

- Candidate records: 180
- Eligible training records now: 0
- PrintSense candidates: 110
- Drive Commander candidates: 70
- Candidate train-side lineages: 25
- Held-out lineages reserved: 5
- Review decisions applied: 0
- Approved decisions: 0
- Corrected decisions: 0
- Rejected decisions: 0
- Hold-out decisions: 0
- Eligible training records before decisions: 0
- Eligible training records after decisions: 0
- Valued uncertainty/refusal/correction records: 104
- Safety-sensitive records: 56
- Real or human-corrected share: 77.78%
- Synthetic share: 22.22%

## Review Decision Intake

- Decision schema: `factorylm.technician-dataset.review-decision.v1`
- Candidate JSONL is immutable; reviewer actions append to a separate JSONL ledger.
- Exact duplicate decision events are idempotent; changed decisions for an existing record id are rejected.
- Append command: `py -3 -m factorylm_ai.dataset.technician_v0 --stage readiness --decisions-path docs/zta/technician-dataset-v0/review-decisions/decisions.jsonl --append-decision decision.json`
- Rebuild command: `py -3 -m factorylm_ai.dataset.technician_v0 --stage readiness --decisions-path docs/zta/technician-dataset-v0/review-decisions/decisions.jsonl --out-dir docs/zta/technician-dataset-v0`

## Paid Gate

- Verdict: `PAID_GATE_BLOCKED`
- Blocking checks: min_records, min_lineages, min_valued_interactions, min_safety_sensitive, trainable_source_representation, model_support_confirmed

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

- behavior_coverage: `docs\zta\technician-dataset-v0\reports\behavior_coverage_report.json`
- benchmark: `docs\zta\technician-dataset-v0\reports\base_vs_tools_benchmark.json`
- candidate_jsonl: `docs\zta\technician-dataset-v0\candidate_dataset.jsonl`
- candidate_manifest: `docs\zta\technician-dataset-v0\candidate_manifest.json`
- composition: `docs\zta\technician-dataset-v0\reports\real_vs_synthetic_composition_report.json`
- duplicate_leakage: `docs\zta\technician-dataset-v0\reports\duplicate_leakage_report.json`
- frozen_benchmark: `docs\zta\technician-dataset-v0\reports\frozen_benchmark_baseline.json`
- inventory_report: `docs\zta\technician-dataset-v0\inventory_report.md`
- lineage_plan: `docs\zta\technician-dataset-v0\reports\lineage_split_report.json`
- phase3_paid_gate: `docs\zta\technician-dataset-v0\reports\phase3_paid_gate_report.json`
- rejection_report: `docs\zta\technician-dataset-v0\reports\rejection_report.json`
- review_cv101: `docs\zta\technician-dataset-v0\review-packages\cv101_review_package.md`
- review_decision_report: `docs\zta\technician-dataset-v0\reports\review_decision_report.json`
- review_drive: `docs\zta\technician-dataset-v0\review-packages\drive_review_package.md`
- review_printsense: `docs\zta\technician-dataset-v0\review-packages\printsense_review_package.md`
- reviewed_jsonl: `docs\zta\technician-dataset-v0\reviewed_dataset.jsonl`
- reviewed_manifest: `docs\zta\technician-dataset-v0\reports\reviewed_manifest.json`
- rights_report: `docs\zta\technician-dataset-v0\reports\rights_report.json`
- source_registry: `docs\zta\technician-dataset-v0\source_registry.json`
- token_cost: `docs\zta\technician-dataset-v0\reports\token_cost_estimate.json`
