# Gate 7 adversarial review — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, security boundaries, cross-repository contract, deletion/destructive, concurrency/idempotency/state, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `085a1b909cb6d7a560d290df318330c2bb86ee22`
- scope (--paths): docs/
- excluded by scope (9): .github/workflows/ci.yml, mira-crawler/ingest/origins.py, mira-crawler/ingest/store.py, mira-crawler/tests/test_conflict_and_packaging_contracts.py, mira-crawler/tests/test_ingest.py, mira-crawler/tests/test_provenance_policy.py, tests/test_gate7_review.py, tools/gate7_review.py, tools/qa/security/knowledge_entries_read_allowlist.yml
- diff chars sent/total: 67,437/67,437 (cap 150,000)
- reviewed-diff sha256 (sent bytes): `6468b1a277e95d6a688759757ac5d392e5ac92f65056ce07fb68df824957a3e8`
- full scoped-diff sha256 (pre-cap): `6468b1a277e95d6a688759757ac5d392e5ac92f65056ce07fb68df824957a3e8`
- requested reasoning_effort: high (see Cascade attempts for what was sent)
- evidence artifacts excluded from review (raw reviewer output / logs under units/evidence/, not author claims; --include-evidence keeps them) (63): docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-code-explain-pg16.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log

## Findings

- **[high] Documentation claims a code fix in `mira-crawler/ingest/origins.py` that lower‑cases scheme** — and** host, yet the PR diff contains **no modifications** to that file.**
- **[high] Documentation asserts that the `canonical_source_url` function now lower‑cases** — only** scheme and host and that this change is applied in *both* constructors of the deduplication key, but the PR diff does not modify `mira-crawler/ingest/store.py` (or any other source file).**
- **[high] The PR states that a new contract test file `test_conflict_and_packaging_contracts.py` has been added and wired into CI, yet the diff adds** — no** such file.**
- **[medium] Documentation repeats the claim that the `_read_validated` guard bug (R12‑F1) has been refuted, yet the only supporting evidence is a citation of a prior adjudication artifact, not a present‑tense assertion backed by code changes or new tests in this PR.** — 

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Documentation claims a code fix in `mira-crawler/ingest/origins.py` that lower‑cases scheme **and** host, yet the PR diff contains **no modifications** to that file.**  
  *Evidence:*  
  ```diff
  +**R12-F3 SUSTAINED at `fc00074c6` → root‑fixed IN THIS PR.** `_urls_in` matched only lowercase
  +schemes, so the CI consistency proof could miss a `HTTPS://…` manifest constant. Consequence
  +narrowed (the gate lowercases scheme and host and refuses/forces‑private an unclassified origin;
  +`ingest/origins.py` is imported only by the test). The fix is a `+` line of THIS PR's diff in
  +`mira-crawler/ingest/origins.py` (`n.value.lower().startswith(...)`, commit `663144a14`), red‑first
  +(`test_discovery_matches_url_constants_case_insensitively`).
  ```
  The only file changed in this PR is `docs/architecture/convergence/units/CU-03.md`. No `+` lines for `mira-crawler/ingest/origins.py` appear in the diff, contradicting the claim that the fix is a `+` line of this PR. This mis‑statement gives a false impression that a security‑critical case‑sensitivity bug has been fixed when it has not.

- **[severity: high] Documentation asserts that the `canonical_source_url` function now lower‑cases **only** scheme and host and that this change is applied in *both* constructors of the deduplication key, but the PR diff does not modify `mira-crawler/ingest/store.py` (or any other source file).**  
  *Evidence:*  
  ```diff
  +**F1 → fixed at the root.** `ingest/store.py::canonical_source_url` lower‑cases ONLY the scheme and
  +host (userinfo, port, path, query, fragment byte‑exact; IPv6 literals, `file:/x`,
  +bare paths and Windows drive letters handled) and is applied inside **both** constructors of the
  +dedup key — `chunk_exists` before lookup and `insert_chunk` before provenance and binding — so
  +every crawler path that builds the key (`store_chunks`, `tasks/_shared.py`, `tasks/ingest.py`)
  +writes and looks up one canonical string. [...]
  ```
  No changes to `ingest/store.py` are present in the diff. The claim that the fix is part of “this PR” is therefore unsupported. Relying on this undocumented change could allow duplicate rows with differing `is_private` flags, a potential data‑corruption and privacy breach.

- **[severity: high] The PR states that a new contract test file `test_conflict_and_packaging_contracts.py` has been added and wired into CI, yet the diff adds **no** such file.**  
  *Evidence:*  
  ```diff
  +**F3 — "False claim that case‑sensitive URL discovery was fixed" (cites `followup-3481-gate7-docs.md:20`)**
  +...
  +**F6 — "False claim that new contract tests were added and wired into CI"**
  +...
  ```
  The only file changed is `docs/architecture/convergence/units/CU-03.md`; there is no `+` entry for `mira-crawler/tests/test_conflict_and_packaging_contracts.py`. The documentation’s assertion that this test exists and is exercised by the CI pipeline is therefore inaccurate, obscuring the actual test coverage.

- **[severity: medium] Documentation repeats the claim that the `_read_validated` guard bug (R12‑F1) has been refuted, yet the only supporting evidence is a citation of a prior adjudication artifact, not a present‑tense assertion backed by code changes or new tests in this PR.**  
  *Evidence:*  
  ```diff
  +**R12‑F1 REFUTED** — `os.supports_dir_fd` is a `set` (measured: Linux 3.12.3 `os.open in
  ```
  No code modifications or new tests concerning `_read_validated` appear in the diff, so the PR offers no concrete proof that the guard behaves correctly on all platforms. While the existing test suite may already cover this, the claim is unsupported by any artifact in the PR itself.

## NOT REVIEWED
- **Runtime behavior of the actual codebase** (e.g., whether `canonical_source_url` truly lower‑cases scheme and host, or whether duplicate rows can still arise from path‑case differences) cannot be verified from this diff alone because no source files are changed.  
- **Effectiveness of existing CI tests** for the guard in `_read_validated` or for the case‑sensitivity of URL discovery is not assessable here; we would need to run the full test suite against the repository at the target head.  
- **Potential tenant‑scoping or security‑boundary regressions** in the unchanged production code are outside the scope of this documentation‑only PR and thus not examined.  
- **The review‑lane changes referenced (e.g., artifact‑exclusion fixes in rounds H/I)** are not part of the repository code and cannot be validated; they are merely claims about the lane tooling.  

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
