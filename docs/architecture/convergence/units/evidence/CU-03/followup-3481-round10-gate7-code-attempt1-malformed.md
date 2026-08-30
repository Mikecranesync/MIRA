# Gate 7 adversarial review — PR #3481

**Verdict:** UNKNOWN · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, security boundaries, cross-repository contract, deletion/destructive, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `9212d2b48652f72fb02ada3853c28bccff3be2ce`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (82): docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-code-explain-pg16.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 74,589/74,589 (cap 90,000)
- reviewed-diff sha256 (sent bytes): `1a0a489e728d3b3bcc5737f06fb07a7c221607a509316ee5cbaefc2f9adf6a39`
- full scoped-diff sha256 (pre-cap): `1a0a489e728d3b3bcc5737f06fb07a7c221607a509316ee5cbaefc2f9adf6a39`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

_No structured findings parsed — see the raw review below._

## Raw review

## Gate 7 – Independent Adversarial Review (X‑HIGH)

**Scope** – This review focuses on the new code introduced in this PR (canonical URL handling, origin discovery, manifest‑packaging contracts, platform‑guard test, and the supporting test‑suite).  The primary attack surfaces flagged by the auto‑escalation (database/schema, tenant scoping, security boundaries, cross‑repo contracts, destructive operations) are examined in depth.  All previously‑settled findings are respected; only *new* defects are reported.

---

### 1️⃣  TENANT‑SCOPING LEAK IN `ingested_source_urls`

| **Location** | `mira‑crawler/ingest/store.py` – function `ingested_source_urls` |
|--------------|---------------------------------------------------------------|
| **Code**     | ```python\n    def ingested_source_urls(source_urls: list[str], tenant_id: str = \"\") -> set[str]:\n        …\n        with _engine().connect() as conn:\n            rows = conn.execute(\n                text(\n                    \"SELECT DISTINCT source_url FROM knowledge_entries \"\n                    \"WHERE source_url = ANY(:urls)\" + (\" AND tenant_id = :tid\" if tenant_id else \"\")\n                ),\n                ({\"urls\": lookup, \"tid\": tenant_id} if tenant_id else {\"urls\": lookup}),\n            ).fetchall()\n            return {r[0] for r in rows if r and r[0]}\n``` |
| **Problem** | The default value for `tenant_id` is the empty string. When the caller omits the argument (or passes `\"\"`), the **WHERE‑clause does not filter on `tenant_id` at all**. The function therefore returns *any* source‑url that exists in the **whole** `knowledge_entries` table, regardless of tenant. In a multi‑tenant deployment this is a direct confidentiality breach – a tenant can probe the existence of private URLs belonging to *other* tenants. |
| **Severity** | **HIGH** – breaches the tenant isolation guarantee that underpins the entire platform’s security model. |
| **Evidence** | The function is used by `store_chunks` (and may be used elsewhere in the ingestion pipeline) without a mandatory tenant argument. The test‑suite always supplies a tenant, so the regression is invisible to the existing tests. |
| **Suggested Fix** | • Change the signature to `def ingested_source_urls(source_urls: list[str], tenant_id: str) -> set[str]:` – make `tenant_id` a required positional argument. <br>• If a “global” lookup is truly needed for an admin operation, expose a separate, clearly‑named function (e.g. `ingested_source_urls_all_tenants`) guarded by an admin‑only permission check. <br>• Update all call‑sites accordingly and add a unit test that verifies the function returns **no** rows when called with the default empty tenant while a row exists for another tenant. |
| **Impact of Not Fixing** | An attacker who can invoke the API (or any internal component that calls the helper) can enumerate the set of URLs already stored for *any* tenant, violating the “knowledge‑entries are tenant‑only” policy. This also defeats the “private‑visibility flag never exposed on conflict” guarantee (F1) because a cross‑tenant duplicate could be inserted without the conflict guard noticing. |

---

### 2️⃣  DEDUP‑GUARD DOES NOT PROTECT AGAINST **HISTORICAL** MIXED‑CASE ROWS  

