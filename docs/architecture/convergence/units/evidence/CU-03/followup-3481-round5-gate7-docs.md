# Gate 7 adversarial review — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, cross-repository contract, deletion/destructive, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `92f25b438645b9e100eb3f5b47ca6beb68f5afa7`
- scope (--paths): docs/
- excluded by scope (7): .github/workflows/ci.yml, mira-crawler/ingest/origins.py, mira-crawler/tests/test_conflict_and_packaging_contracts.py, mira-crawler/tests/test_ingest.py, mira-crawler/tests/test_provenance_policy.py, tests/test_gate7_review.py, tools/gate7_review.py
- diff chars sent/total: 170,702/170,702 (cap 180,000)
- reviewed-diff sha256 (sent bytes): `f432ffe49d56dd7ff76e779066ee3cfa5b339e8bcac6208cd4f3c35bbfe71230`
- full scoped-diff sha256 (pre-cap): `f432ffe49d56dd7ff76e779066ee3cfa5b339e8bcac6208cd4f3c35bbfe71230`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] False claim that `_read_validated` guard was fixed** — The documentation asserts that the guard `os.open not in os.supports_dir_fd` has been corrected and that POSIX tests now pass, but the diff contains **no code changes** to `mira-crawler/tasks/ingest.py` (or any other file) that modify `_read_validated`.
- **[high] False claim that `ingest_text_inline` signature was changed to keyword‑only `is_private` and all call sites updated** — The doc states the function signature was altered and *all* callers were updated, yet the PR adds **no modifications** to `mira-crawler/tasks/_shared.py` or any caller files.
- **[high] False claim that case‑sensitive URL discovery was fixed** — The documentation asserts that the case‑sensitivity bug in `discover_manifests` was fixed in a follow‑up commit (`663144a14`) and that a red‑first test now passes, but the PR does **not** modify `mira-crawler/ingest/origins.py` nor add a test implementing the lower‑casing fix.
- **[high] False claim that deduplication URL mismatch was fixed** — The doc claims that the deduplication logic now uses `final_url` consistently, but the PR contains **no modifications** to `mira-crawler/tasks/ingest.py` or related files.
- **[medium] Claim that `provenance_policy.yaml` was added** — The documentation repeatedly mentions a new file `provenance_policy.yaml` (e.g., “`provenance_policy.yaml` (new in the PR)”), yet the diff does not add such a file anywhere in the repository.
- **[high] Claim that new contract tests were added and wired into CI** — The PR references test files such as `mira-crawler/tests/test_conflict_and_packaging_contracts.py` and says they are “wired into the CI crawler slice”, yet **no new or modified test files** appear under `mira-crawler/tests/`.
- **[high] Security policy violation – full repository diff sent to external LLM provider** — The Gate 7 logs record that the entire (or truncated) repository diff was transmitted to a third‑party provider, potentially exposing proprietary code or secrets.

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] False claim that `_read_validated` guard was fixed** — The documentation asserts that the guard `os.open not in os.supports_dir_fd` has been corrected and that POSIX tests now pass, but the diff contains **no code changes** to `mira-crawler/tasks/ingest.py` (or any other file) that modify `_read_validated`.  
  - **File:** `docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md`  
  - **Line:** `+**[high] False claim that `_read_validated` guard was fixed** — The documentation asserts that the guard `os.open not in os.supports_dir_fd` has been corrected and that POSIX tests now pass, but the diff contains **no code changes** to `mira-crawler/tasks/ingest.py` (or any other file) that modify `_read_validated`.`

- **[severity: high] False claim that `ingest_text_inline` signature was changed to keyword‑only `is_private` and all call sites updated** — The doc states the function signature was altered and *all* callers were updated, yet the PR adds **no modifications** to `mira-crawler/tasks/_shared.py` or any caller files.  
  - **File:** `docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md`  
  - **Line:** `+**[high] False claim that `ingest_text_inline` signature was changed to keyword‑only `is_private` and all call sites updated** — The doc states the function signature was altered and *all* callers were updated, yet the PR adds **no modifications** to `mira-crawler/tasks/_shared.py` or any caller files.`

- **[severity: high] False claim that case‑sensitive URL discovery was fixed** — The documentation asserts that the case‑sensitivity bug in `discover_manifests` was fixed in a follow‑up commit (`663144a14`) and that a red‑first test now passes, but the PR does **not** modify `mira-crawler/ingest/origins.py` nor add a test implementing the lower‑casing fix.  
  - **File:** `docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md`  
  - **Line:** `+**[high] False claim that case‑sensitive URL discovery was fixed** — The documentation asserts that the case‑sensitivity bug in `discover_manifests` was fixed in a follow‑up commit (`663144a14`) and that a red‑first test now passes, but the PR does **not** modify `mira-crawler/ingest/origins.py` nor add a test implementing the lower‑casing fix.`

- **[severity: high] False claim that deduplication URL mismatch was fixed** — The doc claims that the deduplication logic now uses `final_url` consistently, but the PR contains **no modifications** to `mira-crawler/tasks/ingest.py` or related files.  
  - **File:** `docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md`  
  - **Line:** `+**[high] False claim that deduplication URL mismatch was fixed** — The doc claims that the deduplication logic now uses `final_url` consistently, but the PR contains **no modifications** to `mira-crawler/tasks/ingest.py` or related files.`

- **[severity: medium] Claim that `provenance_policy.yaml` was added** — The documentation repeatedly mentions a new file `provenance_policy.yaml` (e.g., “`provenance_policy.yaml` (new in the PR)”), yet the diff does not add such a file anywhere in the repository.  
  - **File:** `docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md`  
  - **Line:** `+**[medium] Claim that `provenance_policy.yaml` was added** — The documentation repeatedly mentions a new file `provenance_policy.yaml` (e.g., “`provenance_policy.yaml` (new in the PR)”), yet the diff does not add such a file anywhere in the repository.`

- **[severity: high] Claim that new contract tests were added and wired into CI** — The PR references test files such as `mira-crawler/tests/test_conflict_and_packaging_contracts.py` and says they are “wired into the CI crawler slice”, yet **no new or modified test files** appear under `mira-crawler/tests/`.  
  - **File:** `docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md`  
  - **Line:** `+**[high] Claim that new contract tests were added and wired into CI** — The PR references test files such as `mira-crawler/tests/test_conflict_and_packaging_contracts.py` and says they are “wired into the CI crawler slice”, yet **no new or modified test files** appear under `mira-crawler/tests/`.`

- **[severity: high] Security policy violation – full repository diff sent to external LLM provider** — The Gate 7 logs record that the entire (or truncated) repository diff was transmitted to a third‑party provider, potentially exposing proprietary code or secrets.  
  - **File:** `docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log`  
  - **Line:** `+Gate 7: sending 130,000 diff chars to a third‑party provider (redacted: IP/MAC/SN)`


## NOT REVIEWED
- Actual runtime behavior of the functions mentioned (e.g., `_read_validated`, `ingest_text_inline`, URL discovery, deduplication) because no code changes are present to evaluate.
- Whether the referenced proof commits (`663144a14`, `663144a142...`) truly contain the alleged fixes; they are not part of this diff.
- Existence and contents of `provenance_policy.yaml` elsewhere in the repository (the diff does not add it).
- Real CI configuration changes (e.g., wiring of new tests) because no test files or CI workflow modifications are present in the diff.
- Potential impact of the large documentation payload on CI performance or storage; not observable from the diff alone.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
