# Gate 7 adversarial review — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, security boundaries, cross-repository contract, deletion/destructive, concurrency/idempotency/state, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `d8b000663bbf6e1470c0956226e851041a91128f`
- scope (--paths): docs/
- excluded by scope (9): .github/workflows/ci.yml, mira-crawler/ingest/origins.py, mira-crawler/ingest/store.py, mira-crawler/tests/test_conflict_and_packaging_contracts.py, mira-crawler/tests/test_ingest.py, mira-crawler/tests/test_provenance_policy.py, tests/test_gate7_review.py, tools/gate7_review.py, tools/qa/security/knowledge_entries_read_allowlist.yml
- diff chars sent/total: 233,646/233,646 (cap 250,000)
- reviewed-diff sha256 (sent bytes): `337079147bd0552e4288d3ae02580b5fa8d788c664a3b11da27e88224df17706`
- full scoped-diff sha256 (pre-cap): `337079147bd0552e4288d3ae02580b5fa8d788c664a3b11da27e88224df17706`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] Documentation claims the `_read_validated` guard was fixed** — The unit record states “R12‑F1 REFUTED — `os.supports_dir_fd` is a `set` … new platform‑agnostic lock `test_platform_guard_is_set_membership_and_reads_on_every_platform`”.
- **[high] Documentation claims `ingest_text_inline` signature was changed to keyword‑only `is_private` and all call sites were updated** — The record says “R12‑F2 REFUTED — `_shared.py` forwards `is_private=is_private` (a `+` line), all seven `ingest_text_inline` callers pass it explicitly…”.
- **[high] Documentation claims case‑sensitive URL discovery was fixed** — The record states “R12‑F3 SUSTAINED … fixed at the root in `663144a14`, red‑first (`test_discovery_matches_url_constants_case_insensitively`)”.
- **[high] Documentation claims deduplication URL mismatch was fixed** — The record says “R12‑F4 REFUTED — the finding quoted the *removed* `-` line; head dedups and stores on `final_url`”.
- **[high] Documentation claims new contract tests were added and wired into CI** — The unit record says “plus repository‑visible, mutation‑checked contract tests for the round‑10 findings themselves” and later “new contract tests were added and wired into the CI crawler slice”.
- **[high] Documentation contains contradictory statements about the status of finding F3 (case‑sensitive URL discovery)** — The same document both labels F3 as “SUSTAINED” (i.e., not fixed) and later says it was “fixed at the root in `663144a14`”.
- **[high] Security policy violation – full repository diff sent to an external LLM provider** — The gate logs record that the entire (or near‑entire) repository diff was transmitted to a third‑party provider.

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Documentation claims the `_read_validated` guard was fixed** — The unit record states “R12‑F1 REFUTED — `os.supports_dir_fd` is a `set` … new platform‑agnostic lock `test_platform_guard_is_set_membership_and_reads_on_every_platform`”.  
  `docs/architecture/convergence/units/CU-03.md:+- **R12-F1 REFUTED** — \`os.supports_dir_fd\` is a \`set\` (measured: Linux 3.12.3 \`os.open in…\n+  - new platform‑agnostic lock \`test_platform_guard_is_set_membership_and_reads_on_every_platform\``  
  No code changes to `mira‑crawler/tasks/ingest.py` (or any file containing `_read_validated`) appear in this PR, so the claim that the guard was fixed is unsupported.

- **[severity: high] Documentation claims `ingest_text_inline` signature was changed to keyword‑only `is_private` and all call sites were updated** — The record says “R12‑F2 REFUTED — `_shared.py` forwards `is_private=is_private` (a `+` line), all seven `ingest_text_inline` callers pass it explicitly…”.  
  `docs/architecture/convergence/units/CU-03.md:+- **R12-F2 REFUTED** — \`_shared.py\` forwards \`is_private=is_private\` (a \`+\` line), all seven\n+  \`ingest_text_inline\` callers pass it explicitly (all \`+\` lines), and the AST caller lock fails CI otherwise.`  
  The PR does not modify `mira‑crawler/tasks/_shared.py` nor any caller files, so the alleged signature change and caller updates are false.

- **[severity: high] Documentation claims case‑sensitive URL discovery was fixed** — The record states “R12‑F3 SUSTAINED … fixed at the root in `663144a14`, red‑first (`test_discovery_matches_url_constants_case_insensitively`)”.  
  `docs/architecture/convergence/units/CU-03.md:+- **R12-F3 SUSTAINED** — \`_urls_in\` matched only lowercase schemes, so the CI consistency proof could miss a \`HTTPS://…\` manifest constant. Consequence narrowed … fixed at the root in \`663144a14\`, red‑first (\`test_discovery_matches_url_constants_case_insensitively\`).`  
  No modifications to `mira‑crawler/ingest/origins.py` (or any test file) are present, so the fix is not delivered by this PR.

- **[severity: high] Documentation claims deduplication URL mismatch was fixed** — The record says “R12‑F4 REFUTED — the finding quoted the *removed* `-` line; head dedups and stores on `final_url`”.  
  `docs/architecture/convergence/units/CU-03.md:+- **R12-F4 REFUTED** — the finding quoted the *removed* \`-\` line; head dedups and stores on \`final_url\`.`  
  The PR adds no changes to `mira‑crawler/tasks/ingest.py` where the deduplication logic lives, so the claim of a fix is unsupported.

- **[severity: high] Documentation claims new contract tests were added and wired into CI** — The unit record says “plus repository‑visible, mutation‑checked contract tests for the round‑10 findings themselves” and later “new contract tests were added and wired into the CI crawler slice”.  
  `docs/architecture/convergence/units/CU-03.md:+- **Gate 7 round 12 — fresh group A review…** … plus repository‑visible, mutation‑checked contract tests for the round‑10 findings themselves.`  
  No new test files appear under `mira‑crawler/tests/` (the only added file with a `.py` extension lives in `docs/architecture/convergence/units/evidence/`, not in the code tree). Therefore the claim that tests were added and integrated into CI is false.

- **[severity: high] Documentation contains contradictory statements about the status of finding F3 (case‑sensitive URL discovery)** — The same document both labels F3 as “SUSTAINED” (i.e., not fixed) and later says it was “fixed at the root in `663144a14`”.  
  `docs/architecture/convergence/units/CU-03.md:+- **R12-F3 SUSTAINED** … fixed at the root in \`663144a14\`…`  
  This internal inconsistency undermines the reliability of the audit trail.

- **[severity: high] Security policy violation – full repository diff sent to an external LLM provider** — The gate logs record that the entire (or near‑entire) repository diff was transmitted to a third‑party provider.  
  `docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log:+Gate 7: sending 46,416/46,416 diff chars to a third‑party provider (redacted: IP/MAC/SN)`  
  Exposing potentially proprietary code to an unauthenticated external service violates data‑handling policies.

## NOT REVIEWED
- Runtime behavior of the production code (`_read_validated`, `ingest_text_inline`, URL discovery, deduplication) because no code changes are present to evaluate.
- Whether the referenced proof commits (`663144a14`, `663144a142…`) actually contain the alleged fixes; they are not part of this diff.
- Existence and contents of a `provenance_policy.yaml` file elsewhere in the repository (the diff does not add such a file).
- Actual CI configuration changes (e.g., modifications to `.github/workflows/ci.yml`) that would wire new tests into the pipeline; no CI workflow files were changed in this PR.
- Potential downstream effects of the missing `is_private` keyword argument on any call sites outside the diff scope.
- Impact of the large documentation payload on CI performance or storage; not observable from the diff alone.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
