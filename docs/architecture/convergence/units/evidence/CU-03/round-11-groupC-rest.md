# Gate 7 adversarial review — PR #3268

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** tenant scoping, security boundaries, cross-repository contract, broad multi-module (9 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `02210a97b361c7abb5ba4444da5988f346633432`
- scope (--paths): tools/, mira-bots/, mira-hub/, tests/, .github/, .claude/, mira-core/
- excluded by scope (46): docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md, docs/architecture/convergence/BACKLOG.md, docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/round-1-crash.log, docs/architecture/convergence/units/evidence/CU-03/round-2-crash.log, docs/architecture/convergence/units/evidence/CU-03/round-3-full-diff.md, docs/architecture/convergence/units/evidence/CU-03/round-4-full-diff.md, docs/architecture/convergence/units/evidence/CU-03/round-5-full-diff.md, docs/architecture/convergence/units/evidence/CU-03/round-6-groupA-crawler-prod.md, docs/architecture/convergence/units/evidence/CU-03/round-6-groupB-crawler-tests.md, docs/architecture/convergence/units/evidence/CU-03/round-6-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-7-groupA-crawler-prod.md, docs/architecture/convergence/units/evidence/CU-03/round-7-groupB-crawler-tests.md, docs/architecture/convergence/units/evidence/CU-03/round-7-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-8-groupA-crawler-prod.md, docs/architecture/convergence/units/evidence/CU-03/round-8-groupB-crawler-tests.md, docs/architecture/convergence/units/evidence/CU-03/round-8-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-adjudication-1-scope-limited.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-adjudication-2-PASS.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-review.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-adjudication-1-scope-limited.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-adjudication-2-PASS.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-review.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupC-adjudication-PASS.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupC-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupC-review.md, mira-crawler/crawler/base_crawler.py, mira-crawler/ingest/store.py, mira-crawler/main.py, mira-crawler/tasks/_shared.py, mira-crawler/tasks/full_ingest_pipeline.py, mira-crawler/tasks/ingest.py, mira-crawler/tasks/manualslib_scraper.py, mira-crawler/tasks/patents.py, mira-crawler/tasks/playwright_crawler.py, mira-crawler/tasks/reddit.py, mira-crawler/tasks/youtube.py, mira-crawler/tests/test_celery_tasks.py, mira-crawler/tests/test_ingest.py, mira-crawler/tests/test_manufacturer_normalize.py, mira-crawler/tests/test_oem_trust.py, mira-crawler/tests/test_store_verified.py, mira-crawler/tests/test_write_path_visibility.py
- diff chars sent/total: 52,125/52,125 (cap 60,000)
- reviewed-diff sha256 (sent bytes): `e872086703eb910e177d15ddd3a6d95ae23810c5e2a1aebd7a3c622314987e53`
- full scoped-diff sha256 (pre-cap): `e872086703eb910e177d15ddd3a6d95ae23810c5e2a1aebd7a3c622314987e53`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] Insert‑chunk signature change breaks undiscovered callers** — the `insert_chunk` function now requires a keyword‑only `is_private` argument. Any existing call site that does not supply this argument will raise a `TypeError` and abort the ingestion pipeline, causing loss of data ingestion capability in production. The diff introduces the new required parameter:
- **[high] `entry_exists` dedup query ignores `is_private`, enabling cross‑tenant data suppression** — the query used to deduplicate knowledge‑entry chunks does not filter on the newly added `is_private` flag. Consequently, a private row belonging to one tenant can cause the insertion of a public row (or another private row) for a different tenant to be silently skipped, violating privacy expectations and causing data loss. The unchanged query snippet (still present in the allow‑list) is:
- **[medium] Windows CI skips TOCTOU lock tests, leaving a path‑traversal window** — the CI job that runs `knowledge_entries write‑path visibility locks` contains a comment stating that the `test_ingest.py` TOCTOU (symlink‑walk) locks “only EXECUTE here (skipped on Windows dev boxes)”. This means Windows environments are never exercised for the symlink‑walk race condition, exposing a potential file‑system race vulnerability on a platform that may be used in production. The comment in the workflow is:

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Insert‑chunk signature change breaks undiscovered callers** — the `insert_chunk` function now requires a keyword‑only `is_private` argument. Any existing call site that does not supply this argument will raise a `TypeError` and abort the ingestion pipeline, causing loss of data ingestion capability in production. The diff introduces the new required parameter:

  ```diff
  +    *,
  +    is_private: bool,
  ```

  **file:** `tools/vendor_coverage_ingest.py` (function definition).

- **[severity: high] `entry_exists` dedup query ignores `is_private`, enabling cross‑tenant data suppression** — the query used to deduplicate knowledge‑entry chunks does not filter on the newly added `is_private` flag. Consequently, a private row belonging to one tenant can cause the insertion of a public row (or another private row) for a different tenant to be silently skipped, violating privacy expectations and causing data loss. The unchanged query snippet (still present in the allow‑list) is:

  ```diff
  SELECT 1 FROM knowledge_entries
                  WHERE tenant_id = :tid AND LEFT(content, 200) = :prefix
  ```

  **file:** `tools/qa/security/knowledge_entries_read_allowlist.yml` (query snippet).

- **[severity: medium] Windows CI skips TOCTOU lock tests, leaving a path‑traversal window** — the CI job that runs `knowledge_entries write‑path visibility locks` contains a comment stating that the `test_ingest.py` TOCTOU (symlink‑walk) locks “only EXECUTE here (skipped on Windows dev boxes)”. This means Windows environments are never exercised for the symlink‑walk race condition, exposing a potential file‑system race vulnerability on a platform that may be used in production. The comment in the workflow is:

  ```diff
  +        # test_ingest.py carries the POSIX symlink-walk TOCTOU
  +        # locks, which only EXECUTE here (skipped on Windows dev boxes). Wired
  ```

  **file:** `.github/workflows/ci.yml`.

## NOT REVIEWED
- We could not enumerate **all** call sites of `insert_chunk` across the repository; any missed location will trigger the high‑severity failure described above. A full static analysis or runtime instrumentation would be required to confirm complete coverage.
- The enforcement of the `is_private` flag in read‑queries beyond the few allow‑list entries shown was not verified. It is possible that other queries (e.g., search, analytics, or admin endpoints) still retrieve rows without checking `is_private`, potentially leaking private data.
- The actual implementation of `shared_corpus_source_allowed` (URL validation) was not inspected; its correctness against sophisticated URL‑encoding tricks, IPv6 hosts, or symlink‑based file‑path escapes remains unconfirmed.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