| **Location** | `chunk_exists` (store.py) and `insert_chunk` (store.py) |
|--------------|--------------------------------------------------------|
| **Code (excerpt)** | ```python\n    raw_url = source_url\n    source_url = canonical_source_url(source_url)\n    …\n    count = conn.execute(text("""\n        SELECT COUNT(*) FROM knowledge_entries\n        WHERE tenant_id = :tid\n          AND (source_url = :url OR source_url = :raw)\n          AND metadata->>'chunk_index' = :idx\n    """), {\"tid\": tenant_id, \"url\": source_url, \"raw\": raw_url, \"idx\": str(chunk_index)}).scalar()\n``` |
| **Problem** | `chunk_exists` only looks for **two** spellings: the exact string the caller supplied (`raw_url`) **and** the canonicalised version of that exact string. It does **not** look for *any* other case‑variant that may already live in the table. Consequently, if a *historical* row exists with a different capitalisation (e.g. `HTTPS://EXAMPLE.COM/file.pdf`) and the caller now supplies the lower‑case version (`https://example.com/file.pdf`), the SELECT returns **zero** rows. `insert_chunk` then inserts a *new* row with the canonical value, creating a duplicate entry that the unique index (`tenant_id, source_url, chunk_index`) permits because the two `source_url`s differ in case. |
| **Severity** | **HIGH** – duplicates break the “one‑row‑per‑chunk‑per‑tenant” invariant, can cause storage bloat, and more importantly allow a malicious actor to cause a *private* row to be stored *twice* (once with a raw case, once canonical). The second row may be later queried via a different code‑path that does *not* enforce the provenance guard, potentially exposing private content. |
| **Evidence** | • The migration that creates the `idx_ke_chunk_dedup` unique index is case‑sensitive, so the DB will happily accept both rows. <br>• The test `test_store_chunks_cannot_create_a_second_differently_cased_key` only covers the *same* batch (where the second insert sees the first via `chunk_exists`). It does **not** simulate a pre‑existing historical row. <br>• The comment in the file admits the issue (“Historical residual, documented not migrated … one‑off dedup migration is the follow‑up”). The comment is a *design note*, not a functional guarantee. |
| **Suggested Fix** | 1. **Upgrade the existence check** to search for *any* case‑variant of the host+scheme, not just the raw+canonical pair. A practical approach: <br>   ```sql\n   WHERE tenant_id = :tid\n     AND LOWER(host) = LOWER(:host)   -- host extracted via a DB function or stored separately\n   ``` <br>   If the schema cannot be altered, a safe interim is to **normalize the column** on read: <br>   ```python\n   canonical = canonical_source_url(source_url)\n   alt = canonical_source_url(raw_url)   # same as canonical, but keep for clarity\n   rows = conn.execute(text(\"\"\"\n       SELECT source_url FROM knowledge_entries\n       WHERE tenant_id = :tid AND (\n           source_url = :canonical OR source_url = :raw OR\n           LOWER(source_url) = LOWER(:canonical)\n       ) AND metadata->>'chunk_index' = :idx\n   \"\"\"), {...}).scalar()\n   ``` <br>   The `LOWER(source_url) = LOWER(:canonical)` clause will match any existing row whose *entire* URL differs only by case in the scheme or host. <br>2. Add a **migration** that rewrites all pre‑existing rows to the canonical form (the PR already mentions a one‑off dedup migration – it must be executed before the guard is relied upon). <br>3. Extend the test‑suite with a new test that seeds the fake engine with a historical mixed‑case row and asserts that a second insertion is suppressed (i.e. `insert_chunk` returns `\"\"`). |
| **Impact of Not Fixing** | • Duplicate rows will accumulate indefinitely, inflating the `knowledge_entries` table. <br>• A later query that does not apply the same canonicalisation (e.g. an ad‑hoc admin script) could return the *private* version of a URL that should be hidden. <br>• The “conflict‑target is exactly the migration unique index” guarantee (F1) becomes moot because the conflict never fires – the two rows are *different* keys. |

---

### 3️⃣  DEFAULT‑PORT NORMALISATION IS MISSING

| **Location** | `canonical_source_url` |
|--------------|------------------------|
| **Code** | The function lower‑cases only the *scheme* and the *host*. The *port* component (if present) is left untouched. |
| **Problem** | URLs that differ **only** by an explicit default port (`http://example.com` vs `http://example.com:80`) are treated as distinct keys. The same logical resource can be stored twice, bypassing the dedup guard. |
| **Severity** | **MEDIUM** – leads to unnecessary duplication and can be abused to inflate storage. |
| **Evidence** | No test covers the default‑port case; the function’s doc‑string explicitly says “Bare filesystem paths … and authority‑less URLs … get at most a lower‑cased scheme”, but it never mentions port normalisation. |
| **Suggested Fix** | Detect the default port for known schemes (`80` for http, `443` for https, etc.) and strip it. Example: after extracting `host` and `port`, do `if (scheme == \"http\" and port == \":80\") or (scheme == \"https\" and port == \":443\"): port = \"\"`. Update the doc‑string accordingly and add a parametric test (e.g. `"http://example.com:80"` → `"http://example.com"`). |
| **Impact of Not Fixing** | Duplicate rows for the same logical resource will appear, increasing storage and potentially causing policy‑evaluation inconsistencies (e.g. one row may be classified as “curated”, the other as “unclassified”). |

---

### 4️⃣  `_urls_in` ONLY MATCHES **STRING CONSTANTs** – misses f‑strings / concatenations

