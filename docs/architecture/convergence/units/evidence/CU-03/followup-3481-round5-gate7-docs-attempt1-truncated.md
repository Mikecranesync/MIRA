# Gate 7 adversarial review — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, cross-repository contract, deletion/destructive, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `92f25b438645b9e100eb3f5b47ca6beb68f5afa7`
- scope (--paths): docs/
- excluded by scope (7): .github/workflows/ci.yml, mira-crawler/ingest/origins.py, mira-crawler/tests/test_conflict_and_packaging_contracts.py, mira-crawler/tests/test_ingest.py, mira-crawler/tests/test_provenance_policy.py, tests/test_gate7_review.py, tools/gate7_review.py
- diff chars sent/total: 170,000/170,702 (cap 170,000)
- reviewed-diff sha256 (sent bytes): `59d4e77488b7b3fe81689d1763024f83933c5205b256d4cda627b0d937d9b335`
- full scoped-diff sha256 (pre-cap): `f432ffe49d56dd7ff76e779066ee3cfa5b339e8bcac6208cd4f3c35bbfe71230`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] False claim that `_read_validated` guard was fixed** — The documentation states that the guard `os.open not in os.supports_dir_fd` has been corrected and that POSIX tests now pass, yet the PR makes **no code changes** to `mira-crawler/tasks/ingest.py` (or any other file) that modify `_read_validated`.
- **[high] False claim that `ingest_text_inline` signature was changed to keyword‑only `is_private` and all call sites were updated** — The documentation claims the function signature now requires a keyword‑only `is_private` argument and that every caller was updated, but the diff contains **no modifications** to `mira-crawler/tasks/_shared.py` or any caller files.
- **[high] False claim that case‑sensitive URL discovery was fixed** — The documentation repeatedly asserts that the case‑sensitivity bug in `discover_manifests` was fixed (referencing commit `663144a14`) and that a red‑first test now passes, but the PR adds **no change** to `mira-crawler/ingest/origins.py` (or any test file) implementing the lower‑casing fix.
- **[high] False claim that deduplication URL mismatch was fixed** — The documentation claims the deduplication logic now consistently uses `final_url`, yet the diff contains **no modifications** to `mira-crawler/tasks/ingest.py` (or related files) that implement such a change.
- **[high] False claim that `provenance_policy.yaml` was added** — Multiple sections state that a new file `provenance_policy.yaml` was added in this PR, but the diff does **not** add such a file anywhere in the repository.
- **[high] False claim that new contract tests were added and wired into CI** — The PR references test files such as `mira-crawler/tests/test_conflict_and_packaging_contracts.py` and asserts they are “wired into the CI crawler slice”, yet **no new or modified test files** appear under `mira-crawler/tests/` in the diff. The only evidence for these tests is documentation text.
- **[high] Security breach – full repository diff sent to external LLM provider** — The review logs explicitly record that the entire (or near‑entire) repository diff was transmitted to a third‑party provider, exposing proprietary source code (including potentially secret material) to an unauthenticated external service.
- **[high] Contradictory documentation about the status of finding F3 (case‑sensitive URL discovery)** — The document alternately states that F3 was **sustained** (i.e., not fixed) and later that it was **refuted** (i.e., fixed). This internal inconsistency undermines the reliability of the audit trail.

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] False claim that `_read_validated` guard was fixed** — The documentation states that the guard `os.open not in os.supports_dir_fd` has been corrected and that POSIX tests now pass, yet the PR makes **no code changes** to `mira-crawler/tasks/ingest.py` (or any other file) that modify `_read_validated`.  
  ```diff
  - **[high] False claim that `_read_validated` guard was fixed** — The documentation asserts that the guard `os.open not in os.supports_dir_fd` has been corrected and that POSIX tests now pass, but the diff contains **no code changes** to `mira-crawler/tasks/ingest.py` (or any other file) that modify `_read_validated`. The only evidence is a documentation line:
  ```

- **[severity: high] False claim that `ingest_text_inline` signature was changed to keyword‑only `is_private` and all call sites were updated** — The documentation claims the function signature now requires a keyword‑only `is_private` argument and that every caller was updated, but the diff contains **no modifications** to `mira-crawler/tasks/_shared.py` or any caller files.  
  ```diff
  - **[high] False claim that `ingest_text_inline` signature was changed to keyword‑only `is_private` and all call sites were updated** — The doc states the function signature was altered and *all* callers were updated, yet the PR adds **no modifications** to `mira-crawler/tasks/_shared.py` or any caller files.
  ```

