# Gate 7 adversarial review — PR #3268

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** tenant scoping, security boundaries, cross-repository contract, broad multi-module (8 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Findings

- **[high] Backward‑compatibility break – required `is_private` argument** — 
- **[high] TOCTOU race on `file://` ingestion** — 
- **[medium] Host‑allowlist bypass via Unicode / IDN** — 
- **[medium] Redirect handling may inadvertently reject legitimate redirects** — 
- **[low] Stale cached curated‑host list** — 

## Raw review

## VERDICT
**BLOCK**

Any high‑severity finding forces a block. The changes introduce a hard‑breakage in public APIs and a race condition that can be weaponised for unauthorized file reads.

## FINDINGS
- **[severity: high] Backward‑compatibility break – required `is_private` argument**  
  `insert_chunk`, `store_chunks`, and `ingest_text_inline` were changed to require a keyword‑only `is_private: bool` parameter (no default). Any existing caller that was not updated (e.g., other services, admin tools, older Celery tasks, unit tests not listed in the PR) will raise a `TypeError` at import‑time or runtime, taking down the whole ingestion pipeline.  
  *Evidence*: `mira-crawler/ingest/store.py:71‑84` (signature change) and `mira-crawler/tasks/_shared.py:58‑70` (signature change).  

- **[severity: high] TOCTOU race on `file://` ingestion**  
  `_validated_local_path` resolves the target path and returns a `Path`. `ingest_url` then reads the file with `local_path.read_bytes()` **after** validation. An attacker who can replace the file with a symlink (or rename a file) between validation and read could cause the worker to read an arbitrary file outside the allowed directory, leaking its contents into the shared corpus. The comment claims protection, but the code never opens the file atomically (`O_NOFOLLOW`/`open(..., flags=os.O_RDONLY|os.O_NOFOLLOW)`).  
  *Evidence*: validation at `mira-crawler/tasks/_shared.py:115‑124`; read at `mira-crawler/tasks/_shared.py:138‑144`.  

- **[severity: medium] Host‑allowlist bypass via Unicode / IDN**  
  `_curated_hosts` extracts hostnames with `urlparse(value).hostname` and lower‑cases them, but does **not** perform IDN (punycode) normalization. An attacker could craft a URL whose Unicode host visually matches a curated domain (e.g., “ｅxample.com”) but resolves to a different punycode domain, slipping past the `host in hosts` check.  
  *Evidence*: host extraction loop in `mira-crawler/tasks/_shared.py:62‑84`.  

- **[severity: medium] Redirect handling may inadvertently reject legitimate redirects**  
  The manual redirect loop follows up to `MAX_REDIRECT_HOPS`. It rejects any non‑http(s) scheme and any hop that fails `shared_corpus_source_allowed`. While this blocks uncurated redirects, a legitimate OEM site that redirects to a sub‑resource on an allowed host **via a `file://` URL** will be rejected with a generic “non‑http redirect target” error, causing an unnecessary denial‑of‑service for otherwise safe content.  
  *Evidence*: redirect loop in `mira-crawler/tasks/_shared.py:167‑197`.  

- **[severity: low] Stale cached curated‑host list**  
  The set of allowed hosts is loaded once into the module‑level `_CURATED_HOSTS`. If `sources.yaml` is edited while the worker process is alive (e.g., new OEM added), the gate will continue rejecting those hosts until the process restarts, leading to unexpected ingestion failures.  
  *Evidence*: caching logic at `mira-crawler/tasks/_shared.py:31‑38`.  

## NOT REVIEWED
- Runtime behavior of any code **outside** the `mira-crawler` package that calls `insert_chunk`, `store_chunks`, or `ingest_text_inline`. Those call sites were not examined; they may still be using the old signature, which would cause crashes not visible from the diff alone.  
- Interaction with database migrations/rollbacks: the new `is_private` column is referenced in raw SQL; we did not verify that migration scripts add the column with appropriate defaults or that old rows are back‑filled safely.  
- Observability: no new logs or metrics were added around the curation gate failures; we cannot tell from the diff whether alerting will surface a sudden surge of “uncurated_source” rejections.  
- Unit‑test coverage for the TOCTOU scenario and Unicode host bypass; the existing red‑first tests likely do not simulate a race or an IDN attack vector.  

These gaps mean the diff could still hide regressions that only appear in production workloads.

## Cascade attempts

- `groq: ok`
