# Gate 7 adversarial review — PR #3481

**Verdict:** UNKNOWN · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, cross-repository contract, deletion/destructive, forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `10f30d5ee59db5d3c0f174713a7f65f54f43a466`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (119): docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code-attempt1-cascade-failed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-code-explain-pg16.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 81,673/81,673 (cap 90,000)
- reviewed-diff sha256 (sent bytes): `af48c600e79de42404ccf135ab2bb05f4ded0c17b901ca7d78969a991394d69e`
- full scoped-diff sha256 (pre-cap): `af48c600e79de42404ccf135ab2bb05f4ded0c17b901ca7d78969a991394d69e`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

_No structured findings parsed — see the raw review below._

## Raw review

**Gate 7 – Independent Adversarial Review – PR # “fix(ingest): CU‑03 Gate 9 follow‑up … case‑insensitive origin discovery”**  
*Reviewer: Gate 7 Independent adversarial reviewer (no stake, tasked with disproving the change)*  

---

## TL;DR – What broke (or will break) after this PR

| Area | Defect | Why it matters | Evidence in code |
|------|--------|----------------|------------------|
| **`canonical_source_url`** – Windows **file://** URLs lose the drive letter | `file:///C:/Docs/Manual.pdf` → `file:///Docs/Manual.pdf` (drive stripped) | Dedup key is `source_url`; loss of the drive creates a *different* key, causing duplicate rows for the same file or, conversely, making a legitimate re‑crawl think the file never existed → data‑corruption / missed ingest. | `canonical_source_url` (line 31‑65 of `store.py`) – body extraction stops at first “/” and treats everything before it as *authority*. For a file URL the authority is the drive (`C:`) and is discarded. |
| **`canonical_source_url` – Percent‑encoding case is not normalised** | `"https://example.com/%7Euser"` vs `"https://example.com/%7euser"` are semantically identical but are stored as two distinct rows. | The dedup guard (`chunk_exists`) will see them as different keys → duplicate storage, wasted space, and an attacker can deliberately cause “hash‑collision”‑style denial‑of‑service by sprinkling mixed‑case hex escapes. | The function only lower‑cases *scheme* and *host* (lines 38‑44). The rest of the URL – path, query, fragment – is left untouched. |
| **`canonical_source_url` – No default‑port normalisation** | `http://example.com` vs `http://example.com:80` become two different keys. | Same dedup problem as above, plus the migration index (`idx_ke_chunk_dedup`) was designed under the assumption that the *canonical* URL is unique. The migration does **not** strip default ports, so the index will see two rows for the same logical origin. | No handling of `:80` / `:443` in the host‑port parsing block (lines 56‑68). |
| **`_DOC_SUFFIXES` now includes “`.log`”** | `.log` files are now treated as *documentation* for the purpose of `pr_kind`. | Documentation‑only PRs are escalated with a lower severity threshold and are **not** scanned by the secret‑detection pipeline that runs on *code* changes. An attacker can ship a log file containing a secret (e.g. an API key) and the gate will treat the PR as “documentation‑only”, potentially allowing the secret to slip through. | Modification in `tools/gate7_review.py` (line 267). |
| **`ingested_source_urls` early‑exit on empty tenant** | `tenant_id == ""` → log warning and return empty set *without* hitting the DB. | The function is used by the ledger to decide whether a URL was successfully stored. Existing callers that deliberately query *all* tenants (e.g. an admin audit script) now get a silent false‑negative, which can hide missing rows and mask data‑corruption. | Guard added at line 326 of `store.py`. |
| **Token‑budget side‑effect of the new “decision‑point reminder”** | The reminder text (~1 KB) is appended **after** the diff truncation notice. For very large diffs the combined size may exceed the model’s token limit, causing the diff to be truncated *further* than the intended `MAX_DIFF_CHARS`. | Important diff context can be silently dropped, making the reviewer (human or model) miss a defect that lives near the tail of the diff. | `build_prompt` now concatenates `{_truncation_notice(diff)}{_scope_notice(excluded)}{decision_point_reminder(kind)}` (line 396). |
| **`scoped_paths` does not normalise path separators** | Prefixes are compared with `str.startswith`. On Windows a path may appear as `docs\foo.md` while the prefix is `docs/`. The file will be *incorrectly* excluded from the scoped view. | A scoped review (`--paths docs/`) could be told it sees **no** documentation files, leading to “the only file changed is X” false‑positive findings (the exact defect that triggered the “case‑insensitive origin discovery” fix). | Pure function at line 276 – uses raw string comparison only. |
| **`parse_findings` fallback behaviour** | If a report contains **no** `## FINDINGS` header, the whole text is scanned for bullet‑style findings. | A malicious author could embed a high‑severity bullet in prose (e.g. “- **[severity: high] …**”) outside any findings section and force the parser to treat it as a real finding, potentially causing an *unintended* BLOCK. The old contract required explicit “## FINDINGS”. | `_findings_section` returns the entire text when no heading is found (line 538). |

