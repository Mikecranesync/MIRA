# Gate 7 adversarial review — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, security boundaries, cross-repository contract, deletion/destructive, concurrency/idempotency/state, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `be9e41107e04b638148b76d1072c68249764eb81`
- scope (--paths): docs/
- excluded by scope (9): .github/workflows/ci.yml, mira-crawler/ingest/origins.py, mira-crawler/ingest/store.py, mira-crawler/tests/test_conflict_and_packaging_contracts.py, mira-crawler/tests/test_ingest.py, mira-crawler/tests/test_provenance_policy.py, tests/test_gate7_review.py, tools/gate7_review.py, tools/qa/security/knowledge_entries_read_allowlist.yml
- diff chars sent/total: 62,856/62,856 (cap 150,000)
- reviewed-diff sha256 (sent bytes): `5d619c75bffe620059a9759f8fed055c221261cec082157c027f1c03f015ec6c`
- full scoped-diff sha256 (pre-cap): `5d619c75bffe620059a9759f8fed055c221261cec082157c027f1c03f015ec6c`
- requested reasoning_effort: high (see Cascade attempts for what was sent)
- evidence artifacts excluded from review (raw reviewer output / logs under units/evidence/, not author claims; --include-evidence keeps them) (55): docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-code-explain-pg16.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log

## Findings

- **[high] False claim that a code fix is included in this PR** — The unit record (CU‑03.md) states:

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] False claim that a code fix is included in this PR** — The unit record (CU‑03.md) states:

  > “the fix is a `+` line of **THIS PR's diff** in `mira-crawler/ingest/origins.py` (`n.value.lower().startswith(...)`, commit `663144a14`)”

  However, the diff for this PR only touches documentation files:

  ```
  diff --git a/docs/architecture/convergence/units/CU-03.md b/docs/architecture/convergence/units/CU-03.md
  diff --git a/docs/architecture/convergence/units/evidence/CU-03/README.md b/docs/architecture/convergence/units/evidence/CU-03/README.md
  diff --git a/docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md b/docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md
  …
  ```

  No `mira-crawler/ingest/origins.py` (or any other source file) appears in the change list, nor is there any `+` line adding `n.value.lower().startswith(...)`. The only mention of that line is in the documentation claim itself. Consequently, the alleged security‑critical fix (making URL discovery case‑insensitive) does **not** exist in this PR, leaving the underlying case‑sensitivity bug unpatched. This mis‑statement is a high‑severity defect because it misleads reviewers and downstream processes into believing a vulnerability has been mitigated when it has not.

## NOT REVIEWED
- Runtime behavior of the unchanged `mira-crawler/ingest/origins.py` (the case‑sensitivity bug remains untested in this PR).  
- Potential interactions with other modules that rely on URL canonicalisation; without the code change present, we cannot verify that no tenant‑scoping or data‑corruption issues arise.  

*Class of defect the PR’s own tests would be structurally unable to catch*: because the PR contains **no code changes or test code**, any functional regression (e.g., the lingering case‑sensitivity bug) cannot be detected by the PR’s test suite. The documentation claims a fix without providing the corresponding implementation, so the test suite cannot validate the fix’s existence.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
