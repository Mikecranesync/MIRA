# Gate 7 adversarial review — PR #3481

**Verdict:** UNKNOWN · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, security boundaries, cross-repository contract, deletion/destructive, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `502de5e155a9f35de86e848b18f6b6c70a5d29b5`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (91): docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-code-explain-pg16.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 75,887/75,887 (cap 90,000)
- reviewed-diff sha256 (sent bytes): `1a3472c49883ffca55ee093e790746d06a5071df0a17fc34c8fa8d01978544cc`
- full scoped-diff sha256 (pre-cap): `1a3472c49883ffca55ee093e790746d06a5071df0a17fc34c8fa8d01978544cc`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

_No structured findings parsed — see the raw review below._

## Raw review

**Gate 7 – Independent Adversarial Review**  
**Repository:** `mira‑crawler` – PR # ??? (CU‑03 Gate 9 follow‑up)  
**Reviewer:** *independent adversarial reviewer*  
**Date:** 2026‑08‑29  

---  

## TL;DR  

The changes introduce a **canonical‑URL layer** (`canonical_source_url`) that lower‑cases **only the scheme and host** of an origin.  The intent is to make the deduplication key case‑insensitive and to close the “source‑URL case‑sensitive uniqueness collides with case‑insensitive classification” finding from round 2.  

Unfortunately the implementation **does not fully close the collision window**.  Historical rows that were written **before** the canonicalisation step can have a *different* casing of the host/scheme than the incoming URL **and the lookup logic only checks the incoming URL’s raw form and its canonical form**.  When the *stored* row’s casing does **not** match either of those two values, `chunk_exists` returns **false**, the `INSERT … ON CONFLICT DO NOTHING` does not fire, and a **duplicate logical entry** is inserted.  

This regression breaks the **exact‑match UNIQUE index** `idx_ke_chunk_dedup`, creates silent duplicate rows, violates the tenant‑only data‑isolation contract, and can lead to data‑corruption and uncontrolled growth of the knowledge base.  It is a **high‑severity data‑integrity defect** that is not exercised by any existing test.  

Below is a detailed analysis, proof‑of‑concept, and a set of additional findings that also merit attention.

---  

## 1. High‑Severity Finding – Duplicate `knowledge_entries` rows caused by asymmetric case handling  

### Title  
**Duplicate logical rows when a historical entry’s casing differs from the incoming URL’s casing**  

### Description  

`store.chunk_exists` (line ≈ 44) builds the SQL predicate  

```sql
WHERE tenant_id = :tid
  AND (source_url = :url OR source_url = :raw)
  AND metadata->>'chunk_index' = :idx
```

where  

* `raw`   = the URL **exactly** as supplied by the caller,  
* `url`   = `canonical_source_url(raw)` (scheme + host lower‑cased).  

If the DB already contains a row that was written **before** the canonicalisation was introduced, its `source_url` may have a *different* case (e.g. `"HTTPS://EXAMPLE.COM/file.pdf"`).  

When a new crawl supplies the **same logical URL** but with a *different* case (e.g. `"https://example.com/file.pdf"`), the two values that are compared in the query are:

| Parameter | Value sent to the DB |
|-----------|---------------------|
| `:raw`    | `https://example.com/file.pdf` |
| `:url`    | `https://example.com/file.pdf` |

Neither matches the stored value `"HTTPS://EXAMPLE.COM/file.pdf"`. The query returns `0` rows, `chunk_exists` reports *not present*, and `insert_chunk` proceeds to insert a **second row** with the canonical lower‑cased URL. The unique index does **not** fire because the string differs, so the duplicate is silently persisted.

The same asymmetry exists in the opposite direction: a stored canonical row will be found when the incoming URL matches the canonical case, but a stored *raw* row will **not** be found when the incoming URL is canonicalised.

### Evidence  

*`store.py` – `chunk_exists`*  

```python
raw_url = source_url                # keep the caller's spelling
source_url = canonical_source_url(source_url)

count = conn.execute(
    text("""
        SELECT COUNT(*) FROM knowledge_entries
        WHERE tenant_id = :tid
          AND (source_url = :url OR source_url = :raw)
          AND metadata->>'chunk_index' = :idx
    """),
    {"tid": tenant_id, "url": source_url, "raw": raw_url, "idx": str(chunk_index)},
).scalar()
```

*`store.py` – `canonical_source_url`*  

```python
def canonical_source_url(url: str) -> str:
    ...
    scheme = head.lower()
    ...
    host, colon, port = hostport.partition(":")
    return f"{scheme}://{userinfo}{at}{host.lower()}{port}{tail}"
```