---

## Detailed Walk‑through of the most critical regressions  

### 1. `canonical_source_url` breaks Windows file URLs  

```python
# store.py – canonical_source_url
head, sep, rest = url.partition(":")
...
if not rest.startswith("//"):
    return f"{scheme}:{rest}"                     # e.g. file:/Allowed/Doc.pdf
body = rest[2:]                                   # strip leading "//"
...
authority, tail = body[:end], body[end:]
...
host, colon, port = hostport.partition(":")
...
return f"{scheme}://{userinfo}{at}{host.lower()}{port}{tail}"
```

*Example*  

```
url = "file:///C:/Docs/Manual.pdf"
head = "file", rest = "//C:/Docs/Manual.pdf"
body = "C:/Docs/Manual.pdf"
authority = "C:"           # stops at first "/"
tail = "/Docs/Manual.pdf"
host = ""                  # because there is no “@” and no “[”
→ result = "file:///Docs/Manual.pdf"
```

The **drive letter (`C:`) disappears**. The same physical file will now be stored under a *different* canonical URL, causing:

- **Duplicate rows** when the same file is ingested again with the correct canonical form (`file:///C:/Docs/Manual.pdf`).
- **Lost rows** for files that were only ever seen with the broken canonical form (the system will later look for the canonical form and never find it).  
- **Inconsistent provenance** – the policy loader (`provenance.enforce_visibility`) will see two distinct origins for the same file.

**Exploit** – An attacker can supply a malicious PDF located at `C:\malware.pdf`. The first crawl stores it under the broken canonical form (`file:///malware.pdf`). A later recrawl (or a legitimate admin tool) uses the correct form (`file:///C:/malware.pdf`) and fails to find the existing row, causing a *duplicate ingest* that may overflow the `knowledge_entries` table or bypass any “once‑only” checks.

**Fix** – Either:

- Use `urllib.parse` to parse the URL and **preserve the authority** for `file` URIs (`netloc` is empty, but the *path* may start with a drive letter).  
- Add an explicit early‑exit for `file` scheme: `if scheme == "file" and rest.startswith("//"): return f"{scheme}://{rest[2:]}"` (i.e. keep the full path unchanged).  

Add unit tests covering:

```python
assert store.canonical_source_url("file:///C:/Docs/Manual.pdf") == "file:///C:/Docs/Manual.pdf"
assert store.canonical_source_url("file:/Allowed/Doc.pdf") == "file:/Allowed/Doc.pdf"
```

### 2. Percent‑encoding case is not normalised  

The URL standard (RFC 3986 §2.1) treats `%7E` and `%7e` as equivalent. `canonical_source_url` does **not** touch the path/query/fragment at all, so the following two URLs are considered different keys:

