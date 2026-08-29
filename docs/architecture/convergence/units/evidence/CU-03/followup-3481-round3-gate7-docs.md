# Gate 7 adversarial review — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, cross-repository contract, deletion/destructive, forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `611705cc5116a07c672b6a8e5cdf4b039ad94015`
- scope (--paths): docs/
- excluded by scope (6): .github/workflows/ci.yml, mira-crawler/ingest/origins.py, mira-crawler/tests/test_conflict_and_packaging_contracts.py, mira-crawler/tests/test_ingest.py, mira-crawler/tests/test_provenance_policy.py, tests/test_gate7_review.py
- diff chars sent/total: 87,719/87,719 (cap 100,000)
- reviewed-diff sha256 (sent bytes): `1a2ca9c6ed86cabe6157ec8dc80cd6f44ea4a44b29f396a1ccedb0025d7c245a`
- full scoped-diff sha256 (pre-cap): `1a2ca9c6ed86cabe6157ec8dc80cd6f44ea4a44b29f396a1ccedb0025d7c245a`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] False claim that `_read_validated` guard was fixed** — The documentation asserts that the guard `os.open not in os.supports_dir_fd` has been corrected and that POSIX tests now pass, but the PR contains **no code changes** to `mira-crawler/tasks/ingest.py` (or any other file) that modify `_read_validated`.
- **[high] False claim that `ingest_text_inline` signature was changed to keyword‑only `is_private` and all call sites updated** — The doc states the function signature was altered and *all* callers were updated, yet the PR adds **no modifications** to `mira-crawler/tasks/_shared.py` or any caller files.
- **[high] False claim that case‑sensitive URL discovery was fixed** — The documentation asserts a fix for the case‑sensitivity bug in `discover_manifests` (commit `663144a14`) and that a red‑first test now passes, but the PR does **not** modify `mira-crawler/ingest/origins.py` nor add a test implementing the lower‑casing fix.
- **[high] False claim that deduplication URL mismatch was fixed** — The doc claims the deduplication logic now consistently uses `final_url`, but the PR contains **no modifications** to `mira-crawler/tasks/ingest.py` or related files.
- **[medium] Claim that `provenance_policy.yaml` was added** — The documentation repeatedly mentions a new file `provenance_policy.yaml`, but the PR **does not add** this file anywhere in the repository.
- **[high] Claim that new contract tests were added and wired into CI** — The PR references test files such as `mira-crawler/tests/test_conflict_and_packaging_contracts.py` and says they are “wired into the CI crawler slice”, yet **no new or modified test files** appear under `mira-crawler/tests/`.

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] False claim that `_read_validated` guard was fixed** — The documentation asserts that the guard `os.open not in os.supports_dir_fd` has been corrected and that POSIX tests now pass, but the PR contains **no code changes** to `mira-crawler/tasks/ingest.py` (or any other file) that modify `_read_validated`.  
  - **File:** `docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md:5`  
  - **Diff quote:**  
    ```diff
    +**[high] False claim of fixing `_read_validated` invalid `dir_fd` check** — The documentation asserts that the guard `os.open not in os.supports_dir_fd` has been corrected and that POSIX tests now pass, but the diff contains **no code changes** to `mira-crawler/tasks/ingest.py` (or any other file) that modify `_read_validated`. The only evidence is a documentation line:
    ```
  - This claim is also echoed in `round-12-groupA-adjudication.md` where the adjudicator *refutes* the finding without showing any code change:  
    - **File:** `docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md:31`  
    - **Diff quote:**  
      ```diff
      +- **[REFUTED] F1** [high] `_read_validated` uses an invalid check for `dir_fd` support, causing a `TypeError`
      ```

- **[severity: high] False claim that `ingest_text_inline` signature was changed to keyword‑only `is_private` and all call sites updated** — The doc states the function signature was altered and *all* callers were updated, yet the PR adds **no modifications** to `mira-crawler/tasks/_shared.py` or any caller files.  
  - **File:** `docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md:13`  
  - **Diff quote:**  
    ```diff
    +**[high] False claim of fixing `ingest_text_inline` keyword‑only `is_private` argument** — The doc states that the function signature was changed and that *all* call sites were updated, yet the diff does **not** include any modifications to `mira-crawler/tasks/_shared.py` or any caller files. The only evidence is a documentation line:
    ```
  - Supporting line in the adjudication file that *refutes* the finding without showing code:  
    - **File:** `docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md:33`  
    - **Diff quote:**  
      ```diff
      +- **[REFUTED] F2** [high] `ingest_text_inline` signature now requires a keyword‑only `is_private` argument, but internal calls are not updated
      ```