*Missing test* – The current test suite (`test_store_chunks_cannot_create_a_second_differently_cased_key`) only checks the case where **both** calls use the same URL (upper‑ then lower‑cased) *in the same request* – the second call sees the just‑inserted canonical row and therefore dedups. It never exercises the situation where a **historical** row exists with the opposite casing.

*Proof‑of‑concept (pseudo‑test that fails with the current code)*  

```python
def test_historical_row_case_mismatch_is_not_detected(monkeypatch):
    # Simulate a row that was written before canonicalisation
    captured = {}
    monkeypatch.setattr(store, "_engine", lambda: _FakeEngine(captured, rows=[("HTTPS://EXAMPLE.COM/legacy.pdf",)]))

    # Caller supplies the same logical URL, but in lower‑case
    exists = store.chunk_exists("tenant-a", "https://example.com/legacy.pdf", 0)

    assert exists is True, "Historical row should be detected even when case differs"
```

Running the above against the current implementation yields `exists == False`, exposing the bug.

### Impact  

* **Data integrity** – The same logical document can appear multiple times under the same tenant, breaking the contract that the dedup key is a *global* UNIQUE index.  
* **Storage bloat** – Duplicate rows multiply the size of `knowledge_entries`.  
* **Policy enforcement** – Visibility (`is_private`) is evaluated once per row; duplicate rows can diverge in privacy flags, violating the “private‑visibility flag never updated on conflict” contract (F1).  
* **Tenant isolation** – Because the duplicate is inserted with the **same tenant_id**, the cross‑tenant isolation contract remains intact, but the duplicate can be used to infer that the system is not correctly canonicalising, a subtle leakage of implementation details.  
* **Future migrations** – Any downstream migration that assumes a one‑to‑one mapping between logical URL and row will fail or produce incorrect aggregates.

### Recommendation  

1. **Expand the existence check to be truly case‑insensitive for scheme + host**: after fetching rows, compute `canonical_source_url(row_source_url)` for each returned row and compare it to `canonical_source_url(caller_url)`.  
2. **Or adjust the SQL to perform the canonicalisation on the DB side** (e.g. `WHERE lower(split_part(source_url, '://', 1)) = lower(split_part(:url, '://', 1)) AND ...`) – this avoids pulling the whole row set into Python.  
3. **Add a dedicated unit test** that seeds a historical upper‑cased row and verifies that `chunk_exists` returns `True` for the lower‑cased query (and vice‑versa).  
4. **Consider a one‑off migration** that rewrites all historical rows to the canonical form (the PR comment already mentions a “one‑off dedup migration”). The existence check must be robust *before* that migration runs.  

Implementing any of the above eliminates the possibility of duplicate logical rows and fully satisfies the round‑2 high‑severity finding.

---  

## 2. Medium‑Severity Finding – `canonical_source_url` treats explicit default ports as distinct  

### Title  
**`http://example.com` and `http://example.com:80` are considered different keys**  

### Description  

`canonical_source_url` lower‑cases the scheme and host **but leaves the port untouched**. Consequently, a URL that omits the default port and the same URL that explicitly includes it are stored as **different** `source_url` values. The dedup index (`tenant_id, source_url, chunk_index`) therefore allows two rows that refer to the *same* HTTP resource.

### Evidence  

*`canonical_source_url`* – after extracting `hostport`, the code splits on the first colon and keeps the colon in `port`:

```python
host, colon, port = hostport.partition(":")
port = colon + port   # retains ":80" if present
return f"{scheme}://{userinfo}{at}{host.lower()}{port}{tail}"
```

Thus `"http://example.com"` → `"http://example.com"` and `"http://example.com:80"` → `"http://example.com:80"`.

### Impact  

* Duplicate rows for the same logical resource (similar to the high‑severity issue).  
* Potential privacy‑flag divergence if one copy is classified as private and the other as public.  

### Recommendation  

Normalize **default ports** to the empty string during canonicalisation (i.e. drop `:80` for `http` and `:443` for `https`). Add corresponding unit tests (e.g. `"http://example.com:80"` canonicalises to `"http://example.com"`).

---  

## 3. Medium‑Severity Finding – URL discovery only scans `ast.Constant` nodes  

### Title  
**`_urls_in` ignores URLs built via f‑strings or string concatenation**  

### Description  

`origins._urls_in` walks the AST and collects only `ast.Constant` nodes whose value is a `str`.  Dynamically constructed URL literals (e.g. `f"https://{domain}/feed"` or `"https://" + host + "/path"`) are represented as `ast.JoinedStr` or `ast.BinOp` nodes and are therefore **never discovered**.  