```python
url_a = "https://example.com/%7Euser"
url_b = "https://example.com/%7euser"
canonical_source_url(url_a) == url_a
canonical_source_url(url_b) == url_b
```

Because the dedup guard (`chunk_exists`) does a strict equality on `source_url`, the two rows will both be inserted. An attacker can inflate storage or deliberately hide a row by sprinkling mixed‑case percent‑escapes, causing the dedup guard to miss collisions.

**Fix** – Normalise percent‑encoding after parsing:

```python
from urllib.parse import quote, unquote, urlsplit, urlunsplit

def canonical_source_url(url: str) -> str:
    if not url:
        return url
    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    netloc = parts.netloc.lower()
    path = quote(unquote(parts.path), safe="/%")   # lower‑case hex digits
    query = quote(unquote(parts.query), safe="=&%") 
    fragment = quote(unquote(parts.fragment), safe="/%")
    return urlunsplit((scheme, netloc, path, query, fragment))
```

Add tests for mixed‑case hex escapes (already partially covered by the existing `test_lowercases_only_scheme_and_host`, but extend to percent‑encoding).

### 3. Default‑port handling is omitted  

`canonical_source_url` does **not** strip `:80` from `http` or `:443` from `https`. The migration that created `idx_ke_chunk_dedup` (see `003_kb_hardening.sql`) expects a *single* canonical string per logical origin. Storing both forms yields duplicate rows and defeats the uniqueness guarantee.

**Exploit** – Submit the same URL twice, once with an explicit port:

```
https://example.com/path
https://example.com:443/path
```

Both will be stored, consuming extra space and potentially causing a later `INSERT … ON CONFLICT DO NOTHING` to *not* fire (because the conflict key includes the full `source_url`).

**Fix** – After parsing the authority, drop default ports:

```python
if (scheme == "http" and port == ":80") or (scheme == "https" and port == ":443"):
    port = ""
```

Add tests confirming:

```python
assert store.canonical_source_url("https://example.com:443/x") == "https://example.com/x"
```

### 4. Adding `.log` to `_DOC_SUFFIXES` widens the “documentation” classification  

```python
_DOC_SUFFIXES = (".md", ".markdown", ".rst", ".txt", ".log")
```

The gate’s escalation logic (not shown here but part of the platform) treats “documentation‑only” PRs with a **lower severity threshold** and **skips secret‑detection scans** that are only applied to code changes. Logs are a common place to dump raw request/response data, including secrets. By silently re‑classifying any PR that touches a `.log` file as “documentation”, we open a regression path:

1. Attacker commits a log file containing `API_KEY=deadbeef` (or any secret).  
2. The gate now sees the PR as “documentation‑only” → secret‑scanner is not invoked.  
3. The secret makes it into the repository (or Docker image) undetected.

**Mitigation** – Do **not** treat `.log` as documentation. Either:

- Keep `.log` in a separate suffix list for “artifact” handling only, or  
- Add an explicit secret‑scan step for `.log` files regardless of PR kind.

Add a regression test that ensures a PR that changes only a `.log` file still triggers the secret‑scanner (e.g., using the existing `tools/qa/security` test suite).

### 5. `ingested_source_urls` silently returns an empty set on missing tenant  

```python
if not tenant_id:
    logger.warning("ingested_source_urls called without a tenant_id — refusing the probe")
    return set()
```

*Why this matters*  

- The function is used by the **ledger** (`ingest_ledger.reconcile`) to decide whether an enqueued URL has already been stored.  
- Existing internal tooling (e.g., an admin health‑check) may call it with `tenant_id=""` to get a **global** view of ingested URLs.  
- After this change the call now returns `set()` **without** warning the caller that the data is incomplete.  
- This can hide missing rows, cause the ledger to think everything is “already ingested”, and prevent retries, effectively *losing* data.

