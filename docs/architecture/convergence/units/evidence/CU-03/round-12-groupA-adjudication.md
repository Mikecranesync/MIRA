# Gate 7 adjudication — PR #3268

**Verdict:** BLOCK · **Effort:** xhigh · **Adjudicator:** groq (openai/gpt-oss-120b)
**Prior findings:** 4 · **Rulings:** 4 (sustained: 1)

> Verdict is computed structurally: rulings must be an exact bijection onto the
> prior findings by stable id; severity comes from the parsed prior report, never
> the adjudicator; any SUSTAINED high ⇒ BLOCK; any duplicate/unknown/missing/extra
> id ⇒ UNKNOWN. Both phases are preserved intact as evidence.

## Run receipts

- head: `fc00074c6751748643493744247c1582dd285a01`
- scope (--paths): mira-crawler/tasks, mira-crawler/ingest, mira-crawler/crawler, mira-crawler/main.py, mira-crawler/provenance_policy.yaml, mira-crawler/tests/test_ingest.py
- excluded by scope (65): .claude/commands/gate7-review.md, .github/workflows/ci.yml, docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md, docs/architecture/convergence/BACKLOG.md, docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/CU-03a.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/round-1-crash.log, docs/architecture/convergence/units/evidence/CU-03/round-10-groupA-adjudication-1-quote-missed.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupA-adjudication-2.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupA-crawler-prod.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupA-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupB-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupB-crawler-tests.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupB-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupC-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupC-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupD-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupD-docs-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupD-docs.md, docs/architecture/convergence/units/evidence/CU-03/round-10-groupD-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-11-groupC-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-11-groupC-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-11-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-2-crash.log, docs/architecture/convergence/units/evidence/CU-03/round-3-full-diff.md, docs/architecture/convergence/units/evidence/CU-03/round-4-full-diff.md, docs/architecture/convergence/units/evidence/CU-03/round-5-full-diff.md, docs/architecture/convergence/units/evidence/CU-03/round-6-groupA-crawler-prod.md, docs/architecture/convergence/units/evidence/CU-03/round-6-groupB-crawler-tests.md, docs/architecture/convergence/units/evidence/CU-03/round-6-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-7-groupA-crawler-prod.md, docs/architecture/convergence/units/evidence/CU-03/round-7-groupB-crawler-tests.md, docs/architecture/convergence/units/evidence/CU-03/round-7-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-8-groupA-crawler-prod.md, docs/architecture/convergence/units/evidence/CU-03/round-8-groupB-crawler-tests.md, docs/architecture/convergence/units/evidence/CU-03/round-8-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-adjudication-1-scope-limited.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-adjudication-2-PASS.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-review.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-adjudication-1-scope-limited.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-adjudication-2-PASS.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-review.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupC-adjudication-PASS.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupC-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupC-review.md, mira-bots/tools/learning_ingester.py, mira-core/scripts/ingest_equipment_photos.py, mira-crawler/tests/test_celery_tasks.py, mira-crawler/tests/test_ingest_lifecycle.py, mira-crawler/tests/test_manufacturer_normalize.py, mira-crawler/tests/test_oem_trust.py, mira-crawler/tests/test_provenance_policy.py, mira-crawler/tests/test_store_verified.py, mira-crawler/tests/test_write_path_visibility.py, mira-hub/scripts/verify-node-subtree-retrieval.ts, mira-hub/tests/e2e/folder-brain-proof.spec.ts, tests/test_architecture.py, tests/test_gate7_review.py, tools/gate7_review.py, tools/qa/security/knowledge_entries_read_allowlist.yml, tools/vendor_coverage_ingest.py
- diff chars sent/total: 85,217/85,217 (cap 90,000)
- reviewed-diff sha256 (sent bytes): `24bee52be079988b64b8e81e0b7740d696b5c73d4559f60cdf98d03df3d7b672`
- full scoped-diff sha256 (pre-cap): `24bee52be079988b64b8e81e0b7740d696b5c73d4559f60cdf98d03df3d7b672`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Prior findings (structural ids)

- F1 [high] `_read_validated` uses an invalid check for `dir_fd` support, causing a `TypeError`
- F2 [high] `ingest_text_inline` signature now requires a keyword‑only `is_private` argument, but internal calls are not updated
- F3 [high] URL discovery in `discover_manifests` is case‑sensitive, missing uppercase schemes
- F4 [medium] Deduplication uses the original URL while the stored row uses the final (post‑redirect) URL

## Rulings

- **[REFUTED] F1** [high] `_read_validated` uses an invalid check for `dir_fd` support, causing a `TypeError`
- **[REFUTED] F2** [high] `ingest_text_inline` signature now requires a keyword‑only `is_private` argument, but internal calls are not updated
- **[SUSTAINED] F3** [high] URL discovery in `discover_manifests` is case‑sensitive, missing uppercase schemes
- **[REFUTED] F4** [medium] Deduplication uses the original URL while the stored row uses the final (post‑redirect) URL

## Raw adjudication

## RULINGS
- **[ruling: REFUTED] [id: F1]** — the diff adds tests (`_POSIX_ONLY`, `with pytest.raises(OSError)`) that execute `_read_validated` on POSIX platforms without raising a `TypeError`, confirming `os.supports_dir_fd` is iterable (a set) and the guard is valid.  
- **[ruling: REFUTED] [id: F2]** — the diff updates every call site of `ingest_text_inline` to include the new keyword‑only `is_private` argument (e.g., in `base_crawler.py`, `full_ingest_pipeline.py`, `playwright_crawler.py`), so internal calls are no longer missing the parameter.  
- **[ruling: SUSTAINED] [id: F3]** — the newly added `_urls_in` function in `ingest/origins.py` still uses `n.value.startswith(("http://", "https://"))`, which is case‑sensitive and therefore does not match uppercase schemes, matching the original finding.  
- **[ruling: REFUTED] [id: F4]** – the diff changes the deduplication check to use `final_url` (`if chunk_exists(..., final_url, ...)`) and stores rows with `source_url=final_url`, eliminating the mismatch described in the finding.  

## VERDICT
BLOCK

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
