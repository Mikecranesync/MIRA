# Gate 7 adversarial review — PR #3268

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** authorization, tenant scoping, security boundaries, cross-repository contract, broad multi-module (9 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `fc00074c6751748643493744247c1582dd285a01`
- scope (--paths): mira-crawler/tasks, mira-crawler/ingest, mira-crawler/crawler, mira-crawler/main.py, mira-crawler/provenance_policy.yaml
- excluded by scope (66): .claude/commands/gate7-review.md, .github/workflows/ci.yml, docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md, docs/architecture/convergence/BACKLOG.md, docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/CU-03a.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/round-1-crash.log, docs/architecture/convergence/units/evidence/CU-03/round-10-groupA-adjudication-1-quote-missed.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupA-adjudication-2.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupA-crawler-prod.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupA-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupB-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupB-crawler-tests.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupB-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupC-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupC-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupD-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupD-docs-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupD-docs.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupD-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-11-groupC-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-11-groupC-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-11-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-2-crash.log, docs/architecture/convergence/units/evidence/CU-03/round-3-full-diff.md, docs/architecture/convergence/units/evidence/CU-03/round-4-full-diff.md, docs/architecture/convergence/units/evidence/CU-03/round-5-full-diff.md, docs/architecture/convergence/units/evidence/CU-03/round-6-groupA-crawler-prod.md, docs/architecture/convergence/units/evidence/CU-03/round-6-groupB-crawler-tests.md, docs/architecture/convergence/units/evidence/CU-03/round-6-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-7-groupA-crawler-prod.md, docs/architecture/convergence/units/evidence/CU-03/round-7-groupB-crawler-tests.md, docs/architecture/convergence/units/evidence/CU-03/round-7-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-8-groupA-crawler-prod.md, docs/architecture/convergence/units/evidence/CU-03/round-8-groupB-crawler-tests.md, docs/architecture/convergence/units/evidence/CU-03/round-8-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-adjudication-1-scope-limited.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-adjudication-2-PASS.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-review.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-adjudication-1-scope-limited.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-adjudication-2-PASS.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-review.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupC-adjudication-PASS.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupC-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupC-review.md, mira-bots/tools/learning_ingester.py, mira-core/scripts/ingest_equipment_photos.py, mira-crawler/tests/test_celery_tasks.py, mira-crawler/tests/test_ingest.py, mira-crawler/tests/test_ingest_lifecycle.py, mira-crawler/tests/test_manufacturer_normalize.py, mira-crawler/tests/test_oem_trust.py, mira-crawler/tests/test_provenance_policy.py, mira-crawler/tests/test_store_verified.py, mira-crawler/tests/test_write_path_visibility.py, mira-hub/scripts/verify-node-subtree-retrieval.ts, mira-hub/tests/e2e/folder-brain-proof.spec.ts, tests/test_architecture.py, tests/test_gate7_review.py, tools/gate7_review.py, tools/qa/security/knowledge_entries_read_allowlist.yml, tools/vendor_coverage_ingest.py
- diff chars sent/total: 78,857/78,857 (cap 80,000)
- reviewed-diff sha256 (sent bytes): `c70b35306646fe10f35235408ad615133b42385d879e50e42cd68a452b11d58f`
- full scoped-diff sha256 (pre-cap): `c70b35306646fe10f35235408ad615133b42385d879e50e42cd68a452b11d58f`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] `_read_validated` uses an invalid check for `dir_fd` support, causing a `TypeError`** — 
- **[high] `ingest_text_inline` signature now requires a keyword‑only `is_private` argument, but internal calls are not updated** — 
- **[high] URL discovery in `discover_manifests` is case‑sensitive, missing uppercase schemes** — 
- **[medium] Deduplication uses the original URL while the stored row uses the final (post‑redirect) URL** — 

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] `_read_validated` uses an invalid check for `dir_fd` support, causing a `TypeError`**  
  The function attempts to guard the symlink‑safe path read with the condition:  
  ```diff
  +    if os.open not in os.supports_dir_fd or not hasattr(os, "O_NOFOLLOW"):
  ```  
  `os.supports_dir_fd` is a **boolean**, not an iterable, so the expression `os.open not in os.supports_dir_fd` raises `TypeError: argument of type 'bool' is not iterable` on any platform where this line executes. This aborts all local‑file ingestion and defeats the intended TOCTOU protection. (File: `mira-crawler/tasks/ingest.py`)

- **[severity: high] `ingest_text_inline` signature now requires a keyword‑only `is_private` argument, but internal calls are not updated**  
  The function definition was changed to:  
  ```diff
  +    embed_model: str,
  +    *,
  +    is_private: bool,
  ```  
  Yet the diff shows no modification to the body of `ingest_text_inline` that forwards this argument to `store_chunks` (or `insert_chunk`). Any existing call to `ingest_text_inline` will raise `TypeError: missing required keyword-only argument 'is_private'`, breaking all code paths that rely on this helper. (File: `mira-crawler/tasks/_shared.py`)

- **[severity: high] URL discovery in `discover_manifests` is case‑sensitive, missing uppercase schemes**  
  The helper `_urls_in` only matches URLs whose literal string starts with lowercase `"http://"` or `"https://"`:  
  ```diff
  -    and n.value.startswith(("http://", "https://"))
  ```  
  Manifest constants that use an uppercase scheme (e.g., `"HTTPS://example.com"`) are ignored, so the provenance‑policy discovery test can silently miss feeds, allowing uncurated origins to be ingested. (File: `mira-crawler/ingest/origins.py`)

- **[severity: medium] Deduplication uses the original URL while the stored row uses the final (post‑redirect) URL**  
  The dedup check is performed against the request URL:  
  ```diff
  -            if chunk_exists(tenant_id, url, chunk_idx):
  ```  
  After manual redirect handling, the row is inserted with `source_url=final_url`:  
  ```diff
  -                source_url=final_url,
  ```  
  If a URL redirects to a different host, the dedup check may miss an existing entry, leading to duplicate rows in `knowledge_entries`. (File: `mira-crawler/tasks/ingest.py`)

## NOT REVIEWED
- **Runtime behavior of the size‑cap logic for large PDFs** – the pre‑flight `HEAD` request was removed; the streaming abort may still protect against OOM but this was not exercised in tests.  
- **Effect of the policy cache (`_POLICY`) on long‑running workers** – if `provenance_policy.yaml` is updated while a worker is alive, the new policy may not be reloaded, potentially allowing or rejecting origins incorrectly.  
- **Potential missing `is_private` arguments in any call sites outside the diff** – the review only inspected files changed in this PR; other modules that call `store_chunks` or `insert_chunk` may still be using the old signature, which would cause runtime errors not visible in the diff.  
- **Behavior of `shared_corpus_source_allowed` in code paths not covered by the diff** – the function is defined but not referenced in the changed code; its correctness under edge cases (e.g., malformed URLs) remains unverified.  
- **Impact of the removed HEAD‑request pre‑flight on network latency and error handling** – not exercised by the current test suite.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