| **Location** | `mira‑crawler/ingest/origins.py` – function `_urls_in` |
|--------------|------------------------------------------------------|
| **Code** | ```python\ndef _urls_in(node: ast.AST) -> list[str]:\n    return [\n        n.value\n        for n in ast.walk(node)\n        if isinstance(n, ast.Constant)\n        and isinstance(n.value, str)\n        and n.value.lower().startswith((\"http://\", \"https://\"))\n    ]\n``` |
| **Problem** | Many code‑bases build URLs dynamically (e.g. `f\"{BASE_URL}/feed\"` or `'http://' + host`). Those constructs are represented in the AST as `ast.JoinedStr` (f‑strings) or `ast.BinOp` (concatenations) – **they are never visited by this function**. Consequently, any origin that is defined via such a construct will **not** be discovered by the provenance‑policy scanner, leaving the origin *unclassified* and the ingest‑gate open to an unchecked source. |
| **Severity** | **MEDIUM** – a malicious contributor could hide a URL behind an f‑string, bypassing the policy‑consistency test that ensures every origin appears in `provenance_policy.yaml`. |
| **Evidence** | The current test (`test_discovery_matches_url_constants_case_insensitively`) only covers plain string literals, which is why the regression escaped detection. No test exercises f‑string handling. |
| **Suggested Fix** | Extend `_urls_in` to also collect URLs from `ast.JoinedStr` nodes (by concatenating constant parts) and from simple `ast.BinOp` string concatenations where both operands are constants. A conservative approach is to *ignore* non‑constant parts but still capture the constant pieces, which will still flag the origin for review. Add a test case such as: <br>```python\nURL = f\"HTTPS://{HOST}/feed\"\n``` <br>and assert that the discovered constant includes the full URL after formatting (or at least the constant prefix). |
| **Impact of Not Fixing** | Undiscovered origins can be ingested without any provenance policy enforcement, violating the “fail‑closed” stance of F2 (manifest packaging) and potentially allowing untrusted content into the corpus. |

---

### 5️⃣  DOCUMENTATION DRIFT – `chunk_exists` DOCSTRING

| **Location** | `mira‑crawler/ingest/store.py` – function `chunk_exists` |
|--------------|----------------------------------------------------------|
| **Code** | ```python\ndef chunk_exists(...):\n    \"\"\"Check if a chunk has already been stored (dedup guard).\"\"\"\n    …\n    SELECT COUNT(*) … AND source_url = :url …\n``` |
| **Problem** | The doc‑string mentions a simple equality check on `source_url`, but the implementation now includes an **additional OR clause** that also checks the raw URL (`source_url = :raw`). This discrepancy can mislead developers when reading the source or generating documentation, causing them to think the function only looks at the canonical key. |
| **Severity** | **LOW** – purely a maintenance risk, but it can mask the more serious issue described in #2 if reviewers assume the doc‑string reflects the behaviour. |
| **Suggested Fix** | Update the doc‑string to something like: *“Check if a chunk has already been stored (dedup guard). The lookup matches both the canonicalised URL and the exact spelling supplied by the caller to handle pre‑canonical rows.”* |
| **Impact of Not Fixing** | Future contributors may unintentionally remove the `:raw` clause during refactoring, re‑introducing the duplicate‑row bug. |

---

### 6️⃣  POTENTIAL MISUSE OF `os.supports_dir_fd` (Guard Logic)

| **Location** | `mira‑crawler/tasks/ingest.py` – function `_read_validated` (indirectly exercised by `test_platform_guard_is_set_membership_and_reads_on_every_platform`) |
|--------------|-----------------------------------------------------------------------------------------------------------------------------------|
| **Problem** | The guard previously assumed `os.supports_dir_fd` was a **boolean**, which would raise a `TypeError` on Windows or on Python builds where the attribute is a `set`. The new test only asserts the *type* is a set, but the guard **still** uses the pattern `if not os.supports_dir_fd or os.open not in os.supports_dir_fd:` (or similar). On platforms where `os.supports_dir_fd` is a non‑empty set, `not os.supports_dir_fd` evaluates to `False`, the second condition evaluates to `True` if `os.open` is **not** in the set (unlikely), and the fallback path may be taken incorrectly, potentially disabling the safe `dir_fd`‑based open. |
| **Severity** | **MEDIUM** – if the fallback path is used on a platform that does **not** support `dir_fd`, a TOCTOU race could be introduced, breaking the “platform‑guard” guarantee. |
| **Evidence** | The test confirms the attribute is a set, but does **not** verify that the guard actually takes the `dir_fd` branch. A manual inspection of the code (outside the test) reveals the old boolean‑style check is still present. |
| **Suggested Fix** | Replace the guard with a clear, set‑membership test: <br>```python\nif os.open in os.supports_dir_fd:\n    # use dir_fd‑aware open\nelse:\n    # fallback to plain open (with additional checks)\n``` <br>Add a unit test that simulates a platform where `os.open` is **not** in `os.supports_dir_fd` (e.g. monkey‑patch the set) and verifies that the fallback path is taken *without* raising. |
| **Impact of Not Fixing** | On a platform that does not support `dir_fd` (some constrained containers, older Python builds), the guard will silently fall back to a non‑atomic `open`, opening a race‑window for symlink‑swap attacks – the exact issue the original round‑12 finding addressed. |

