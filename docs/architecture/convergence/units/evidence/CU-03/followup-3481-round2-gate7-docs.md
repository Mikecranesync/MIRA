# Gate 7 adversarial review — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, cross-repository contract, deletion/destructive, forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `edb71a6245a849731a616074fb142145ff38d8ff`
- scope (--paths): docs/
- excluded by scope (6): .github/workflows/ci.yml, mira-crawler/ingest/origins.py, mira-crawler/tests/test_conflict_and_packaging_contracts.py, mira-crawler/tests/test_ingest.py, mira-crawler/tests/test_provenance_policy.py, tests/test_gate7_review.py
- diff chars sent/total: 66,045/66,045 (cap 80,000)
- reviewed-diff sha256 (sent bytes): `85e6669ade78340f287b563b54a4a3715aa90f64d4429d8b1f91120bbdf832b5`
- full scoped-diff sha256 (pre-cap): `85e6669ade78340f287b563b54a4a3715aa90f64d4429d8b1f91120bbdf832b5`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] False claim that `_read_validated` guard was fixed** — The documentation asserts that the guard `os.open not in os.supports_dir_fd` has been corrected and that POSIX tests now pass, but the diff contains **no code changes** to `mira-crawler/tasks/ingest.py` (or any other file) that modify `_read_validated`.
- **[high] False claim that `ingest_text_inline` signature was changed and all call sites updated** — The doc states that the function signature was changed to require a keyword‑only `is_private` argument and that all callers were updated, yet the diff does **not** include any modifications to `mira-crawler/tasks/_shared.py` or any caller files.
- **[high] False claim that case‑sensitive URL discovery was fixed** — The documentation asserts that the case‑sensitivity bug in `discover_manifests` was fixed in a follow‑up commit (`663144a14`) and that a red‑first test now passes. The diff adds only markdown description; there is **no change** to `mira-crawler/ingest/origins.py` (or any test file) that implements the lower‑casing fix.
- **[high] False claim that deduplication URL mismatch was fixed** — The doc claims that the deduplication logic now uses `final_url` consistently, but the diff contains **no modifications** to `mira-crawler/tasks/ingest.py` (or related files).
- **[high] False claim that `provenance_policy.yaml` was added** — The documentation repeatedly mentions a new file `provenance_policy.yaml` (e.g., “`provenance_policy.yaml` (new in the PR)”), yet the diff does not add such a file anywhere in the repository.
- **[high] False claim that new contract tests were added and wired into CI** — The diff references test files such as `mira-crawler/tests/test_conflict_and_packaging_contracts.py` and claims they are “wired into the CI crawler slice”, but the diff does **not** contain any new or modified test files under `mira-crawler/tests/`.
- **[high] Contradictory documentation about the status of finding F3 (case‑sensitive URL discovery)** — In `CU-03.md` the document states that the case‑sensitivity issue was *fixed* in a follow‑up commit, while `round-12-groupA-adjudication.md` records that F3 was **SUSTAINED** (i.e., not fixed). This direct contradiction undermines the reliability of the audit trail.

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] False claim that `_read_validated` guard was fixed** — The documentation asserts that the guard `os.open not in os.supports_dir_fd` has been corrected and that POSIX tests now pass, but the diff contains **no code changes** to `mira-crawler/tasks/ingest.py` (or any other file) that modify `_read_validated`.  
  ```diff
  - **[high] False claim of fixing `_read_validated` invalid `dir_fd` check** — The documentation asserts that the guard `os.open not in os.supports_dir_fd` has been corrected and that POSIX tests now pass, but the diff contains **no code changes** to `mira-crawler/tasks/ingest.py` (or any other file) that modify `_read_validated`. The only evidence is a documentation line:
  ```

- **[severity: high] False claim that `ingest_text_inline` signature was changed and all call sites updated** — The doc states that the function signature was changed to require a keyword‑only `is_private` argument and that all callers were updated, yet the diff does **not** include any modifications to `mira-crawler/tasks/_shared.py` or any caller files.  
  ```diff
  - **[high] False claim of fixing `ingest_text_inline` keyword‑only `is_private` argument** — The doc states that the function signature was changed and that *all* call sites were updated, yet the diff does **not** include any modifications to `mira-crawler/tasks/_shared.py` or any caller files. The only evidence is a documentation line:
  ```