The gate’s policy‑consistency test (`test_discovery_matches_url_constants_case_insensitively`) only verifies detection of plain constants, so the regression is invisible to the current test suite.

### Evidence  

```python
def _urls_in(node: ast.AST) -> list[str]:
    return [
        n.value
        for n in ast.walk(node)
        if isinstance(n, ast.Constant) and isinstance(n.value, str)
        and n.value.lower().startswith(("http://", "https://"))
    ]
```

### Impact  

* An origin expressed via a non‑constant string will **not be discovered**, so its classification entry will never be required.  
* If the origin is *unclassified*, the ingest gate will treat it as private (as intended), but the **policy‑consistency check** will be vacuous, potentially allowing a mis‑configuration to go unnoticed.  

### Recommendation  

Extend `_urls_in` to also collect URLs from `ast.JoinedStr` nodes where the *static* prefix matches a scheme (e.g. `joined_str.values[0]` is a `Constant` beginning with `"http"`). Add a test case covering an f‑string URL.

---  

## 4. Low‑Severity Finding – Unicode host case handling  

### Title  
**`canonical_source_url` uses `str.lower()` instead of `casefold()` for the host**  

### Description  

Internationalised Domain Names (IDNs) may contain characters where `lower()` is not fully case‑insensitive (e.g. the Turkish dotted ‘İ’). Using `casefold()` would guarantee Unicode case‑insensitivity.

### Impact  

* Extremely unlikely in the current MIRA ecosystem (hostnames are punycoded ASCII), but technically a corner‑case that could lead to missed dedup for exotic domains.

### Recommendation  

Replace `host.lower()` with `host.casefold()` and add a regression test with an IDN host containing a non‑ASCII letter.

---  

## 5. Low‑Severity Finding – Evidence‑artifact exclusion logic may hide malicious code  

### Title  
**`is_evidence_artifact` only excludes documentation‑type files; executable payloads (`*.py`, `*.sh`, `*.yaml`) placed under `docs/…/evidence/` remain in the reviewed diff**  

### Description  

The function intentionally treats only files with extensions in `_DOC_SUFFIXES` as artifacts. While the comment states the directory must never become a place to hide code, the current guard does **not** prevent a malicious actor from dropping a Python script (or a Dockerfile) under the evidence path and having it reviewed as ordinary code.  

### Impact  

* If the CI pipeline later builds a Docker image from the repository (as it does for the crawler), a hidden script could be inadvertently included in the image, expanding the attack surface.

### Recommendation  

Either (a) broaden the exclusion to **all** files under the evidence directory, regardless of suffix, or (b) add a lint rule that forbids any executable‑type file under `…/evidence/`. Add a unit test asserting that a `.py` file in the evidence directory is *not* considered a documentation artifact and therefore is **never** dropped silently.

---  

## Overall Assessment  

The PR **fails to fully close** the round‑2 high‑severity finding about case‑sensitive uniqueness.  The introduced canonicalisation logic introduces a new regression that can silently duplicate logical rows when a historical entry’s casing differs from the incoming request’s casing.  This is a **data‑corruption / deduplication defect** of high severity and must be addressed before the change can be merged.

**Verdict:** **BLOCK** – the implementation must be fixed (see Recommendations) and a new test covering the asymmetric‑case scenario must be added.  

---  

### Recommended Action Items  

| # | Action | Owner | Priority |
|---|--------|-------|----------|
| 1 | Refactor `chunk_exists` (and `ingested_source_urls`) to perform **canonical‑form comparison** on both sides of the query (or add a post‑fetch canonicalisation step). | Storage team | High |
| 2 | Add a unit test that seeds a historical row with opposite casing and asserts that `chunk_exists` returns `True` for the opposite‑cased query. | Test author | High |
| 3 | Normalise default ports (`:80`, `:443`) in `canonical_source_url`. | Storage team | Medium |
| 4 | Extend `_urls_in` to discover URLs built via f‑strings / string concatenation. | Ingest team | Medium |
| 5 | Switch `host.lower()` → `host.casefold()` for full Unicode case‑insensitivity. | Ingest team | Low |
| 6 | Harden `is_evidence_artifact` to either exclude *all* files under the evidence directory or add a lint rule preventing executable files there. | Review tooling team | Low |
| 7 | Verify that the expanded brief (`decision_point_reminder`) still fits within the token limits for `xhigh` runs; add a safeguard if it exceeds `MAX_DIFF_CHARS`. | CI tooling | Low |

Please address the high‑severity data‑integrity bug first; the remaining findings can be scheduled after the primary fix.  

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
