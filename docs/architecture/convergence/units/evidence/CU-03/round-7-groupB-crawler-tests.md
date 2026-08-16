# Gate 7 adversarial review — PR #3268

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** tenant scoping, security boundaries, cross-repository contract, broad multi-module (8 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Findings

- **[high] Empty `MIRA_TENANT_ID` bypasses tenant isolation** — `ingest_url.run()` (or the underlying `ingest_url` function) only checks for the presence of the environment variable but does not validate that it is a non‑empty, well‑formed tenant identifier. Supplying `MIRA_TENANT_ID=""` (or a string consisting solely of whitespace) causes the write path to be executed with an empty `tenant_id`, allowing a malicious actor to inject rows that are visible to *all* tenants (the `tenant_id` column will be empty, which the rest of the platform treats as “no tenant”).
- **[high] URL‑encoded path‑traversal on `file://` scheme** — `shared_corpus_source_allowed()` normalises the path with `Path(...).resolve()` **after** converting the URI to a filesystem path, but it does **not** first URL‑decode percent‑encoded components. An attacker can supply `file://%2Ftmp%2Fsecret.txt` or `file://%2e%2e/%2e%2e/etc/passwd`, which resolve to locations outside the allowed directory yet pass the “contains allowed_dir” check because the encoded string is different from the literal `..` sequence the test covers.
- **[medium] Mixed‑case scheme handling may bypass curation** — The gate normalises schemes only by checking `url.lower().startswith("http://")` or `"https://"`. A crafted URL such as `"hTtPs://evil-uncurated.example/x.pdf"` will pass the `startswith` test (because the lower‑casing is applied only to the literal prefix) but the subsequent host‑extraction routine may retain the original mixed case, causing the host‑matching logic (which performs a case‑sensitive suffix check) to **mis‑classify** the host as uncurated and incorrectly allow the download. The tests only cover all‑uppercase (`HTTPS://`) and all‑lowercase, leaving this mixed case path unchecked.
- **[medium] Off‑by‑one in redirect‑hop limit** — The redirect‑handling loop decrements the hop counter *after* processing a hop, allowing `MAX_REDIRECT_HOPS + 1` HTTP requests before aborting. The test asserts that the number of requested URLs equals `MAX_REDIRECT_HOPS + 1`, but the implementation still performs the **extra** request that triggered the final error, exposing the service to a DoS vector where an attacker can force the system to open one more outbound connection than intended.
- **[low] Missing migration for new `is_private` column** — The schema change adds a required `is_private` column to `knowledge_entries`. Existing production databases will reject inserts until a migration adds the column with a default, or makes it nullable temporarily. The test suite uses a fake engine, so this regression is not caught. Deploying the change without a migration would cause runtime failures for all ingest jobs.

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Empty `MIRA_TENANT_ID` bypasses tenant isolation** – `ingest_url.run()` (or the underlying `ingest_url` function) only checks for the presence of the environment variable but does not validate that it is a non‑empty, well‑formed tenant identifier. Supplying `MIRA_TENANT_ID=""` (or a string consisting solely of whitespace) causes the write path to be executed with an empty `tenant_id`, allowing a malicious actor to inject rows that are visible to *all* tenants (the `tenant_id` column will be empty, which the rest of the platform treats as “no tenant”).  
  `mira-crawler/tasks/ingest.py:line ≈ 220` (environment lookup)  

- **[severity: high] URL‑encoded path‑traversal on `file://` scheme** – `shared_corpus_source_allowed()` normalises the path with `Path(...).resolve()` **after** converting the URI to a filesystem path, but it does **not** first URL‑decode percent‑encoded components. An attacker can supply `file://%2Ftmp%2Fsecret.txt` or `file://%2e%2e/%2e%2e/etc/passwd`, which resolve to locations outside the allowed directory yet pass the “contains allowed_dir” check because the encoded string is different from the literal `..` sequence the test covers.  
  `mira-crawler/tasks/ingest.py:line ≈ 140` (allowed‑dir containment logic)

- **[severity: medium] Mixed‑case scheme handling may bypass curation** – The gate normalises schemes only by checking `url.lower().startswith("http://")` or `"https://"`. A crafted URL such as `"hTtPs://evil-uncurated.example/x.pdf"` will pass the `startswith` test (because the lower‑casing is applied only to the literal prefix) but the subsequent host‑extraction routine may retain the original mixed case, causing the host‑matching logic (which performs a case‑sensitive suffix check) to **mis‑classify** the host as uncurated and incorrectly allow the download. The tests only cover all‑uppercase (`HTTPS://`) and all‑lowercase, leaving this mixed case path unchecked.  
  `mira-crawler/tasks/ingest.py:line ≈ 95` (scheme detection)

- **[severity: medium] Off‑by‑one in redirect‑hop limit** – The redirect‑handling loop decrements the hop counter *after* processing a hop, allowing `MAX_REDIRECT_HOPS + 1` HTTP requests before aborting. The test asserts that the number of requested URLs equals `MAX_REDIRECT_HOPS + 1`, but the implementation still performs the **extra** request that triggered the final error, exposing the service to a DoS vector where an attacker can force the system to open one more outbound connection than intended.  
  `mira-crawler/tasks/ingest.py:line ≈ 180` (redirect loop)

- **[severity: low] Missing migration for new `is_private` column** – The schema change adds a required `is_private` column to `knowledge_entries`. Existing production databases will reject inserts until a migration adds the column with a default, or makes it nullable temporarily. The test suite uses a fake engine, so this regression is not caught. Deploying the change without a migration would cause runtime failures for all ingest jobs.  
  `mira-crawler/ingest/store.py:line ≈ 30` (SQL INSERT statement)

## NOT REVIEWED
- Actual interaction with the real PostgreSQL instance (e.g., constraint violations, transaction roll‑backs) – the diff replaces the engine with a fake in tests, so we cannot verify that the new `is_private` binding works against the live schema or that the migration has been applied.
- Behaviour of downstream services that consume `knowledge_entries` (e.g., search indexing, recommendation pipelines) – we did not run integration tests to confirm they correctly handle the newly required `is_private` flag.
- Performance impact of the new per‑chunk `is_private` parameter and the additional URL‑validation steps on high‑throughput ingest pipelines.  
- Correct handling of symbolic links inside the allowed directory – the path‑resolution check may still be bypassed via a symlink that points outside `INGEST_LOCAL_ALLOWED_DIR`. This was not exercised in the test suite.

## Cascade attempts

- `groq: ok`