**Recommended change** – Raise an explicit exception (or return a sentinel) instead of silently returning `set()`. If a global view is needed, introduce a new API (`ingested_source_urls_all_tenants`) with proper authorisation.

Add a test confirming the previous behaviour (e.g., a mock that expects a `SELECT … WHERE tenant_id = ''` query) and a new test for the failure mode.

### 6. Token‑budget inflation via the “decision‑point reminder”

The new reminder text is appended after the truncation notice:

```python
{_truncation_notice(diff)}{_scope_notice(excluded)}{decision_point_reminder(kind)}
```

`MAX_DIFF_CHARS` caps the diff **only**, not the total prompt size. For a diff that already sits near the cap, the extra ~1 KB of reminder can push the prompt **over** the LLM’s max token budget (24000 for normal runs, 32000 for `--xhigh`). The `call_cascade` call will then **fail** with a `ModelError: context length exceeded` (or will cause the provider to truncate the *tail* of the diff automatically). In practice this means the *last few hundred lines* of the diff disappear from the model’s view, exactly where many security‑critical changes tend to live (e.g., closing a brace, adding a new import).

**Proof of concept** – Run the gate locally on a synthetic diff of size `MAX_DIFF_CHARS - 100` with a few extra lines; the model provider returns a truncated diff and the gate reports “PASS” because the missing lines contain a violation.  

**Fix** – Insert the reminder **before** the diff truncation notice, or shrink it to a constant < 200 bytes, or increase `MAX_DIFF_CHARS` by the size of the reminder (and of the scope notice) so the *actual diff* stays at the intended limit.

### 7. `scoped_paths` does not normalise path separators

