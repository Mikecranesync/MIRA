# Gate 7 adversarial review — PR #3268

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** tenant scoping, security boundaries, cross-repository contract, broad multi-module (8 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Findings

- **[high] Scheme‑case bypass of the curation gate** — `ingest_url` (file `mira-crawler/tasks/_shared.py:120‑130`) only checks `url.startswith("file://")` and later `url.startswith(("http://", "https://"))`. URL schemes are case‑insensitive per RFC 3986, so an attacker can submit `FILE://…` or `HTTP://evil.com` and completely skip the `shared_corpus_source_allowed` validation, causing uncurated content to be written to the shared corpus.
- **[high] Missing required `is_private` argument in existing call‑sites** — The new signatures for `insert_chunk`, `store_chunks`, and `ingest_text_inline` make `is_private` a **required keyword‑only** parameter. Any call that was not updated (e.g. calls hidden in other modules such as `mira-crawler/tasks/learning_ingester.py`, `mira-crawler/ingest/legacy.py`, or any third‑party plugin) will raise a `TypeError` at runtime, breaking the crawler lane and potentially causing the entire ingestion pipeline to fail. The diff only updates a subset of call‑sites, leaving the rest untouched.
- **[high] TOCTOU race on local file validation** — `_validated_local_path` (lines `78‑106`) resolves the target path and returns it, but the caller later reads the file with `local_path.read_bytes()` (`ingest_url` line 173). Between validation and read, an attacker with write access could replace the resolved path with a symlink to an arbitrary location, causing the crawler to ingest and store data from outside the allowed directory. This classic TOCTOU window is not mitigated (e.g., by opening the file with `os.O_NOFOLLOW`).
- **[medium] Subdomain matching is case‑sensitive on some platforms** — The host comparison `any(host.endswith("." + h) for h in hosts)` uses the already‑lower‑cased `host` but does **not** lower‑case the entries in `hosts` when they are added from `sources.yaml`. If the manifest contains mixed‑case hosts, the comparison may fail, incorrectly rejecting a legitimate curated source.
- **[medium] Inconsistent handling of redirects for non‑HTTP schemes** — The redirect loop (`for _hop in range(MAX_REDIRECT_HOPS + 1)`) only validates that the next URL starts with `http://` or `https://`. A redirect to `ftp://` or `file://` would be rejected with a generic `_UncuratedHop`, but the log message does not clearly differentiate a policy violation from a malformed redirect, making debugging harder and potentially masking a denial‑of‑service vector.
- **[low] Missing `is_private` propagation in legacy bulk‑ingest paths** — The helper `store_chunks` now requires `is_private`, but older bulk‑ingest scripts (e.g., `scripts/photo_ingest.py` not shown) may still call it without the flag, resulting in a runtime error that the current CI does not exercise.

## Raw review

## VERDICT
**BLOCK**

The change introduces several high‑severity regressions and security bypasses that are not covered by the existing test suite.

## FINDINGS
- **[severity: high] Scheme‑case bypass of the curation gate** – `ingest_url` (file `mira-crawler/tasks/_shared.py:120‑130`) only checks `url.startswith("file://")` and later `url.startswith(("http://", "https://"))`. URL schemes are case‑insensitive per RFC 3986, so an attacker can submit `FILE://…` or `HTTP://evil.com` and completely skip the `shared_corpus_source_allowed` validation, causing uncurated content to be written to the shared corpus.  
- **[severity: high] Missing required `is_private` argument in existing call‑sites** – The new signatures for `insert_chunk`, `store_chunks`, and `ingest_text_inline` make `is_private` a **required keyword‑only** parameter. Any call that was not updated (e.g. calls hidden in other modules such as `mira-crawler/tasks/learning_ingester.py`, `mira-crawler/ingest/legacy.py`, or any third‑party plugin) will raise a `TypeError` at runtime, breaking the crawler lane and potentially causing the entire ingestion pipeline to fail. The diff only updates a subset of call‑sites, leaving the rest untouched.  
- **[severity: high] TOCTOU race on local file validation** – `_validated_local_path` (lines `78‑106`) resolves the target path and returns it, but the caller later reads the file with `local_path.read_bytes()` (`ingest_url` line 173). Between validation and read, an attacker with write access could replace the resolved path with a symlink to an arbitrary location, causing the crawler to ingest and store data from outside the allowed directory. This classic TOCTOU window is not mitigated (e.g., by opening the file with `os.O_NOFOLLOW`).  
- **[severity: medium] Subdomain matching is case‑sensitive on some platforms** – The host comparison `any(host.endswith("." + h) for h in hosts)` uses the already‑lower‑cased `host` but does **not** lower‑case the entries in `hosts` when they are added from `sources.yaml`. If the manifest contains mixed‑case hosts, the comparison may fail, incorrectly rejecting a legitimate curated source.  
- **[severity: medium] Inconsistent handling of redirects for non‑HTTP schemes** – The redirect loop (`for _hop in range(MAX_REDIRECT_HOPS + 1)`) only validates that the next URL starts with `http://` or `https://`. A redirect to `ftp://` or `file://` would be rejected with a generic `_UncuratedHop`, but the log message does not clearly differentiate a policy violation from a malformed redirect, making debugging harder and potentially masking a denial‑of‑service vector.  
- **[severity: low] Missing `is_private` propagation in legacy bulk‑ingest paths** – The helper `store_chunks` now requires `is_private`, but older bulk‑ingest scripts (e.g., `scripts/photo_ingest.py` not shown) may still call it without the flag, resulting in a runtime error that the current CI does not exercise.  

## NOT REVIEWED
- **Runtime behavior of all modules that import `insert_chunk`, `store_chunks`, or `ingest_text_inline`** – The diff only touches a subset of call‑sites; we have not executed the full test suite or the production deployment to confirm that every invocation supplies the new `is_private` argument.
- **Actual contents of `sources.yaml`** – The host‑extraction logic assumes a flat `url` key; complex nested structures or anchors could cause hosts to be missed, altering the allowed‑host set.
- **Interaction with database migrations** – No migration is shown to add the new `is_private` column with a default or to back‑fill existing rows; if the column is added as NOT NULL without a default, the migration may fail or existing rows could become inaccessible.
- **Observability/metrics for the new gate failures** – The added log messages are not tied to any monitoring alerts; we cannot confirm that failures (e.g., uncurated redirects) are surfaced in production dashboards.  

These untested paths and the high‑severity security bypasses warrant a **BLOCK** until they are addressed.

## Cascade attempts

- `groq: ok`
