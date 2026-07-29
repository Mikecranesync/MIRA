# Codex Handoff — Build FactoryLM Industrial Technician Dataset v0

Work in `Mikecranesync/MIRA`. Start from branch `docs/technician-dataset-inventory-2026-07-23` / PR #2882 and read these first:

- `docs/zta/2026-07-23-technician-dataset-inventory-gap-report.md`
- `docs/zta/2026-07-23-technician-dataset-candidate-inventory.csv`
- `docs/zta/2026-07-22-technician-lora-phase0-reconciliation.md`
- `factorylm_ai/dataset/paid_gate.py`
- `factorylm_ai/governance/`, `factorylm_ai/dataset/`, `factorylm_ai/adapters/`, and `factorylm_ai/synth/`

## Objective

Build the real, governed Dataset v0 for **FactoryLM Industrial Technician v0**. The model should learn technician behavior: grounded circuit/diagnostic reasoning, technician-first explanations, correct tool use, safe troubleshooting, explicit uncertainty, and refusal when evidence is insufficient. Do not try to memorize manuals into the weights.

Execute the work; do not return only another design document.

## Dataset target

Produce a review-ready path toward:

- 180 eligible interactions total
- 110 PrintSense and 70 Drive Commander
- at least 25 training lineages
- at least 5 permanently held-out lineages
- at least 30 uncertainty/refusal/correction examples
- at least 25 safety-sensitive examples
- at least 70% real or human-corrected data
- no more than 30% synthetic data

Do not fake the target. If rights, evidence, or approval prevent reaching it, build the maximum honest candidate set and report the exact remaining gap.

## Source priority

1. **CV-101 owned/controlled evidence** — create approximately 25 candidates from verified machine/print facts, anomaly scenarios, healthy-idle behavior, communication loss, Modbus wiring, E-stop channels, photo-eye behavior, and `field_verify` refusal cases.
2. **Drive Commander deterministic packs/gold sets** — create approximately 60 original technician interactions across GS10, PowerFlex 40, and PowerFlex 525. Use pack facts as independent answer keys. Do not copy manual prose. Include fault meaning, relevant parameters, communication-loss distinctions, safe checks, model ambiguity, unsupported-code refusal, and observed-versus-inferred distinctions.
3. **Rights-clear PrintSense sources** — prefer FactoryLM-authored diagrams, user-owned lab prints, and public-domain patent drawings. Do not mark public OEM manuals `training_allowed` merely because they are downloadable.
4. **Human corrections/refusals** — convert only interactions with provenance, redaction, rights/tenant clearance, correction linkage, and explicit human approval.
5. **SimLab/MIRA frozen cases remain evaluation-only and must never enter training.**
6. Treat SCU2/private employer material as blocked unless an explicit rights record authorizes shared-model training.

## Required implementation

Reuse the existing canonical governance, lineage, dataset, adapter, manifest, export, paid-gate, and synthetic contracts. Do not create a parallel schema or weaken any fail-closed gate.

Build:

1. Corpus-source registry entries and a reproducible source inventory with explicit rights states.
2. Lineage assignment before generating derivatives; all pages, crops, paraphrases, and corrections from one document stay in one split.
3. Candidate generators/adapters that emit the existing `DatasetRecord` and governance shapes.
4. Independent answer-key provenance for every record. The target model may not generate or verify its own answer key.
5. Candidate JSONL plus a reviewer package showing evidence, source, proposed answer, safety flags, uncertainty type, correction rationale, lineage, rights, and rejection reasons.
6. A human-approval workflow that never auto-marks records gold or sets `approved_by`.
7. Deterministic duplicate/near-duplicate, schema, message-validity, provenance, sensitivity, rights, lineage-leakage, held-out, and frozen-eval guards.
8. Export of only approved eligible records to reproducible train/validation/test artifacts with manifest hashes. If no records are approved, export must remain blocked rather than producing an empty or fake training set.
9. Rights report, rejection report, real-versus-synthetic composition report, source/lineage report, behavior-coverage report, token/cost estimate, and Phase-3 paid-gate report.
10. Frozen base-only and base-plus-tools benchmark fixtures so later adapter evaluation is blind and contamination-safe.

## Quality law

Answers should begin with machine or circuit function, then signal/power flow, likely symptoms, ordered safe checks, exact evidence, and finally unknowns. Hard failures include invented terminals/wires/parameters/fault meanings, unsafe energized-work instructions, certainty from unreadable evidence, private-data leakage, or held-out contamination.

Use this external evaluation weighting:

- grounded correctness 30%
- technician usefulness/order 20%
- circuit/diagnostic reasoning 15%
- uncertainty/refusal 15%
- safety 10%
- tool/pack/structured-output behavior 10%

## Delivery

Use a small stacked PR ladder rather than one unreviewable change. Keep PR #2882 as the planning/inventory parent. Suggested implementation slices:

1. source registry + inventory command + rights/lineage plan
2. CV-101 candidate corpus + review package
3. Drive Commander candidate corpus + review package
4. rights-clear PrintSense candidate corpus
5. approval/export/reporting + frozen benchmark/readiness proof

For every PR, run the focused and full `factorylm_ai` tests where possible, Ruff, format check, Pyright, schema validation, leakage tests, and `git diff --check`. Report record counts by source, lineage, split, behavior, safety, rights, approval, rejection code, and real/synthetic origin.

## Absolute prohibitions

Do not merge without Mike’s approval. Do not call Together, upload training files, create a fine-tune job or endpoint, consume paid authorization, spend money, deploy, touch production, expose secrets, include confidential tenant data, or train on held-out/frozen-eval material.

Stop at the final dry-run/readiness package and ask for Mike’s explicit paid-training decision only after every hard gate passes.
