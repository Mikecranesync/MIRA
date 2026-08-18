# Gate 7 adversarial review — PR #3268

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** tenant scoping, security boundaries, cross-repository contract, broad multi-module (9 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `2655e69863cb47dbc128dee1d5ea864cc40d5e50`
- scope (--paths): mira-crawler/tasks, mira-crawler/ingest, mira-crawler/crawler, mira-crawler/main.py
- excluded by scope (46): .claude/commands/gate7-review.md, .github/workflows/ci.yml, docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md, docs/architecture/convergence/BACKLOG.md, docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/round-1-crash.log, docs/architecture/convergence/units/evidence/CU-03/round-2-crash.log, docs/architecture/convergence/units/evidence/CU-03/round-3-full-diff.md, docs/architecture/convergence/units/evidence/CU-03/round-4-full-diff.md, docs/architecture/convergence/units/evidence/CU-03/round-5-full-diff.md, docs/architecture/convergence/units/evidence/CU-03/round-6-groupA-crawler-prod.md, docs/architecture/convergence/units/evidence/CU-03/round-6-groupB-crawler-tests.md, docs/architecture/convergence/units/evidence/CU-03/round-6-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-7-groupA-crawler-prod.md, docs/architecture/convergence/units/evidence/CU-03/round-7-groupB-crawler-tests.md, docs/architecture/convergence/units/evidence/CU-03/round-7-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-8-groupA-crawler-prod.md, docs/architecture/convergence/units/evidence/CU-03/round-8-groupB-crawler-tests.md, docs/architecture/convergence/units/evidence/CU-03/round-8-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-adjudication-1-scope-limited.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-adjudication-2-PASS.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-review.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-adjudication-1-scope-limited.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-adjudication-2-PASS.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-review.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupC-adjudication-PASS.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupC-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupC-review.md, mira-bots/tools/learning_ingester.py, mira-core/scripts/ingest_equipment_photos.py, mira-crawler/tests/test_celery_tasks.py, mira-crawler/tests/test_ingest.py, mira-crawler/tests/test_manufacturer_normalize.py, mira-crawler/tests/test_oem_trust.py, mira-crawler/tests/test_store_verified.py, mira-crawler/tests/test_write_path_visibility.py, mira-hub/scripts/verify-node-subtree-retrieval.ts, mira-hub/tests/e2e/folder-brain-proof.spec.ts, tests/test_architecture.py, tests/test_gate7_review.py, tools/gate7_review.py, tools/qa/security/knowledge_entries_read_allowlist.yml, tools/vendor_coverage_ingest.py
- diff chars sent/total: 26,235/26,235 (cap 40,000)
- reviewed-diff sha256: `70b723f2ee79fabac636d40d32084bb42fb0ea54d04ff440df705703da6de59c`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] Private‑visibility flag never updated on conflict** — 
- **[high] Potential mis‑location of `sources.yaml` causing universal ingest rejection** — 
- **[high] Undeclared runtime dependency on PyYAML** — 

## Raw review

## VERDICT
**BLOCK** – at least one high‑severity defect is present.

## FINDINGS
- **[severity: high] Private‑visibility flag never updated on conflict**  
  *What breaks*: When a private chunk (`is_private=True`) collides with an existing public chunk (same `tenant_id`, `source_url`, and `chunk_index`), the `ON CONFLICT … DO UPDATE` clause does **not** write the new `is_private` value. The row therefore remains public, leaking private data into the shared corpus.  
  *Trigger*: Ingest a private document that produces a chunk whose unique key already exists from a public source.  
  *File:line*: `mira-crawler/ingest/store.py:108‑122` (excerpt)  

  ```diff
  -                         cast(:metadata AS jsonb), false, :verified, :chunk_type,
  +                         cast(:metadata AS jsonb), :is_private, :verified, :chunk_type,
  ...
  -                     DO UPDATE SET
  -                         id = EXCLUDED.id,
  -                         tenant_id = EXCLUDED.tenant_id,
  -                         source_type = EXCLUDED.source_type,
  -                         manufacturer = EXCLUDED.manufacturer,
  -                         model_number = EXCLUDED.model_number,
  -                         content = EXCLUDED.content,
  -                         embedding = EXCLUDED.embedding,
  -                         source_url = EXCLUDED.source_url,
  -                         source_page = EXCLUDED.source_page,
  -                         metadata = EXCLUDED.metadata,
  -                         verified = EXCLUDED.verified,
  -                         chunk_type = EXCLUDED.chunk_type,
  -                         image_embedding = EXCLUDED.image_embedding
  ```

- **[severity: high] Potential mis‑location of `sources.yaml` causing universal ingest rejection**  
  *What breaks*: `_curated_hosts()` builds the path `manifest = Path(__file__).resolve().parents[1] / "sources.yaml"`. If `sources.yaml` lives at the repository root (or any other directory) the file is not found, `_curated_hosts()` raises, and `shared_corpus_source_allowed()` returns `(False, …)`. Consequently **every** non‑`file://` URL is refused as “uncurated_source”, breaking the entire HTTP ingest pipeline.  
  *Trigger*: Deploy the code in an environment where `sources.yaml` is not located at `mira-crawler/sources.yaml`.  
  *File:line*: `mira-crawler/tasks/ingest.py:84‑90`  

  ```diff
  -    manifest = Path(__file__).resolve().parents[1] / "sources.yaml"
  ```

- **[severity: high] Undeclared runtime dependency on PyYAML**  
  *What breaks*: `_curated_hosts()` imports `yaml` (`import yaml`) without guaranteeing the `PyYAML` package is installed. If the container image or deployment environment lacks this package, the first HTTP ingest attempt raises `ImportError`, aborting the task and leaving the system in a failed state.  
  *Trigger*: Run the crawler on a host without `yaml` installed.  
  *File:line*: `mira-crawler/tasks/ingest.py:86`  

  ```diff
  -    import yaml
  ```

## NOT REVIEWED
- **Database migration** – The diff assumes the `knowledge_entries` table already contains an `is_private` column. The migration that adds this column (and its `NOT NULL` constraint, defaults, indexes, etc.) is not part of the PR and was not verified. If the schema is out‑of‑sync, the `INSERT … VALUES (:is_private, …)` will raise a SQL error at runtime.
- **Definition of `KnowledgeEntry`** – The `base_crawler.process` method now passes `is_private=False` to the `KnowledgeEntry` constructor. Whether the dataclass / ORM model accepts this argument is unknown from the diff; a mismatch would raise a `TypeError`.
- **All call‑sites outside the listed 12** – The repository may contain other modules that call `insert_chunk` or `store_chunks`. Those calls were not examined; if any still rely on the old signature, they will raise `TypeError`.
- **Behaviour of `shared_corpus_source_allowed` for edge‑case URLs** – Cases such as URLs with IPv6 literals, IDN punycode, or unusual `file://` authority components were not exercised in the diff‑based review. Their handling may differ from expectations.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
