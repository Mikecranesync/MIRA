# Gate 7 adversarial review — PR #3268

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, tenant scoping, security boundaries, cross-repository contract, concurrency/idempotency/state, broad multi-module (8 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Findings

- **[high] Missing enforcement for raw SQL writers** — 
- **[medium] `shared_corpus_source_allowed` allows any `file://` URL under a configurable directory** — 
- **[low] Potential race on lazy‑initialised `_CURATED_HOSTS`** — 

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Missing enforcement for raw SQL writers** –  
  The change only hardens the *Python* store layer (`insert_chunk` / `store_chunks`) by requiring an explicit `is_private` argument. However the repository contains direct SQL execution paths that bypass this layer (e.g., ad‑hoc `engine.execute(...)` or raw `INSERT` statements in scripts). Those paths are **not** updated to enforce the visibility decision, so a tenant could still write rows with the implicit default (`false`) and leak private data.  
  Evidence: the diff only touches `mira‑crawler/ingest/store.py` and its callers; it does not modify any other module that issues SQL directly. The presence of such raw‑SQL code is known from the project history (e.g., scripts that build their own INSERT statements). Since the tests only scan the call‑site graph of the hardened functions, they cannot detect these bypasses.

- **[severity: medium] `shared_corpus_source_allowed` allows any `file://` URL under a configurable directory** –  
  The gate permits ingestion of local files when the resolved path is a sub‑path of `INGEST_LOCAL_ALLOWED_DIR` (default `/data/gdrive_sync`). If that directory is writable by an untrusted user (or a compromised container), an attacker could drop a malicious PDF or other payload there. The crawler will then ingest it as *shared* content (`is_private=False`) and run the full PDF parsing pipeline, potentially leading to code‑execution or denial‑of‑service via library bugs.  
  Evidence: implementation in `tasks/ingest.py` (lines showing `allowed_base = os.getenv(..., "/data/gdrive_sync")` and the `is_relative_to` check).

- **[severity: low] Potential race on lazy‑initialised `_CURATED_HOSTS`** –  
  The global cache is populated without a lock. Under high concurrency (many Celery workers starting simultaneously) two threads could read `None`, both parse the manifest, and assign the same frozenset. While this does not corrupt data, it creates a tiny window where a partially‑filled set could be observed (if an exception occurs mid‑parse).  
  Evidence: `_CURATED_HOSTS` definition and `_curated_hosts()` function in `tasks/ing

## Cascade attempts

- `groq: ok`
