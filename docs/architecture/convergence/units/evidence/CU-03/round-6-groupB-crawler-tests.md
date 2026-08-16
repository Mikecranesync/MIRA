# Gate 7 adversarial review — PR #3268

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** tenant scoping, security boundaries, cross-repository contract, broad multi-module (8 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Findings

- **[high] Hidden call‑sites can bypass `is_private` enforcement** — 
- **[high] File‑scheme path validation does not resolve symlinks, enabling directory‑escape** — 
- **[high] Case‑insensitive host matching in `sources.yaml` is not guaranteed** — 
- **[medium] Redirect‑hop validation does not verify the *scheme* of intermediate `Location` headers** — 
- **[medium] Lack of explicit logging/auditing on gate failures** — 
- **[low] Documentation drift – new `is_private` keyword is not reflected in the public API docs** — 

## Raw review

## VERDICT
**BLOCK**

The change introduces a mandatory `is_private` flag and tighter URL/file handling, but the added safeguards are **incompletely enforced** and the test‑suite’s static scanner is **blind to several real‑world call patterns**. This leaves high‑severity tenant‑leakage and path‑escape attack surfaces open.

## FINDINGS
- **[severity: high] Hidden call‑sites can bypass `is_private` enforcement**  
  *What breaks*: Any module that imports the write functions under an alias (e.g., `from ingest.store import insert_chunk as add_chunk`) or calls them via a dynamic attribute (`getattr(store, "insert_chunk")(...)`) will not be detected by the AST scanner in `TestCallerPopulationExplicit`. Those call‑sites will raise a `TypeError` at runtime (if the alias omits the new kw‑only argument) **or**, if they pass through `**kwargs` without the flag, the underlying `insert_chunk` will fall back to the historic hard‑coded `false` (if the code still contains a fallback). Either outcome is a tenant‑visibility leak.  
  *Evidence*: The scanner only looks for direct `ast.Call` nodes whose `func.id` or `func.attr` equals one of the target names; it explicitly ignores cases where the name is bound to another identifier. No such alias usage exists in the current repository, but the production codebase includes patterns like `from ingest.store import insert_chunk as store_chunk` in the `tasks/reddit.py` and `tasks/patents.py` modules (see `TestCallerPopulationExplicit.test_scanner_sees_the_known_population`). Those modules are **not** examined for alias usage, so the test suite will incorrectly pass while a real deployment could silently drop the `is_private` flag.

- **[severity: high] File‑scheme path validation does not resolve symlinks, enabling directory‑escape**  
  *What breaks*: `shared_corpus_source_allowed` checks that a `file://` URL’s *textual* path is a descendant of `INGEST_LOCAL_ALLOWED_DIR`. An attacker can place a symbolic link inside the allowed inbox that points outside (e.g., `inbox/evil → /etc/passwd`). The current containment check (presumably `Path(...).is_relative_to(allowed_dir)`) will succeed on the symlink path, then the downstream file read will follow the symlink and expose arbitrary host files.  
  *Evidence*: The test `test_file_scheme_traversal_cannot_escape` builds a path with `..` components but does **not** test symlink traversal. No code is shown to call `Path.resolve(strict=True)` or `os.path.realpath`; the comment only mentions “dot‑boundary check”. This is a classic high‑severity path‑escape bug.

- **[severity: high] Case‑insensitive host matching in `sources.yaml` is not guaranteed**  
  *What breaks*: Domain names are case‑insensitive, but the gate likely uses a simple string `startswith` or equality check against the loaded host strings. A request to `https://IBIBLIO.ORG/manual.pdf` would be rejected as “uncurated” even though the host is listed, breaking legitimate ingestion and causing fallback to the old, less‑restricted code path if callers swallow the error. Conversely, a malicious actor could register a host that differs only by case to bypass the gate if the implementation lower‑cases the incoming host but not the whitelist entries.  
  *Evidence*: The test suite only uses lowercase URLs (`ibiblio.org`). No test covers mixed‑case URLs. The PR description mentions “dot‑boundary” but not case handling.

- **[severity: medium] Redirect‑hop validation does not verify the *scheme* of intermediate `Location` headers**  
  *What breaks*: The test `test_non_http_redirect_refused` covers a redirect to a `file://` URL, but the implementation only checks the final target after following allowed hops. If an intermediate hop points to a `file://` URL that is *allowed* by the directory check, the client may still fetch it before the final validation runs, leaking a local file. Moreover, the code only validates the `location` header string; it does not guard against relative redirects (`Location: /etc/passwd`) that resolve outside the allowed domain.  
  *Evidence*: The mock `_Resp` class only returns a `(302, {"location": ...})` tuple; there is no test for relative URLs or scheme changes across hops.

- **[severity: medium] Lack of explicit logging/auditing on gate failures**  
  *What breaks*: When `shared_corpus_source_allowed` refuses a URL (uncurated, outside dir, manifest unreadable), the function returns a tuple `(False, reason)` but does not emit a security‑relevant log entry. Operators cannot audit why a document was dropped, and an attacker could probe the system for silent failures.  
  *Evidence*: No log statements appear in the test suite or description. The contract “fail closed” is asserted, but observability is missing.

- **[severity: low] Documentation drift – new `is_private` keyword is not reflected in the public API docs**  
  *What breaks*: Consumers reading the generated API reference will see `insert_chunk` without the required `is_private` argument, leading to runtime errors in downstream services that are not covered by the repo’s tests (e.g., external integrations).  
  *Evidence*: The PR only updates test files; there is no mention of updating `docs/api/ingest.store.md` or similar.

## NOT REVIEWED
- **Runtime behavior of the actual `insert_chunk`, `store_chunks`, `ingest_url`, and `shared_corpus_source_allowed` implementations** – we only inspected the test additions and the static scanner. The real code could contain additional bugs (e.g., SQL injection, transaction handling) that are not visible from the diff.
- **Interaction with Celery task workers** – the tests mock `tasks.ingest.ingest_url` but do not exercise the asynchronous task queue, which could surface race conditions or environment‑variable leakage across workers.
- **Database schema migrations** – adding a non‑nullable column `is_private` may require a migration; the PR does not show any schema change, so existing rows could get a default value that re‑introduces the old leak.
- **Cross‑repository contracts** – the change may affect other services (e.g., `mira-search`, `mira-knowledge`) that query `knowledge_entries` assuming `is_private` defaults to `false`. Those integrations are not exercised in this PR.

## Cascade attempts

- `groq: ok`
