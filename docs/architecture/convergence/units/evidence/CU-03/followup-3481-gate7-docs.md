# Gate 7 adversarial review — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, cross-repository contract, deletion/destructive, forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `0ee07b3f2b5197737e728ca977f0927c560ec03a`
- scope (--paths): docs/
- excluded by scope (6): .github/workflows/ci.yml, mira-crawler/ingest/origins.py, mira-crawler/tests/test_conflict_and_packaging_contracts.py, mira-crawler/tests/test_ingest.py, mira-crawler/tests/test_provenance_policy.py, tests/test_gate7_review.py
- diff chars sent/total: 46,416/46,416 (cap 60,000)
- reviewed-diff sha256 (sent bytes): `98e78ca319d757ac25d9c445ff548267eb354fcafcda8b385a89d7633f167376`
- full scoped-diff sha256 (pre-cap): `98e78ca319d757ac25d9c445ff548267eb354fcafcda8b385a89d7633f167376`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] False claim of fixing `_read_validated` invalid `dir_fd` check** — The documentation asserts that the guard `os.open not in os.supports_dir_fd` has been corrected and that POSIX tests now pass, but the diff contains **no code changes** to `mira-crawler/tasks/ingest.py` (or any other file) that modify `_read_validated`. The only evidence is a documentation line:
- **[high] False claim of fixing `ingest_text_inline` keyword‑only `is_private` argument** — The doc states that the function signature was changed and that *all* call sites were updated, yet the diff does **not** include any modifications to `mira-crawler/tasks/_shared.py` or any caller files. The only evidence is a documentation line:
- **[high] False claim of fixing case‑sensitive URL discovery** — The documentation asserts that the case‑sensitivity bug in `discover_manifests` was fixed in a follow‑up commit (`663144a14`) and that a red‑first test now passes. However, the diff adds only a markdown description; there is **no change** to `mira-crawler/ingest/origins.py` (or any test file) that implements the lower‑casing fix. Evidence:
- **[high] False claim of fixing deduplication URL mismatch** — The doc claims that the deduplication logic now uses `final_url` consistently, but the diff contains **no modifications** to `mira-crawler/tasks/ingest.py` (or related files). The only evidence is:
- **[medium] Claim that `provenance_policy.yaml` was added** — The documentation repeatedly mentions a new file `provenance_policy.yaml` (e.g., “`provenance_policy.yaml` (new in the PR)”), yet the diff does not add such a file anywhere in the repository. No `provenance_policy.yaml` appears in the file list, making the claim unsupported.
- **[medium] Claim that new contract tests were added and wired into CI** — The diff references test files such as `mira-crawler/tests/test_conflict_and_packaging_contracts.py` and mentions they are “wired into the CI crawler slice”. However, the diff does **not** contain any new or modified test files under `mira-crawler/tests/`. The only evidence is documentation text, e.g.:

## Raw review

## VERDICT
**BLOCK**

## FINDINGS
- **[severity: high] False claim of fixing `_read_validated` invalid `dir_fd` check** — The documentation asserts that the guard `os.open not in os.supports_dir_fd` has been corrected and that POSIX tests now pass, but the diff contains **no code changes** to `mira-crawler/tasks/ingest.py` (or any other file) that modify `_read_validated`. The only evidence is a documentation line:
  ```
  +- **[REFUTED] F1** [high] `_read_validated` uses an invalid check for `dir_fd` support, causing a `TypeError`
  ```
  (`docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md`). No corresponding implementation or test code appears in the diff, making the claim unsupported.

- **[severity: high] False claim of fixing `ingest_text_inline` keyword‑only `is_private` argument** — The doc states that the function signature was changed and that *all* call sites were updated, yet the diff does **not** include any modifications to `mira-crawler/tasks/_shared.py` or any caller files. The only evidence is a documentation line:
  ```
  +- **[REFUTED] F2** [high] `ingest_text_inline` signature now requires a keyword‑only `is_private` argument, but internal calls are not updated
  ```
  (`docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md`). No code changes or test additions are present, so the claim is unsubstantiated.

- **[severity: high] False claim of fixing case‑sensitive URL discovery** — The documentation asserts that the case‑sensitivity bug in `discover_manifests` was fixed in a follow‑up commit (`663144a14`) and that a red‑first test now passes. However, the diff adds only a markdown description; there is **no change** to `mira-crawler/ingest/origins.py` (or any test file) that implements the lower‑casing fix. Evidence:
  ```
  +- **[SUSTAINED] F3** [high] URL discovery in `discover_manifests` is case‑sensitive, missing uppercase schemes
  ```
  (`docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md`). The alleged code change is absent.

- **[severity: high] False claim of fixing deduplication URL mismatch** — The doc claims that the deduplication logic now uses `final_url` consistently, but the diff contains **no modifications** to `mira-crawler/tasks/ingest.py` (or related files). The only evidence is:
  ```
  +- **[REFUTED] F4** [medium] Deduplication uses the original URL while the stored row uses the final (post‑redirect) URL
  ```
  (`docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md`). No code or test changes are present to substantiate the fix.

- **[severity: medium] Claim that `provenance_policy.yaml` was added** — The documentation repeatedly mentions a new file `provenance_policy.yaml` (e.g., “`provenance_policy.yaml` (new in the PR)”), yet the diff does not add such a file anywhere in the repository. No `provenance_policy.yaml` appears in the file list, making the claim unsupported.

- **[severity: medium] Claim that new contract tests were added and wired into CI** — The diff references test files such as `mira-crawler/tests/test_conflict_and_packaging_contracts.py` and mentions they are “wired into the CI crawler slice”. However, the diff does **not** contain any new or modified test files under `mira-crawler/tests/`. The only evidence is documentation text, e.g.:
  ```
  +  `mira-crawler/tests/test_conflict_and_packaging_contracts.py` (17 tests, wired into the CI crawler slice, 7 hand mutations each went red)
  ```
  (`docs/architecture/convergence/units/CU-03.md`). The asserted test additions are absent.

## NOT REVIEWED
- **Runtime correctness of the alleged code fixes** – because the diff does not contain any implementation changes, we cannot execute or reason about the actual behavior of `_read_validated`, `ingest_text_inline`, URL discovery, or deduplication logic. Any real‑world impact remains unknown.
- **Existence and contents of the referenced commits** (`663144a14`, `663144a142...`) – these commits are not part of the diff, so we cannot verify whether they truly contain the claimed fixes.
- **Presence of the `provenance_policy.yaml` file** – the file is not added in this diff; its actual existence elsewhere in the repo is unverified.
- **Integration of the claimed test suite into CI** – without the test files present, we cannot confirm CI configuration changes or test outcomes.
- **Potential security implications of sending the full diff to an external reviewer** – the logs indicate the entire diff was transmitted to a third‑party provider; any sensitive code inadvertently included would be exposed, but the diff shown contains only documentation, so the impact cannot be assessed here.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
