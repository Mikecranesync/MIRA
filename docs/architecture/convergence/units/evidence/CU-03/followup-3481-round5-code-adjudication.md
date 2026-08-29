# Gate 7 adjudication — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Adjudicator:** groq (openai/gpt-oss-120b)
**Prior findings:** 2 · **Rulings:** 2 (sustained: 1)

> Verdict is computed structurally: rulings must be an exact bijection onto the
> prior findings by stable id; severity comes from the parsed prior report, never
> the adjudicator; any SUSTAINED high ⇒ BLOCK; any duplicate/unknown/missing/extra
> id ⇒ UNKNOWN. Both phases are preserved intact as evidence.

## Run receipts

- head: `92f25b438645b9e100eb3f5b47ca6beb68f5afa7`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (31): docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 37,640/37,640 (cap 40,000)
- reviewed-diff sha256 (sent bytes): `e9e160476a41c6ac0881630cfbe705fd61b4975442b5f6fe69437f419e9a4ac2`
- full scoped-diff sha256 (pre-cap): `e9e160476a41c6ac0881630cfbe705fd61b4975442b5f6fe69437f419e9a4ac2`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Prior findings (structural ids)

- F1 [high] Source‑URL case‑sensitive uniqueness collides with case‑insensitive URL classification
- F2 [medium] PyYAML‑missing‑dependency test may give a false‑green

## Rulings

- **[SUSTAINED] F1** [high] Source‑URL case‑sensitive uniqueness collides with case‑insensitive URL classification
- **[REFUTED] F2** [medium] PyYAML‑missing‑dependency test may give a false‑green

## Raw adjudication

## RULINGS
- **[ruling: SUSTAINED] [id: F1]** — the diff only adds case‑insensitive URL detection (`origins._urls_in` lower‑cases the scheme) and tests for classification, but it does not canonicalise `source_url` before insertion nor modify the case‑sensitive unique index `idx_ke_chunk_dedup`, so duplicate rows with differing case can still be created.
- **[ruling: REFUTED] [id: F2]** — the new test `test_missing_pyyaml_is_a_refused_write_not_a_task_abort` clears `provenance._POLICY`, patches `sys.modules["yaml"] = None`, and asserts `ok is False` with “fail closed” in the reason, proving that a missing PyYAML triggers a refused write rather than a false‑green.

## VERDICT
BLOCK

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