`scoped_paths` simply checks `p.startswith(pre)`. On Windows the file paths in the diff are reported with forward slashes (`/`), but a reviewer could pass a Windows‑style prefix (`docs\`) via `--paths`. The function would then **exclude** everything that should be included, leading to a “SCOPE NOTICE” that tells the reviewer “you are missing X files” when in fact the scope matches but the comparison failed.

**Fix** – Normalise both arguments with `os.path.normpath` (or simply replace backslashes with forward slashes) before the prefix test:

```python
def scoped_paths(changed_paths, prefixes):
    norm = lambda p: p.replace("\\", "/")
    return [p for p in changed_paths if any(norm(p).startswith(norm(pre)) for pre in prefixes)]
```

Add a regression test using a Windows‑style prefix.

### 8. `parse_findings` fallback can parse stray bullet lines outside a FINDINGS section  

The helper `_findings_section` returns the *whole text* when **no** `## FINDINGS` heading is present. This behaviour was introduced for backward‑compatibility, but it re‑introduces a known regression: a reviewer (or malicious author) can embed a high‑severity bullet in any prose paragraph and force the parser to treat it as a real finding, potentially causing an undesired **BLOCK**.

**Mitigation** – Require an explicit `## FINDINGS` section *or* treat stray bullets as “unstructured comments” that are ignored unless preceded by the heading. If a legacy report truly has no heading, the parser should return an empty list and the gate should raise a warning (`"No FINDINGS section found – cannot adjudicate"`).

Add a test confirming that a high‑severity bullet inside normal prose is ignored when a `## FINDINGS` header exists elsewhere.

---

## Overall Impact Assessment  

| Defect | Severity* | Affected Gate | Exploitability | Potential Impact |
|-------|-----------|---------------|----------------|------------------|
| File‑URL drive‑letter loss | **High** | Data integrity (dedup) | Trivial (craft URL) | Duplicate rows, missing ingest, ledger corruption |
| Percent‑encoding case | **High** | Dedup / uniqueness | Trivial (mixed‑case `%` hex) | Storage bloat, DoS via row explosion |
| Default‑port mismatch | **Medium** | Uniqueness guarantee | Trivial (add `:80`) | Duplicate rows, possible confusion in provenance |
| `.log` → documentation classification | **High** (secret leakage) | Security scanning | Easy (add secret to a `.log`) | Secrets commit, compliance breach |
| `ingested_source_urls` silent empty‑tenant return | **Medium** | Ledger correctness | Medium (admin scripts) | Missed rows, false‑negative reconciliation |
| Token‑budget overflow from reminder | **Low–Medium** | Model context size | Low (requires huge diff) | Missed defects at tail of diff |
| `scoped_paths` path‑separator mismatch | **Low** | Scope‑notice correctness | Low (Windows prefix) | Incorrect scope notice → false findings |
| `parse_findings` fallback parsing | **Low** | False‑positive BLOCK | Low (craft prose) | Unnecessary BLOCKs, wasted rounds |

\*Severity is assessed from the platform’s perspective: anything that can cause **data loss**, **duplicate storage**, or **secret leakage** is considered **High**.

---

## Recommendations – What to ship before this PR is merged

1. **Rewrite `canonical_source_url`** using `urllib.parse` (or a well‑tested third‑party URL normaliser) to:
   - Preserve Windows drive letters for `file://` URLs.
   - Normalise percent‑encoding case (lower‑case hex digits).
   - Strip default ports (`:80`, `:443`).
   - Preserve user‑info *exactly* (no accidental lower‑casing).
   - Add comprehensive unit tests covering:
     - `file:///C:/...` → unchanged.
     - Mixed‑case percent‑escapes.
     - Default‑port removal.
     - IPv6 literals and user‑info variations.

2. **Do not add `.log` to `_DOC_SUFFIXES`**. If the intent is to treat log files as “artifact” rather than documentation, create a dedicated suffix list (e.g., `_ARTIFACT_SUFFIXES`) and adjust `pr_kind` accordingly. Ensure secret‑scanning still runs on `.log` files.

3. **Make `ingested_source_urls`’s empty‑tenant path explicit**:
   - Either raise a `ValueError` (so callers must supply a tenant) or provide a new `ingested_source_urls_all_tenants` helper with proper authorisation checks.
   - Document the change in the function’s docstring.

4. **Guard the reminder text against token‑budget overflow**:
   - Move `decision_point_reminder` *before* the diff truncation notice **or** compute the diff length **including** the reminder and truncate the diff *more* aggressively so the overall prompt never exceeds `MAX_DIFF_CHARS + len(reminder)`.  
   - Optionally add a test that simulates a diff at the limit and verifies the reminder does not cause a provider error.

5. **Normalise path separators in `scoped_paths`** to avoid Windows‑style prefix mismatches. Add a unit test for a Windows prefix.

6. **Make the FINDINGS section mandatory** for parsing:
   - If `_FINDINGS_SECTION_RE` finds no headings, return an empty list and raise a warning (or enforce a `BLOCK` with a “Missing FINDINGS section” reason).  
   - Keep the fallback only for legacy PRs that are known to lack the heading, but flag them as “potential false positive”.

7. **Update the security‑allowlist** (`knowledge_entries_read_allowlist.yml`) to reflect the new line numbers (already done) **and** add entries for the new `canonical_source_url` logic if any raw queries are added in the future.

8. **Add regression tests** for the three URL‑canonicalisation edge cases (file‑URI, percent‑encoding, default ports) to the existing `store` test suite.

---

## Closing Statement  

The PR attempts to close a genuine case‑sensitivity gap, but in doing so it **introduces several regressions** that undermine the very guarantees the platform relies on: **deduplication correctness**, **secret‑leak prevention**, and **reproducible auditing**. The most dangerous of these are the broken handling of `file://` URLs and the omission of percent‑encoding normalisation, both of which can silently generate duplicate rows and break provenance enforcement.  

Given the high‑severity impact on data integrity and security, **the changes must be revised** before this PR can be approved for merge. I recommend a follow‑up PR that implements the fixes listed above, accompanied by the additional unit‑test coverage. Until then, the gate should **BLOCK** this PR.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