- **[severity: high] False claim that case‑sensitive URL discovery was fixed** — The documentation asserts a fix for the case‑sensitivity bug in `discover_manifests` (commit `663144a14`) and that a red‑first test now passes, but the PR does **not** modify `mira-crawler/ingest/origins.py` nor add a test implementing the lower‑casing fix.  
  - **File:** `docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md:20`  
  - **Diff quote:**  
    ```diff
    +**[high] False claim of fixing case‑sensitive URL discovery** — The documentation asserts that the case‑sensitivity bug in `discover_manifests` was fixed in a follow‑up commit (`663144a14`) and that a red‑first test now passes. However, the diff adds only a markdown description; there is **no change** to `mira-crawler/ingest/origins.py` (or any test file) that implements the lower‑casing fix. Evidence:
    ```
  - The adjudication file marks this finding as **SUSTAINED**, showing the code still uses a case‑sensitive check:  
    - **File:** `docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md:37`  
    - **Diff quote:**  
      ```diff
      +- **[SUSTAINED] F3** [high] URL discovery in `discover_manifests` is case‑sensitive, missing uppercase schemes
      ```

- **[severity: high] False claim that deduplication URL mismatch was fixed** — The doc claims the deduplication logic now consistently uses `final_url`, but the PR contains **no modifications** to `mira-crawler/tasks/ingest.py` or related files.  
  - **File:** `docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md:27`  
  - **Diff quote:**  
    ```diff
    +**[high] False claim of fixing deduplication URL mismatch** — The doc claims that the deduplication logic now uses `final_url` consistently, but the diff contains **no modifications** to `mira-crawler/tasks/ingest.py` (or related files). The only evidence is:
    ```
  - The adjudication file *refutes* the finding, yet provides no code change evidence:  
    - **File:** `docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md:39`  
    - **Diff quote:**  
      ```diff
      +- **[REFUTED] F4** [medium] Deduplication uses the original URL while the stored row uses the final (post‑redirect) URL
      ```

- **[severity: medium] Claim that `provenance_policy.yaml` was added** — The documentation repeatedly mentions a new file `provenance_policy.yaml`, but the PR **does not add** this file anywhere in the repository.  
  - **File:** `docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md:34`  
  - **Diff quote:**  
    ```diff
    +**[medium] Claim that `provenance_policy.yaml` was added** — The documentation repeatedly mentions a new file `provenance_policy.yaml` (e.g., “`provenance_policy.yaml` (new in the PR)”), yet the diff does not add such a file anywhere in the repository. No `provenance_policy.yaml` appears in the file list, making the claim unsupported.
    ```

- **[severity: high] Claim that new contract tests were added and wired into CI** — The PR references test files such as `mira-crawler/tests/test_conflict_and_packaging_contracts.py` and says they are “wired into the CI crawler slice”, yet **no new or modified test files** appear under `mira-crawler/tests/`.  
  - **File:** `docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md:38`  
  - **Diff quote:**  
    ```diff
    +**[high] Claim that new contract tests were added and wired into CI** — The diff references test files such as `mira-crawler/tests/test_conflict_and_packaging_contracts.py` and mentions they are “wired into the CI crawler slice”. However, the diff does **not** contain any new or modified test files under `mira-crawler/tests/`. The only evidence is documentation text, e.g.:
    ```

## NOT REVIEWED
- **Actual code state** – Since the PR makes no code modifications, we cannot verify the real implementation of `_read_validated`, `ingest_text_inline`, URL discovery, or deduplication. The presence or absence of the alleged fixes must be confirmed by inspecting the repository at the target commit (`fc00074c6`), which is outside the scope of this diff.
- **Existence of `provenance_policy.yaml`** – The file may exist elsewhere in the repo (outside the diff) or be added in a separate PR. Its presence and contents cannot be validated here.
- **Presence and correctness of the referenced test files** – The PR mentions several test files, but they are not part of this diff. Whether they exist in the repository, are correctly wired into CI, or actually exercise the claimed behavior is unknown.
- **The referenced proof commits (`663144a14`, `663144a142...`)** – These commits are not included in the diff; their content cannot be examined, so we cannot confirm whether they contain the alleged fixes.
- **Runtime impact of any undocumented code changes** – No code changes are present, but if the repository already contained the fixes, we cannot confirm their behavior without running the test suite or inspecting the live code.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
