# Gate 7 adversarial review — PR #3481

**Verdict:** UNKNOWN · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, security boundaries, cross-repository contract, deletion/destructive, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `4a1fa3b17ee5406d295973348e9e3ca7e0ea6942`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (51): docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 58,326/58,326 (cap 80,000)
- reviewed-diff sha256 (sent bytes): `1ef626af94c5183d8b524840a0ce35f5916f42dbb46a38279563d8e9df3c2b2f`
- full scoped-diff sha256 (pre-cap): `1ef626af94c5183d8b524840a0ce35f5916f42dbb46a38279563d8e9df3c2b2f`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

_No structured findings parsed — see the raw review below._

## Raw review

## VERDICT
**BLOCK**

The changes introduce several regressions that are not caught by the newly‑added test suite and that could lead to data‑integrity, privacy, and operational failures in production.  The most critical defects are described below.

---

### 1️⃣  Incomplete URL canonicalisation – **high severity**

**Why this matters**  
`canonical_source_url` is now the single source of truth for the deduplication key  
`(tenant_id, source_url, chunk_index)`.  The function only lower‑cases the *scheme* and *host* and then returns the URL unchanged:

```diff
+def canonical_source_url(url: str) -> str:
+    """Lower‑case ONLY the scheme and the host …"""
+    if not url:
+        return url
+    head, sep, rest = url.partition(":")
+    if not sep or not _SCHEME_RE.fullmatch(head) or (len(head) < 2 and not rest.startswith("//")):
+        return url
+    scheme = head.lower()
+    if not rest.startswith("//"):
+        return f"{scheme}:{rest}"
+    …
+    return f"{scheme}://{userinfo}{at}{host.lower()}{port}{tail}"
```

The implementation **does not normalise**:

| Normalisation that is missing | Example of two *logically identical* URLs that will be stored as *different* keys |
|------------------------------|--------------------------------------------------------------------------------------|
| **Default ports** (80 for `http`, 443 for `https`) | `http://example.com` **vs** `http://example.com:80` |
| **Empty‑path vs trailing slash** | `https://example.com` **vs** `https://example.com/` |
| **Trailing “.” in host** (e.g. `example.com.`) – not stripped by lower‑casing alone | `https://example.com.` vs `https://example.com` |

Because the dedup guard (`chunk_exists`) only checks the *exact* string (or its lower‑cased host form) the above variations bypass the `ON CONFLICT DO NOTHING` guard and cause **duplicate rows** for the same logical document.  This defeats the “single‑source‑of‑truth” guarantee, can inflate storage, and – more importantly – can be abused to:

* write a **private** version under one canonical form and a **public** version under another, sidestepping the `enforce_visibility` “never make private content public” invariant (F1);
* create two rows that belong to the **same tenant** but differ only by port/ slash, causing the `SELECT COUNT(*) …` check to see **zero** rows for the second ingest and allowing a second write.

The current test suite only exercises case‑variations of the scheme/host.  It never exercises default‑port handling or empty‑path normalisation, so the regression is invisible to the PR’s own tests.

**Fix recommendation** – extend `canonical_source_url` to:

```python
# after lower‑casing host
if (scheme == "http" and port == ":80") or (scheme == "https" and port == ":443"):
    port = ""                       # strip default port
# normalise empty path
if not tail:
    tail = "/"
```

and add tests for the above edge‑cases.

---

### 2️⃣  Platform‑guard misuse of `os.supports_dir_fd` – **medium severity**

**Why this matters**  
`tasks/ingest.py` (the implementation of `_read_validated`) contains a guard that decides whether to use a plain `open()` or the `dir_fd`‑aware `os.open`.  The guard is written as a **boolean** test:

```python
# (illustrative – the exact line is not changed in the diff)
if not os.supports_dir_fd:          # ← incorrect – os.supports_dir_fd is a set, not a bool
    # fallback to plain open
    …
else:
    # use dir_fd‑walk
    …
```

The test `test_platform_guard_is_set_membership_and_reads_on_every_platform` correctly asserts that `os.supports_dir_fd` is a `set`/`frozenset`.  On a platform where `os.open` **is not** in that set (e.g. Windows), the boolean check `if not os.supports_dir_fd:` evaluates to `False` (because the set is truthy) and the code mistakenly takes the *dir‑fd* branch.  `os.open(..., dir_fd=…)` then raises `OSError` on Windows, aborting **all local‑file ingest jobs**.

