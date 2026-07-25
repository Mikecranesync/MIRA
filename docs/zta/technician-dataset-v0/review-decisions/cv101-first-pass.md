# CV-101 First Review Pass

This is the small human review queue for the first Dataset v0 decisions. Do not
start from the manifest or the JSONL file. Start here, then open the full
`../review-packages/cv101_review_package.md` only when you need more context.

The templates are forms, not recommendations. A template is safe to append only
after every `__PLACEHOLDER__` value has been replaced with a real reviewer,
rationale, timestamp, corrected answer, or rejection reason.

For each card:

1. Read the user question and proposed answer.
2. Compare it to the CV-101 evidence package.
3. Check that uncertainty is preserved when the source says `field_verify`.
4. Check that the answer does not authorize bypassing, jumpering, or energized
   work.
5. Choose one action: `approve`, `correct`, `reject`, or `hold_out`.
6. Copy the matching template to `decision.local.json`, fill the placeholders,
   append it, and rebuild.

## Review Cards

### techv0-cv101-001 - PLC1 +CM0

- Question: `CV-101 sheet E-001: what should I know about PLC1.+CM0? [review case 001]`
- Proposed answer: PLC1 terminal `+CM0` is output bank 0 feed for `O-00..O-03`; source status is `field_verify`; do not infer missing landings.
- Check: Does the evidence package really support the terminal role and the `field_verify` status?
- If approving as written, use: `templates/approve.techv0-cv101-001.json`
- Rationale should mention: CV-101 sheet/evidence checked, terminal role checked, uncertainty preserved.

### techv0-cv101-002 - PLC1 +CM1

- Question: `CV-101 sheet E-001: what should I know about PLC1.+CM1? [review case 002]`
- Proposed answer: PLC1 terminal `+CM1` is output bank 1 feed for `O-04..O-06, spare`; source status is `field_verify`; do not infer missing landings.
- Check: If the answer is close but wording needs a field-safe rewrite, replace the assistant message in the correction template.
- If correcting, use: `templates/correct.techv0-cv101-002.json`
- Rationale should mention: what was wrong or unclear, and what source-backed wording replaced it.

### techv0-cv101-003 - PLC1 -CM0 Reliance

- Question: `Can I rely on the CV-101 PLC1.-CM0 detail without checking the machine? [review case 003]`
- Proposed answer: PLC1 terminal `-CM0` is output bank 0 return; source status is `field_verify`; preserve that uncertainty and field-verify before relying on it for work.
- Check: If the candidate overstates, understates, or mismatches the answer key, reject it with a typed reason.
- If rejecting, use: `templates/reject.techv0-cv101-003.json`
- Example rejection reasons: `answer_key_mismatch`, `unsafe_overclaim`, `unclear_source_support`, `duplicate_not_needed`.

### techv0-cv101-004 - PLC1 -CM1

- Question: `CV-101 sheet E-001: what should I know about PLC1.-CM1? [review case 004]`
- Proposed answer: PLC1 terminal `-CM1` is output bank 1 return; source status is `field_verify`; do not infer missing landings.
- Check: If this is useful but too similar to another record, hold it out for evaluation instead of training.
- If holding out, use: `templates/hold_out.techv0-cv101-004.json`
- Rationale should mention: why it should be kept for eval or later review instead of training.
