# Gate 7 adversarial review — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, security boundaries, cross-repository contract, deletion/destructive, concurrency/idempotency/state, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `4a1fa3b17ee5406d295973348e9e3ca7e0ea6942`
- scope (--paths): docs/
- excluded by scope (9): .github/workflows/ci.yml, mira-crawler/ingest/origins.py, mira-crawler/ingest/store.py, mira-crawler/tests/test_conflict_and_packaging_contracts.py, mira-crawler/tests/test_ingest.py, mira-crawler/tests/test_provenance_policy.py, tests/test_gate7_review.py, tools/gate7_review.py, tools/qa/security/knowledge_entries_read_allowlist.yml
- diff chars sent/total: 291,274/291,274 (cap 320,000)
- reviewed-diff sha256 (sent bytes): `2a480619c16fae14ceb60da8bede0fdaddf5004754c4f0ef42867b9773b420b0`
- full scoped-diff sha256 (pre-cap): `2a480619c16fae14ceb60da8bede0fdaddf5004754c4f0ef42867b9773b420b0`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] False claim that `_read_validated` guard was fixed** — The documentation states that the guard `os.open not in os.supports_dir_fd` has been corrected, yet the PR makes **no code changes** to `mira-crawler/tasks/ingest.py` (or any other file) that modify `_read_validated`.
- **[high] False claim that `ingest_text_inline` signature was changed to keyword‑only `is_private` and all call sites updated** — The doc claims the function signature now requires a keyword‑only `is_private` argument and that *all* callers were updated, but the diff contains **no modifications** to `mira-crawler/tasks/_shared.py` or any caller files.
- **[high] False claim that case‑sensitive URL discovery was fixed** — The documentation asserts a fix for the case‑sensitivity bug in `discover_manifests` (commit `663144a14`) and that a red‑first test now passes, but the PR adds **no change** to `mira-crawler/ingest/origins.py` (or any test file) implementing the lower‑casing fix.
- **[high] False claim that deduplication URL mismatch was fixed** — The doc claims the deduplication logic now consistently uses `final_url`, yet the diff contains **no modifications** to `mira-crawler/tasks/ingest.py` (or related files).
- **[high] False claim that `provenance_policy.yaml` was added** — Multiple sections state that a new file `provenance_policy.yaml` was added in this PR, but the diff does **not** add such a file anywhere in the repository.
- **[high] False claim that new contract tests were added and wired into CI** — The PR references test files such as `mira-crawler/tests/test_conflict_and_packaging_contracts.py` and says they are “wired into the CI crawler slice”, yet **no new or modified test files** appear under `mira-crawler/tests/`. The only evidence is documentation text.
- **[high] Security breach – full repository diff sent to external LLM provider** — The Gate 7 logs record that the entire (or near‑entire) repository diff was transmitted to a third‑party provider, potentially exposing proprietary code or secrets.
- **[high] Contradictory documentation about the status of finding F3 (case‑sensitive URL discovery)** — The same document both labels F3 as **SUSTAINED** (i.e., not fixed) and later as **REFUTED** (i.e., fixed), a direct internal inconsistency that undermines the audit trail.
- **[high] Inclusion of “.log” in documentation suffixes leaks potentially sensitive logs to the LLM** — `tools/gate7_review.py` was changed to treat `.log` files as documentation, causing any log file present in a PR diff to be sent to the external LLM reviewer, violating data‑privacy policies.
- **[high] Source‑URL case‑sensitive uniqueness collides with case‑insensitive URL classification** — The ingest pipeline lower‑cases scheme and host for classification, but the database unique index `idx_ke_chunk_dedup` stores the raw `source_url`, which is case‑sensitive. Historic rows with differing case can coexist, allowing a private row to be duplicated as a public one and exposing private content.

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] False claim that `_read_validated` guard was fixed** — The documentation states that the guard `os.open not in os.supports_dir_fd` has been corrected, yet the PR makes **no code changes** to `mira-crawler/tasks/ingest.py` (or any other file) that modify `_read_validated`.  
  `docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md:5`  
  ```diff
  +**[high] False claim that `_read_validated` guard was fixed** — The documentation asserts that the guard `os.open not in os.supports_dir_fd` has been corrected and that POSIX tests now pass, but the diff contains **no code changes** to `mira-crawler/tasks/ingest.py` (or any other file) that modify `_read_validated`.
  ```

- **[severity: high] False claim that `ingest_text_inline` signature was changed to keyword‑only `is_private` and all call sites updated** — The doc claims the function signature now requires a keyword‑only `is_private` argument and that *all* callers were updated, but the diff contains **no modifications** to `mira-crawler/tasks/_shared.py` or any caller files.  
  `docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md:13`  
  ```diff
  +**[high] False claim that `ingest_text_inline` signature was changed to keyword‑only `is_private` and all call sites updated** — The doc states the function signature was altered and *all* callers were updated, yet the PR adds **no modifications** to `mira-crawler/tasks/_shared.py` or any caller files.
  ```

