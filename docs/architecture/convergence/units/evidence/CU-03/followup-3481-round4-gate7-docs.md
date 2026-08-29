# Gate 7 adversarial review — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, cross-repository contract, deletion/destructive, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `c87d298f243bee28cd51d87f2018ab37a3defa87`
- scope (--paths): docs/
- excluded by scope (7): .github/workflows/ci.yml, mira-crawler/ingest/origins.py, mira-crawler/tests/test_conflict_and_packaging_contracts.py, mira-crawler/tests/test_ingest.py, mira-crawler/tests/test_provenance_policy.py, tests/test_gate7_review.py, tools/gate7_review.py
- diff chars sent/total: 130,000/147,236 (cap 130,000)
- reviewed-diff sha256 (sent bytes): `52052991562a352a7139f0f37593edb1a47227a75a0d2b524962bccc7518dbca`
- full scoped-diff sha256 (pre-cap): `3fb25e83a5eec746436b4a58eb33413ed4e3e728ec5e24b014fbabc029fd069c`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] Documentation claims `_read_validated` guard fix (R12‑F1) but no code change is present** — The unit record states:
- **[high] Documentation claims `ingest_text_inline` signature change (R12‑F2) but no code change is present** — The record says:
- **[high] Documentation claims case‑sensitive URL discovery fix (R12‑F3) but production code is unchanged** — The record notes:
- **[high] Documentation claims deduplication URL mismatch fix (R12‑F4) but no code change is present** — The record states:
- **[high] Claim that new contract tests were added and wired into CI is unsupported** — The unit record asserts:
- **[high] Test `test_platform_guard_is_set_membership_and_reads_on_every_platform` makes an incorrect cross‑platform assumption** — The test code (included in the review markdown) contains:
- **[medium] Dockerfile copy‑path test is overly strict and may block legitimate images** — The test helper defined in the review markdown is:
- **[high] Security policy violation: full repository diff is sent to an external LLM provider** — The review logs record:

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Documentation claims `_read_validated` guard fix (R12‑F1) but no code change is present** – The unit record states:  
  ```
  + **R12-F1 REFUTED** — `os.supports_dir_fd` is a `set` (measured: Linux 3.12.3 `os.open in
  ```  
  Yet the diff does not modify `mira-crawler/tasks/ingest.py` (or any file containing `_read_validated`). The claim that the guard has been fixed is therefore unsupported, giving a false sense of security for a known TOCTOU guard issue.

- **[severity: high] Documentation claims `ingest_text_inline` signature change (R12‑F2) but no code change is present** – The record says:  
  ```
  + **R12-F2 REFUTED** — `_shared.py` forwards `is_private=is_private` (a `+` line), all seven
  ```  
  No diff lines modify `mira-crawler/tasks/_shared.py` or any caller to add a keyword‑only `is_private` argument. The alleged fix is missing, so callers may still be using the old signature, potentially causing runtime errors.

- **[severity: high] Documentation claims case‑sensitive URL discovery fix (R12‑F3) but production code is unchanged** – The record notes:  
  ```
  + **R12-F3 SUSTAINED — accepted.** `_urls_in` matched only lowercase schemes, so the CI consistency
  ```  
  The only change shown is a test‑only snippet (see below) that lower‑cases the check, but the actual implementation of `_urls_in` in `mira-crawler/ingest/origins.py` is not altered in this diff. Therefore the original case‑sensitive bug remains, and the documentation’s “fix” is inaccurate.

- **[severity: high] Documentation claims deduplication URL mismatch fix (R12‑F4) but no code change is present** – The record states:  
  ```
  + **R12-F4 REFUTED** — the finding quoted the *removed* `-` line; head dedups and stores on `final_url`.
  ```  
  No modifications to `mira-crawler/tasks/ingest.py` (deduplication logic) appear in the diff, so the reported fix is unsupported.

- **[severity: high] Claim that new contract tests were added and wired into CI is unsupported** – The unit record asserts:  
  ```
  + `mira-crawler/tests/test_conflict_and_packaging_contracts.py` (17 tests, wired into the CI crawler slice, 7 hand mutations each went red)
  ```  
  The PR adds **no** files under `mira-crawler/tests/`; all new files are under `docs/architecture/convergence/units/evidence/`. Consequently the CI pipeline does **not** actually run the claimed tests, creating a false‑positive coverage claim.

- **[severity: high] Test `test_platform_guard_is_set_membership_and_reads_on_every_platform` makes an incorrect cross‑platform assumption** – The test code (included in the review markdown) contains:  
  ```diff
  +        assert isinstance(os.supports_dir_fd, (set, frozenset))
  ```  
  `os.supports_dir_fd` is a **set** on POSIX but a **boolean** on Windows. The assertion will fail on Windows, causing the test to erroneously report a failure (or, if the assertion is removed, to miss a regression). This yields a false‑green security test.

- **[severity: medium] Dockerfile copy‑path test is overly strict and may block legitimate images** – The test helper defined in the review markdown is:  
  ```diff
  +def _whole_dir_copy_dest(dockerfile_text: str) -> str | None:
  +    for line in dockerfile_text.splitlines():
  +        m = re.match(r"\s*COPY\s+mira-crawler/?\s+(\S+)\s*$", line)
  +        if m:
  +            return m.group(1).rstrip("/")
  +        m = re.match(r'\s*COPY\s+\[\s*"(?:\./)?mira-crawler/?"\s*,\s*"([^"]+)"\s*\]\s*$', line)
  +        if m:
  +            return m.group(1).rstrip("/")
  +    return None
  ```
  and later:
  ```diff
  +        assert dest, (
  +            f"{dockerfile.name}: no whole-directory `COPY mira-crawler/ <dest>` — the manifest would not ship"
  +        )
  ```  
  Real Dockerfiles frequently use multi‑stage builds, `ARG`‑based destinations, or the JSON‑array syntax with extra whitespace. The test will reject such valid Dockerfiles, causing unnecessary CI failures.

- **[severity: high] Security policy violation: full repository diff is sent to an external LLM provider** – The review logs record:  
  ```
  +Gate 7: sending 130,000 diff chars to a third-party provider (redacted: IP/MAC/SN)
  ```  
  Shipping the entire codebase (including potentially proprietary or credential‑containing files) to an unauthenticated external service breaches data‑handling policies and could expose secrets.

## NOT REVIEWED
- Whether the referenced proof commits (`663144a14`, `663144a142…`) actually contain the alleged code fixes; they are not part of this diff.
- The existence and contents of `provenance_policy.yaml` elsewhere in the repository (the diff does not add the file).
- Whether the CI workflow (`.github/workflows/ci.yml`) has been updated to execute the purported new tests, since no test files were added under `mira-crawler/tests/`.
- Real‑world runtime behavior of `_read_validated`, `ingest_text_inline`, and the case‑insensitive URL detection after any upstream changes not shown here.
- The impact of the case‑insensitive URL detection change on policy enforcement (e.g., duplicate policy entries, unintended acceptance of malformed URLs).
- Potential performance or flakiness impact of the large test suite on CI runners (the diff adds a ~400‑line test file but its execution impact is not measured).

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