- **[severity: high] False claim that case‑sensitive URL discovery was fixed** — The documentation asserts that the case‑sensitivity bug in `discover_manifests` was fixed in a follow‑up commit (`663144a14`) and that a red‑first test now passes. The diff adds only markdown description; there is **no change** to `mira-crawler/ingest/origins.py` (or any test file) that implements the lower‑casing fix.  
  ```diff
  - **[high] False claim of fixing case‑sensitive URL discovery** — The documentation asserts that the case‑sensitivity bug in `discover_manifests` was fixed in a follow‑up commit (`663144a14`) and that a red‑first test now passes. However, the diff adds only a markdown description; there is **no change** to `mira-crawler/ingest/origins.py` (or any test file) that implements the lower‑casing fix. Evidence:
  ```

- **[severity: high] False claim that deduplication URL mismatch was fixed** — The doc claims that the deduplication logic now uses `final_url` consistently, but the diff contains **no modifications** to `mira-crawler/tasks/ingest.py` (or related files).  
  ```diff
  - **[high] False claim of fixing deduplication URL mismatch** — The doc claims that the deduplication logic now uses `final_url` consistently, but the diff contains **no modifications** to `mira-crawler/tasks/ingest.py` (or related files). The only evidence is:
  ```

- **[severity: high] False claim that `provenance_policy.yaml` was added** — The documentation repeatedly mentions a new file `provenance_policy.yaml` (e.g., “`provenance_policy.yaml` (new in the PR)”), yet the diff does not add such a file anywhere in the repository.  
  ```diff
  - **[medium] Claim that `provenance_policy.yaml` was added** — The documentation repeatedly mentions a new file `provenance_policy.yaml` (e.g., “`provenance_policy.yaml` (new in the PR)”), yet the diff does not add such a file anywhere in the repository. No `provenance_policy.yaml` appears in the file list, making the claim unsupported.
  ```

- **[severity: high] False claim that new contract tests were added and wired into CI** — The diff references test files such as `mira-crawler/tests/test_conflict_and_packaging_contracts.py` and claims they are “wired into the CI crawler slice”, but the diff does **not** contain any new or modified test files under `mira-crawler/tests/`.  
  ```diff
  - **[high] Claim that new contract tests were added and wired into CI** — The diff references test files such as `mira-crawler/tests/test_conflict_and_packaging_contracts.py` and mentions they are “wired into the CI crawler slice”. However, the diff does **not** contain any new or modified test files under `mira-crawler/tests/`. The only evidence is documentation text, e.g.:
  ```

- **[severity: high] Contradictory documentation about the status of finding F3 (case‑sensitive URL discovery)** — In `CU-03.md` the document states that the case‑sensitivity issue was *fixed* in a follow‑up commit, while `round-12-groupA-adjudication.md` records that F3 was **SUSTAINED** (i.e., not fixed). This direct contradiction undermines the reliability of the audit trail.  
  ```diff
  - **[high] False claim of fixing case‑sensitive URL discovery** … (see above)
  ...
  + **[SUSTAINED] F3** [high] URL discovery in `discover_manifests` is case‑sensitive, missing uppercase schemes
  ```

## NOT REVIEWED
- Runtime behavior of the actual code (e.g., the current implementation of `_read_validated`, `ingest_text_inline`, URL discovery, and deduplication) because no code changes are present in the diff to analyze.
- Existence and content of the referenced commits `663144a14`, `663144a142...` – they are not part of this diff, so we cannot verify whether they contain the claimed fixes.
- Actual CI configuration changes (e.g., wiring of new tests into the pipeline) since no test files or CI workflow modifications are present in the diff.
- Impact of a missing `provenance_policy.yaml` file on production deployments; we cannot see whether the file exists elsewhere in the repository or will be added in a separate change.
- Any side‑effects of the documented “fresh review” processes, as those are procedural and not reflected in code changes.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
