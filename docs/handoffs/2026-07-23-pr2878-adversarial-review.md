# PR 2878 Adversarial Review

PR #2878 is CI-green at `db91d398`, but I would hold merge until the findings below are fixed.

## 1. Source Representation Can Be Satisfied By Rejected Records

Severity: high

Files:

- `factorylm_ai/dataset/assemble.py`
- `factorylm_ai/dataset/paid_gate.py`
- `tests/factorylm_ai/test_dataset_v0.py`

Problem: `assemble_dataset_v0()` adds `source_system` before eligibility is checked, and `source_representation` checks only `DatasetV0.source_systems`. A rejected Drive Commander record with unresolved rights can satisfy the Drive Commander representation requirement while the eligible training set is still all PrintSense.

Observed false pass:

- eligible source systems: `["printsense"]`
- build source systems: `["drive_commander", "printsense", "simlab"]`
- paid gate result: `PAID_GATE_PASS`

Fix:

- require trainable source representation from `dataset.eligible`
- specifically require at least one dataset-eligible PrintSense record and one dataset-eligible Drive Commander record
- keep SimLab/MIRA as benchmark representation, but require it through readiness evidence or a rejected/frozen benchmark bucket explicitly, not the same check as trainable sources
- update the passing fixture so Drive Commander coverage is training-eligible
- add a regression test proving rejected Drive Commander records do not satisfy source representation

## 2. Model-Support Evidence Accepts The Wrong Model Or Provider

Severity: high

File:

- `factorylm_ai/dataset/paid_gate.py`

Problem: `ModelSupportEvidence.is_confirmed()` only checks non-empty fields plus `supported=True`. A report can pass with `model_id="Some/Other-70B"`, `provider="not-together"`, `checked_at="not-a-date"`, and `method="trust-me"`.

Observed false pass:

- model evidence: `Some/Other-70B`, provider `not-together`
- paid gate result: `PAID_GATE_PASS`

Fix:

- add constants for the intended paid event target:
  - `TARGET_PROVIDER = "together"`
  - `TARGET_MODEL_ID = "Qwen/Qwen3.5-9B"`
- require `model_support.provider == TARGET_PROVIDER`
- require `model_support.model_id == TARGET_MODEL_ID`
- validate `checked_at` as an ISO timestamp string
- restrict `method` to an allowed value such as `serverless-catalog` or require a `receipt_ref`
- add tests for wrong model, wrong provider, invalid timestamp, unsupported model, and valid evidence

## 3. Hard Gate Policy Is Still Caller-Relaxable

Severity: medium

File:

- `factorylm_ai/dataset/paid_gate.py`

Problem: `evaluate_paid_gate()` exposes `cost_cap_usd`, `min_records`, `min_lineages`, `min_valued`, `min_held_out`, and `min_safety_sensitive` as parameters. The Phase-3 gate is supposed to be fixed evidence policy, not caller-configurable.

Fix:

- remove threshold/cap override parameters from `evaluate_paid_gate()`
- use module constants directly
- if tests need alternate thresholds, add a private helper or test-only fixture rather than public policy knobs

## 4. Readiness Evidence Is Too Opaque To Audit

Severity: medium

File:

- `factorylm_ai/dataset/paid_gate.py`

Problem: `ReadinessEvidence` carries booleans/counts, not auditable evidence. The spec asks for paid-gate evidence and readiness reports: corpus report, real-vs-synthetic composition, rights report, frozen benchmark baseline, and base-vs-tools proof.

Fix:

- replace `held_out_lineage_count` with `held_out_lineage_keys` and validate:
  - unique keys
  - each key deterministically assigns to `held_out`
  - count is `>= 5`
- add references such as:
  - `synthetic_composition_report_ref`
  - `base_vs_tools_benchmark_ref`
  - `rights_report_ref`
  - `frozen_benchmark_baseline_ref`
- require refs to be non-empty when the related check passes
- include those refs in `PaidGateReport.to_dict()`

## Verification

Run:

```powershell
py -3 -m ruff check factorylm_ai/dataset tests/factorylm_ai/test_dataset_v0.py
py -3 -m ruff format --check factorylm_ai/dataset tests/factorylm_ai/test_dataset_v0.py
py -3 -m pyright factorylm_ai/dataset tests/factorylm_ai/test_dataset_v0.py
py -3 -m pytest tests/factorylm_ai/test_dataset_v0.py -q
py -3 -m pytest tests/factorylm_ai -q
```

Done when the false-pass cases above block and PR #2878 remains mergeable.