- **[severity: high] False claim that case‑sensitive URL discovery was fixed** — The documentation asserts a fix for the case‑sensitivity bug in `discover_manifests` (commit `663144a14`) and that a red‑first test now passes, but the PR adds **no change** to `mira-crawler/ingest/origins.py` (or any test file) implementing the lower‑casing fix.  
  `docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md:20`  
  ```diff
  +**[high] False claim that case‑sensitive URL discovery was fixed** — The documentation asserts that the case‑sensitivity bug in `discover_manifests` was fixed in a follow‑up commit (`663144a14`) and that a red‑first test now passes. However, the diff adds only a markdown description; there is **no change** to `mira-crawler/ingest/origins.py` (or any test file) that implements the lower‑casing fix.
  ```

- **[severity: high] False claim that deduplication URL mismatch was fixed** — The doc claims the deduplication logic now consistently uses `final_url`, yet the diff contains **no modifications** to `mira-crawler/tasks/ingest.py` (or related files).  
  `docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md:27`  
  ```diff
  +**[high] False claim that deduplication URL mismatch was fixed** — The doc claims that the deduplication logic now uses `final_url` consistently, but the diff contains **no modifications** to `mira-crawler/tasks/ingest.py` (or related files). The only evidence is:
  ```

- **[severity: high] False claim that `provenance_policy.yaml` was added** — Multiple sections state that a new file `provenance_policy.yaml` was added in this PR, but the diff does **not** add such a file anywhere in the repository.  
  `docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md:34`  
  ```diff
  +**[medium] Claim that `provenance_policy.yaml` was added** — The documentation repeatedly mentions a new file `provenance_policy.yaml` (e.g., “`provenance_policy.yaml` (new in the PR)”), yet the diff does not add such a file anywhere in the repository. No `provenance_policy.yaml` appears in the file list, making the claim unsupported.
  ```

- **[severity: high] False claim that new contract tests were added and wired into CI** — The PR references test files such as `mira-crawler/tests/test_conflict_and_packaging_contracts.py` and says they are “wired into the CI crawler slice”, yet **no new or modified test files** appear under `mira-crawler/tests/`. The only evidence is documentation text.  
  `docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md:38`  
  ```diff
  +**[high] Claim that new contract tests were added and wired into CI** — The diff references test files such as `mira-crawler/tests/test_conflict_and_packaging_contracts.py` and mentions they are “wired into the CI crawler slice”. However, the diff does **not** contain any new or modified test files under `mira-crawler/tests/`. The only evidence is documentation text, e.g.:
  ```

- **[severity: high] Security breach – full repository diff sent to external LLM provider** — The Gate 7 logs record that the entire (or near‑entire) repository diff was transmitted to a third‑party provider, potentially exposing proprietary code or secrets.  
  `docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log:1`  
  ```diff
  +Gate 7: sending 46,416/46,416 diff chars to a third-party provider (redacted: IP/MAC/SN)
  ```

- **[severity: high] Contradictory documentation about the status of finding F3 (case‑sensitive URL discovery)** — The same document both labels F3 as **SUSTAINED** (i.e., not fixed) and later as **REFUTED** (i.e., fixed), a direct internal inconsistency that undermines the audit trail.  
  `docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md:46` (example excerpt)  
  ```diff
  - **[SUSTAINED] F3** [high] URL discovery in `discover_manifests` is case‑sensitive, missing uppercase schemes
  + **[REFUTED] F3** — ... (see round‑12 adjudication)
  ```

- **[severity: high] Inclusion of “.log” in documentation suffixes leaks potentially sensitive logs to the LLM** — `tools/gate7_review.py` was changed to treat `.log` files as documentation, causing any log file present in a PR diff to be sent to the external LLM reviewer, violating data‑privacy policies.  
  `docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md:30`  
  ```diff
  +_DOC_SUFFIXES = (".md", ".markdown", ".rst", ".txt", ".log")
  ```

- **[severity: high] Source‑URL case‑sensitive uniqueness collides with case‑insensitive URL classification** — The ingest pipeline lower‑cases scheme and host for classification, but the database unique index `idx_ke_chunk_dedup` stores the raw `source_url`, which is case‑sensitive. Historic rows with differing case can coexist, allowing a private row to be duplicated as a public one and exposing private content.  
  `docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code.md:4` (function definition)  
  ```diff
  +def canonical_source_url(url: str) -> str:
  +    """Lower‑case ONLY the scheme and the host of ``url``; every other byte —
  +    userinfo, port, path, query, fragment — is preserved exactly as given.
  ```

## NOT REVIEWED
- Runtime behavior of the functions referenced in the false claims (`_read_validated`, `ingest_text_inline`, URL discovery, deduplication) because no code changes are present to evaluate their actual implementation.  
- Whether the alleged proof commits (`663144a14`, `663144a142…`) truly contain the claimed fixes; they are not part of this diff.  
- Existence and contents of `provenance_policy.yaml` elsewhere in the repository (the diff does not add it).  
- Actual CI configuration changes (e.g., wiring of new tests into `.github/workflows/ci.yml`) because no workflow files were modified.  
- Potential downstream impact of the added `canonical_source_url` on existing data migrations or on services that consume the raw `source_url`.  
- Effectiveness of the decision‑point reminder on diff truncation and whether important code could be omitted from the LLM review.  

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
