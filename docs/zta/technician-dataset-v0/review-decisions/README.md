# Technician Dataset v0 Review Decisions

Use this folder for append-only reviewer decisions for
`docs/zta/technician-dataset-v0`. Candidate JSONL is immutable; do not edit
`candidate_dataset.jsonl`, `candidate_manifest.json`, or `reviewed_dataset.jsonl`
by hand.

## Start Here

If you are reviewing the first small CV-101 batch, start with
`cv101-first-pass.md`. It shows the four records as plain-English review cards
and points to the matching JSON form. Use the larger
`../review-packages/cv101_review_package.md` only when you need the full package
context.

## Current Candidate Manifest

- Build id: `2026-07-23-technician-dataset-v0`
- Candidate manifest SHA-256:
  `2face5d13b65ed68dcaf1aea71db2fc7d7f1cea0b534fb1e95ca26f0004f674d`
- Review package: `../review-packages/cv101_review_package.md`
- Append-only ledger path: `decisions.jsonl`

The templates in `templates/` are forms, not recommendations. They are
intentionally guarded with placeholders and will fail closed until every
`__PLACEHOLDER__` value is replaced.

## Decision Actions

- `approve`: the candidate answer is correct as written and can become gold.
- `correct`: the candidate is usable only after replacing `correction_messages`.
- `reject`: the candidate should remain auditable but ineligible for training.
- `hold_out`: the candidate should stay out of training and remain available for
  evaluation or later review.

Only `approve` and `correct` can set `approved_by` and `gold_status="gold"`, and
they do that through the builder after the existing governance gates pass.

## Append One Decision

1. Review the candidate in `../review-packages/cv101_review_package.md`.
2. Copy one template to a local scratch file:

```powershell
Copy-Item docs\zta\technician-dataset-v0\review-decisions\templates\approve.techv0-cv101-001.json `
  docs\zta\technician-dataset-v0\review-decisions\decision.local.json
```

3. Replace the placeholders:

- `__REVIEWER_ID__`: the accountable reviewer identity.
- `__RATIONALE__`: the source-backed reason for the decision.
- `__DECIDED_AT_ISO__`: an ISO timestamp, for example
  `2026-07-24T18:00:00Z`.
- Action-specific placeholders such as `__CORRECTED_ASSISTANT_MESSAGE__` or
  `__REJECTION_REASON__`: the actual reviewed content or typed reason.

4. For `correct`, edit `correction_messages` so the full conversation is the
   reviewed replacement. Keep the system and user messages unless the candidate
   itself is wrong; replace the assistant message with the corrected answer.

5. Append the decision:

```powershell
py -3 -m factorylm_ai.dataset.technician_v0 `
  --stage readiness `
  --decisions-path docs/zta/technician-dataset-v0/review-decisions/decisions.jsonl `
  --append-decision docs/zta/technician-dataset-v0/review-decisions/decision.local.json
```

6. Rebuild the reviewed artifacts:

```powershell
py -3 -m factorylm_ai.dataset.technician_v0 `
  --stage readiness `
  --decisions-path docs/zta/technician-dataset-v0/review-decisions/decisions.jsonl `
  --out-dir docs/zta/technician-dataset-v0
```

7. Verify:

```powershell
py -3 -m pytest tests/factorylm_ai/test_technician_dataset_v0.py -q
```

## Guardrails

- A second non-identical decision for the same `record_id` is rejected.
- Exact duplicate decision events are idempotent no-ops.
- If `candidate_manifest_sha256` or `candidate_content_hash` changes, regenerate
  the template from the current manifest before appending.
- Do not approve Drive Commander OEM-derived records unless rights governance
  explicitly changes.
- Do not use `approve` or `correct` for held-out/frozen records; they are
  evaluation-only unless a new candidate manifest explicitly changes their
  split/governance state.
- Do not use `approve` or `correct` for records marked `SAFETY_REVIEW_REQUIRED`
  until the safety review is complete. Use `reject` or `hold_out` instead.
- Review `decisions.jsonl`, `reports/review_decision_report.json`, and
  `reviewed_dataset.jsonl` before committing real decisions.
