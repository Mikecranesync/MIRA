# Gate 7 adversarial review — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, cross-repository contract, deletion/destructive, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `92f25b438645b9e100eb3f5b47ca6beb68f5afa7`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (31): docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 37,640/37,640 (cap 40,000)
- reviewed-diff sha256 (sent bytes): `e9e160476a41c6ac0881630cfbe705fd61b4975442b5f6fe69437f419e9a4ac2`
- full scoped-diff sha256 (pre-cap): `e9e160476a41c6ac0881630cfbe705fd61b4975442b5f6fe69437f419e9a4ac2`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] Source‑URL case‑sensitive uniqueness collides with case‑insensitive URL classification** — The ingest pipeline classifies URLs case‑insensitively (scheme and host are lower‑cased in `origins._urls_in` and `provenance.classify_origin`), but the database unique index `idx_ke_chunk_dedup` stores the raw `source_url` string, which is case‑sensitive. An attacker can submit the same logical origin with different casing (e.g., `HTTPS://EXAMPLE.COM/file.pdf` vs `https://example.com/file.pdf`) and receive two distinct rows. If one row is marked private (via policy) and the other public, the private content can be exposed through the public row, violating the “never expose newly‑private content” contract. The test suite only checks that the conflict clause contains `source_url` and that `tenant_id` is first, but it does **not** enforce canonicalisation of `source_url` before insertion, nor does it verify case‑insensitivity of the uniqueness constraint.
- **[medium] PyYAML‑missing‑dependency test may give a false‑green** — The test `test_missing_pyyaml_is_a_refused_write_not_a_task_abort` attempts to simulate a runtime environment without the `yaml` module by executing `monkeypatch.setitem(sys.modules, "yaml", None)`. If `provenance` imports `yaml` at module import time (which is common for configuration loaders), the import has already succeeded before the monkey‑patch runs, so the simulated `ImportError` never occurs. Consequently the test could pass even though a real missing PyYAML would raise at import time and abort the Celery task, breaking the “fail‑closed” guarantee.

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Source‑URL case‑sensitive uniqueness collides with case‑insensitive URL classification** — The ingest pipeline classifies URLs case‑insensitively (scheme and host are lower‑cased in `origins._urls_in` and `provenance.classify_origin`), but the database unique index `idx_ke_chunk_dedup` stores the raw `source_url` string, which is case‑sensitive. An attacker can submit the same logical origin with different casing (e.g., `HTTPS://EXAMPLE.COM/file.pdf` vs `https://example.com/file.pdf`) and receive two distinct rows. If one row is marked private (via policy) and the other public, the private content can be exposed through the public row, violating the “never expose newly‑private content” contract. The test suite only checks that the conflict clause contains `source_url` and that `tenant_id` is first, but it does **not** enforce canonicalisation of `source_url` before insertion, nor does it verify case‑insensitivity of the uniqueness constraint.

  *File:line evidence*  
  `mira-crawler/tests/test_conflict_and_packaging_contracts.py:131-133`  

  ```
  assert _canon(cols) == _canon(m.group(1)), (cols, m.group(1))
  assert _canon(pred) == _canon(m.group(2)), (pred, m.group(2))
  assert _canon(cols).split(",")[0] == "tenant_id"
  ```

- **[severity: medium] PyYAML‑missing‑dependency test may give a false‑green** — The test `test_missing_pyyaml_is_a_refused_write_not_a_task_abort` attempts to simulate a runtime environment without the `yaml` module by executing `monkeypatch.setitem(sys.modules, "yaml", None)`. If `provenance` imports `yaml` at module import time (which is common for configuration loaders), the import has already succeeded before the monkey‑patch runs, so the simulated `ImportError` never occurs. Consequently the test could pass even though a real missing PyYAML would raise at import time and abort the Celery task, breaking the “fail‑closed” guarantee.

  *File:line evidence*  
  `mira-crawler/tests/test_conflict_and_packaging_contracts.py:??` (line containing the monkey‑patch)  

  ```
  monkeypatch.setitem(sys.modules, "yaml", None)  # `import yaml` → ImportError
  ```

## NOT REVIEWED
- Runtime behavior of the platform guard (`_read_validated`) on Windows vs POSIX platforms beyond the simple read test; the guard’s handling of `O_NOFOLLOW` and `dir_fd` edge‑cases is not exercised here.  
- Full end‑to‑end ingestion flow for URLs that differ only in host‑case (e.g., `HTTPS://Example.COM/...`) – the tests verify classification equality but do not verify that the database does not store duplicate rows for such URLs.  
- Interaction of multi‑stage Docker builds with the manifest‑packaging contract; the test only checks that each Dockerfile contains a whole‑directory `COPY mira-crawler/ …` but does not verify that later stages do not discard the manifest.  
- Potential false‑positives in `.dockerignore` exclusion detection when negation (`!`) patterns are used; the test treats any matching pattern as an exclusion.  
- Impact of adding `.log` to `_DOC_SUFFIXES` on secret‑leak detection; not validated.  

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