- **[severity: high] False claim that case‑sensitive URL discovery was fixed** — The documentation repeatedly asserts that the case‑sensitivity bug in `discover_manifests` was fixed (referencing commit `663144a14`) and that a red‑first test now passes, but the PR adds **no change** to `mira-crawler/ingest/origins.py` (or any test file) implementing the lower‑casing fix.  
  ```diff
  - **[high] False claim that case‑sensitive URL discovery was fixed** — The documentation asserts that the case‑sensitivity bug in `discover_manifests` was fixed in a follow‑up commit (`663144a14`) and that a red‑first test now passes. However, the diff adds only a markdown description; there is **no change** to `mira-crawler/ingest/origins.py` (or any test file) that implements the lower‑casing fix.
  ```

- **[severity: high] False claim that deduplication URL mismatch was fixed** — The documentation claims the deduplication logic now consistently uses `final_url`, yet the diff contains **no modifications** to `mira-crawler/tasks/ingest.py` (or related files) that implement such a change.  
  ```diff
  - **[high] False claim that deduplication URL mismatch was fixed** — The doc claims that the deduplication logic now uses `final_url` consistently, but the diff contains **no modifications** to `mira-crawler/tasks/ingest.py` (or related files). The only evidence is:
  ```

- **[severity: high] False claim that `provenance_policy.yaml` was added** — Multiple sections state that a new file `provenance_policy.yaml` was added in this PR, but the diff does **not** add such a file anywhere in the repository.  
  ```diff
  - **[medium] Claim that `provenance_policy.yaml` was added** — The documentation repeatedly mentions a new file `provenance_policy.yaml` (e.g., “`provenance_policy.yaml` (new in the PR)”), yet the diff does not add such a file anywhere in the repository. No `provenance_policy.yaml` appears in the file list, making the claim unsupported.
  ```

- **[severity: high] False claim that new contract tests were added and wired into CI** — The PR references test files such as `mira-crawler/tests/test_conflict_and_packaging_contracts.py` and asserts they are “wired into the CI crawler slice”, yet **no new or modified test files** appear under `mira-crawler/tests/` in the diff. The only evidence for these tests is documentation text.  
  ```diff
  - **[high] Claim that new contract tests were added and wired into CI** — The diff references test files such as `mira-crawler/tests/test_conflict_and_packaging_contracts.py` and mentions they are “wired into the CI crawler slice”. However, the diff does **not** contain any new or modified test files under `mira-crawler/tests/`. The only evidence is documentation text, e.g.:
  ```

- **[severity: high] Security breach – full repository diff sent to external LLM provider** – The review logs explicitly record that the entire (or near‑entire) repository diff was transmitted to a third‑party provider, exposing proprietary source code (including potentially secret material) to an unauthenticated external service.  
  ```diff
  +Gate 7: sending 46,416/46,416 diff chars to a third-party provider (redacted: IP/MAC/SN)
  +Gate 7: sending 130,000/147,236 diff chars to a third-party provider (redacted: IP/MAC/SN) — TRUNCATED
  ```

- **[severity: high] Contradictory documentation about the status of finding F3 (case‑sensitive URL discovery)** – The document alternately states that F3 was **sustained** (i.e., not fixed) and later that it was **refuted** (i.e., fixed). This internal inconsistency undermines the reliability of the audit trail.  
  ```diff
  - **[SUSTAINED] F3** [high] URL discovery in `discover_manifests` is case‑sensitive, missing uppercase schemes
  + **[REFUTED] F3** — ... (see round‑12 adjudication)
  ```

## NOT REVIEWED
- Whether the alleged proof commits (`663144a14`, `663144a142...`) actually contain the claimed code fixes, since they are not part of the diff.
- The true runtime behaviour of `_read_validated`, `ingest_text_inline`, and URL discovery after any upstream changes that are not visible here.
- The existence and contents of a `provenance_policy.yaml` file elsewhere in the repository (outside this diff) and its impact on policy enforcement.
- Whether the CI workflow (`.github/workflows/ci.yml`) was truly updated to execute the purported new tests, given that no test files appear in the diff.
- Potential downstream effects of the missing `is_private` keyword on any call sites outside the diff scope.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