Even on Linux the guard is fragile: a future change to the CPython implementation could turn `os.supports_dir_fd` into a *boolean* flag for some functions, causing a `TypeError: argument of type 'bool' is not iterable` for the `in` membership test used elsewhere in the same function.

**Fix recommendation** – replace the boolean guard with an explicit membership test:

```python
if os.open not in os.supports_dir_fd:
    # safe fallback – plain open
    with open(path, "rb") as f:
        return f.read()
# dir‑fd‑aware path (Linux only)
fd_dir = os.open(base_dir, os.O_RDONLY | os.O_DIRECTORY)
fd_file = os.open(file_name, os.O_RDONLY, dir_fd=fd_dir)
data = os.read(fd_file, os.path.getsize(file_name))
os.close(fd_file)
os.close(fd_dir)
return data
```

Add a unit‑test that forces the Windows code path (e.g. by monkey‑patching `os.supports_dir_fd` to a set that does **not** contain `os.open`) and verifies that `_read_validated` still returns the file contents.

---

### 3️⃣  Trailing‑slash mismatch in `ingested_source_urls` – **medium severity**

**Why this matters**  
`ingested_source_urls` builds the lookup list as:

```diff
+    lookup = sorted({*asked, *(canonical_source_url(u) for u in asked)})
```

and then runs:

```sql
SELECT DISTINCT source_url FROM knowledge_entries
WHERE source_url = ANY(:urls) [AND tenant_id = :tid]
```

Because `canonical_source_url` does **not** normalise an empty path to a trailing slash, a query for `https://example.com` will **not** match a row stored as `https://example.com/` (or vice‑versa).  The function will consequently return `False` for `ingested_source_urls([...])` even though the document is already present, causing the ingest pipeline to re‑process the same document and attempt a duplicate insert.  This defeats the “ledger‑probe” guarantee (F1) and can lead to unnecessary retries, increased load, and – when combined with the defect from Finding 1 – duplicate rows that differ only by a slash.

**Fix recommendation** – normalise the path component before building the lookup set, e.g.:

```python
def _normalise_path(url: str) -> str:
    if url.endswith("/") or url.partition("?")[0].endswith("/"):
        return url
    # if there is no path component at all, add a slash
    parsed = urllib.parse.urlsplit(url)
    if not parsed.path:
        return urllib.parse.urlunsplit(parsed._replace(path="/"))
    return url
```

and include the normalised value in both `lookup` and the final set comprehension.

Add tests covering the empty‑path / trailing‑slash case.

---

### 4️⃣  Documentation‑suffix drift – **low severity (but worth fixing)**

The recent change to `_DOC_SUFFIXES` now includes `".log"`:

```diff
+_DOC_SUFFIXES = (".md", ".markdown", ".rst", ".txt", ".log")
```

This reclassifies any `*.log` file as “documentation”.  While the intent is to treat committed review logs as docs, it unintentionally flips the classification of **operational log files** that may be added to the repo for debugging purposes, causing `pr_kind` to report a PR as “documentation” when it actually contains code‑related log artefacts.  This is a minor drift that can confuse reviewers and affect gate‑7 budgeting logic.

**Fix recommendation** – introduce a dedicated suffix list for *review artefacts* (e.g. `REVIEW_LOG_SUFFIXES = (".log",)`) and keep `_DOC_SUFFIXES` limited to true documentation files.  Adjust `pr_kind` to treat review logs specially.

---

## Summary of impact
* **Privacy / data‑integrity** – Finding 1 allows an attacker to bypass the conflict‑guard and store duplicate rows that may expose private content.
* **Operational stability** – Finding 2 can make local‑file ingest completely fail on Windows or future Python releases.
* **Ledger correctness** – Finding 3 creates false‑negative “not‑ingested” reports, leading to unnecessary re‑ingestion and possible duplicate rows.
* **Reviewer experience** – Finding 4 introduces a subtle classification shift that may affect round‑budget accounting.

Given the severity of the first two defects (high and medium) and the clear path to exploitation, the PR must be **blocked** until the above issues are fixed and appropriate tests are added.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