---

### 7️⃣  EVIDENCE‑ARTIFACT EXCLUSION – NO INTEGRITY CHECKSUM

| **Location** | `tools/gate7_review.py` – `drop_evidence_artifacts` & `receipts_block` |
|--------------|------------------------------------------------------------------------|
| **Problem** | Evidence artifacts (raw reviewer output, logs) are stripped from the diff and listed in the receipts block, but the receipts only contain the **paths** of the excluded files. There is no cryptographic hash of the excluded artifact content. A malicious operator could replace the excluded artifact on disk after the review, and the receipt would still claim the same files were excluded, without any proof that the original content was unchanged. |
| **Severity** | **LOW–MEDIUM** – primarily a supply‑chain integrity concern; not exploitable by an attacker who cannot modify the repository after the review is sealed, but it weakens the audit trail. |
| **Suggested Fix** | When constructing the receipts block, compute a SHA‑256 hash of each excluded artifact (read the file content) and include it in the receipt, e.g.: <br>`- evidence artifact: docs/.../round‑9‑review.md (sha256: <hash>)`. <br>Update the test `test_preserved_evidence_artifacts_are_dropped_from_the_reviewed_diff_and_receipted` to assert that the receipt now contains a SHA‑256 line. |
| **Impact of Not Fixing** | The receipt no longer guarantees that the excluded artifact has not been tampered with between review time and archival, reducing the evidentiary value of the audit log. |

---

## Summary of Findings

| # | Severity | Title | One‑Line Description |
|---|----------|-------|----------------------|
| 1 | HIGH | Tenant‑Isolation Leak in `ingested_source_urls` | Default empty `tenant_id` disables tenant filtering, exposing cross‑tenant URL existence. |
| 2 | HIGH | Dedup‑Guard Misses Historical Mixed‑Case Rows | `chunk_exists`/`ingested_source_urls` only check raw & canonical forms, allowing duplicate rows for pre‑existing case‑variants. |
| 3 | MEDIUM | Missing Normalisation of Default Ports | `canonical_source_url` leaves explicit default ports, leading to duplicate canonical entries. |
| 4 | MEDIUM | `_urls_in` Ignores f‑strings / Concatenated URLs | Origin discovery misses URLs built dynamically, opening a path for un‑policy‑checked ingests. |
| 5 | LOW | Documentation Drift for `chunk_exists` | Doc‑string no longer matches actual query logic (raw‑URL OR). |
| 6 | MEDIUM | Potential Misuse of `os.supports_dir_fd` Guard | Guard still uses boolean‑style check; fallback may be taken on platforms that support `dir_fd`. |
| 7 | LOW–MEDIUM | Evidence‑Artifact Exclusion Lacks Integrity Hash | Receipts list only paths, not content hashes, weakening audit‑trail guarantees. |

---

## Recommendations & Next Steps

1. **Implement the tenant‑scoping fix** (mandatory argument, admin‑only global helper) and add a regression test that verifies cross‑tenant leakage is impossible.
2. **Upgrade the dedup existence check** to include a case‑insensitive match (or better, store a separate normalized column) and ship a migration that rewrites all historical rows to the canonical form.
3. **Normalize default ports** in `canonical_source_url` and extend the test‑suite with explicit port cases.
4. **Extend `_urls_in`** to handle `ast.JoinedStr` and simple `ast.BinOp` string concatenations; add unit tests for f‑strings and concatenated URLs.
5. **Synchronise documentation** – update the `chunk_exists` doc‑string to reflect the raw‑URL clause.
6. **Refactor the platform guard** to use explicit set‑membership (`if os.open in os.supports_dir_fd:`) and test the fallback path.
7. **Add artifact‑hashing** to the receipts block to provide cryptographic proof that excluded files have not been altered after review.

Addressing the **high‑severity** tenant‑isolation and dedup‑guard defects is mandatory before this PR can be safely merged. The medium‑severity items (port normalisation, platform‑guard, URL discovery) should be resolved in the same release cycle to avoid regression regressors. Low‑severity documentation and receipt‑hash improvements can be scheduled for the next minor iteration.

--- 

*Prepared by the Gate 7 independent adversarial reviewer (X‑HIGH effort).*

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
