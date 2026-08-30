# Gate 7 adversarial review — PR #3481

**Verdict:** UNKNOWN · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, cross-repository contract, deletion/destructive, forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `c0ca9315ba1011123f64ba0177f23e27a449b1c9`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (170): .claude/commands/gate7-review.md, docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md, docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code-attempt1-cascade-failed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt3-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt3-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-code-explain-pg16.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 111,463/111,463 (cap 120,000)
- reviewed-diff sha256 (sent bytes): `4befe204a5b2e40eb92e23f6a4c79dcc005bc937d76482b03eab14bcca9abe4c`
- full scoped-diff sha256 (pre-cap): `4befe204a5b2e40eb92e23f6a4c79dcc005bc937d76482b03eab14bcca9abe4c`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

_No structured findings parsed — see the raw review below._

## Raw review

**Gate 7 – Independent Adversarial Review – BLOCK**

---

### Summary

The PR introduces a *canonical‑source‑URL* function and updates the deduplication logic so that only the scheme and host are lower‑cased.  This is a good step, but the implementation still contains two **high‑severity case‑sensitivity defects** that were not covered by the existing test‑suite:

1. **`ingested_source_urls` does not recognise historical rows that were stored with non‑canonical casing when the caller supplies the *canonical* spelling.**  
2. **`canonical_source_url` does not normalise percent‑encoded octets, so URLs that differ only by the case of the hex digits (`%2F` vs `%2f`) are treated as distinct keys.**

Both defects can cause **duplicate rows** in `knowledge_entries`, breaking the uniqueness contract (`idx_ke_chunk_dedup`) and opening a path for **privacy leakage** (a private row can be re‑ingested as a public row because the dedup guard fails to see the existing entry).

---

## Finding 1 – Ledger probe misses historical rows when the caller uses the canonical form  

**Severity:** **high**  

**Location:** `mira-crawler/ingest/store.py` – function `ingested_source_urls`  

### Defect description
`ingested_source_urls` builds a lookup set that contains **both the caller‑provided URL and its canonical form**, then runs a single `SELECT … WHERE source_url = ANY(:urls) AND tenant_id = :tid`.  
After the query it returns the caller’s spelling **only if** the exact string (or its canonical form) appears in the result set:

```python
found = {r[0] for r in rows if r and r[0]}
return {u for u in asked if u in found or canonical_source_url(u) in found}
```

If a row was inserted **before** canonicalisation (e.g. `"HTTPS://EXAMPLE.COM/Old.pdf"`), a later caller that asks for the **canonical** URL (`"https://example.com/Old.pdf"`) will *not* see that row:

* The query includes both `"https://example.com/Old.pdf"` (canonical) and `"HTTPS://EXAMPLE.COM/Old.pdf"` (raw) in the `ANY` list.  
* The stored row matches only the raw entry, so the returned `found` set contains `"HTTPS://EXAMPLE.COM/Old.pdf"` **not** its canonical counterpart.  
* The set‑comprehension tests `u in found` (false) and `canonical_source_url(u) in found` (canonical of the caller, also false), therefore the canonical request is omitted from the result.

Consequences:

| Symptom | Impact |
|---|---|
| Duplicate rows for the same logical resource (one stored with raw case, one with canonical case) | Storage bloat, degraded performance |
| Private vs. public visibility can diverge across the two rows | **Privacy breach** – a private URL could be re‑ingested as public because the dedup guard misses the historic private row |
| The ledger (`ingested_source_urls`) may report “not ingested” for a URL that *is* present, leading to endless recrawls | Operational churn, wasted compute cycles |

### Reproducible demonstration (minimal test)

```python
def test_ingested_source_urls_canonical_misses_historical():
    # Insert a row using the historic, mixed‑case URL
    raw = "HTTPS://EXAMPLE.COM/Old.pdf"
    store.insert_chunk("tenant-a", "content", [0.1], source_url=raw, chunk_index=0, is_private=True)

    # Now ask the ledger for the *canonical* spelling
    result = store.ingested_source_urls(["https://example.com/Old.pdf"], tenant_id="tenant-a")
    assert result == set()      # <-- BUG: should contain the URL
```

Running this test (against a real DB or a faithful mock) fails, confirming the bug.

### Recommended fix
Normalize **both** sides of the comparison:

```python
# After fetching rows, build a set of canonical forms for the stored URLs
canonical_found = {canonical_source_url(r[0]) for r in rows if r and r[0]}

# Return the caller’s spelling if either its raw or canonical form appears
return {u for u in asked
        if u in found or canonical_source_url(u) in found
        or canonical_source_url(u) in canonical_found}
```

Or, more simply, change the SQL to also compare the canonical form of the stored column:

```sql
SELECT DISTINCT source_url,
       LOWER(SPLIT_PART(source_url, '://', 1)) AS scheme,
       LOWER(SPLIT_PART(source_url, '://', 2)::text) AS host
FROM knowledge_entries
WHERE tenant_id = :tid
  AND (source_url = ANY(:urls)
       OR (LOWER(SPLIT_PART(source_url, '://', 1)) || '://' ||
           LOWER(SPLIT_PART(source_url, '://', 2)::text) = ANY(:canonical_urls));
```

Either approach guarantees that a historical row with mixed‑case host is found when the caller supplies the canonical spelling, restoring the guarantee that **the ledger never misses an existing entry**.

---

## Finding 2 – Percent‑encoding case is not normalised  

**Severity:** **high**  

**Location:** `mira-crawler/ingest/store.py` – function `canonical_source_url`  

### Defect description
`canonical_source_url` only lower‑cases the **scheme** and the **host**.  The rest of the URL – *including percent‑encoded octets* – is left untouched:

```python
# Example
canonical_source_url("https://example.com/a%2Fpath")
# → "https://example.com/a%2Fpath"  (unchanged)
canonical_source_url("https://example.com/a%2fpath")
# → "https://example.com/a%2fpath"  (unchanged)
```

RFC 3986 specifies that percent‑encoding is **case‑insensitive**.  Two URLs that differ only by the case of the hex digits therefore denote the *same* resource.  Because the dedup key is an *exact* match on `source_url`, the system will treat the two forms as **different** rows.

Consequences:

| Symptom | Impact |
|---|---|
| Duplicate rows for the same resource (`…/a%2Fpath` vs `…/a%2fpath`) | Unnecessary storage, possible out‑of‑sync visibility flags |
| Private content could be stored twice – once private (original) and once public (canonicalised) | **Privacy leakage** – the public duplicate may be served to unauthorized tenants |
| Migration `idx_ke_chunk_dedup` (exact‑match) will not prevent the duplication | Schema contract violation (the index is intended to be *unique* for a given logical URL) |

### Reproducible demonstration

```python
def test_percent_encoding_duplication():
    u1 = "https://example.com/a%2Fpath"
    u2 = "https://example.com/a%2fpath"

    # Insert both URLs – dedup guard sees them as distinct
    store.insert_chunk("tenant-a", "c1", [0.1], source_url=u1, chunk_index=0, is_private=False)
    store.insert_chunk("tenant-a", "c2", [0.2], source_url=u2, chunk_index=0, is_private=False)

    # Expect a single row, but two rows are created
    with store._engine().connect() as conn:
        cnt = conn.execute(text(
            "SELECT COUNT(*) FROM knowledge_entries "
            "WHERE tenant_id = :tid AND source_url = ANY(:urls)"
        ), {"tid": "tenant-a", "urls": [u1, u2]}).scalar()
    assert cnt == 1   # <-- fails; cnt is 2
```

### Recommended fix
Normalize percent‑encoding to a canonical representation (e.g. all uppercase hex digits) as part of `canonical_source_url`.  A simple, standards‑compliant approach:

```python
import urllib.parse

def _normalise_percent_encoding(part: str) -> str:
    # Decode then re‑encode with uppercase hex digits
    return urllib.parse.quote(urllib.parse.unquote(part), safe="/:?=&%")

def canonical_source_url(url: str) -> str:
    if not url:
        return url
    head, sep, rest = url.partition(":")
    if not sep or not _SCHEME_RE.fullmatch(head) or (len(head) < 2 and not rest.startswith("//")):
        return url
    scheme = head.lower()
    if not rest.startswith("//"):
        return f"{scheme}:{rest}"
    body = rest[2:]

    # split authority and the rest as before …
    # after building the final URL, normalise the path, query and fragment:
    path, _, tail = body.partition("?") if "?" in body else (body, "", "")
    # `tail` may contain query and fragment; split them further if needed
    path = _normalise_percent_encoding(path)
    tail = _normalise_percent_encoding(tail)
    return f"{scheme}://{userinfo}{at}{host.lower()}{port}{path}{tail}"
```

With this change, `"https://example.com/a%2Fpath"` and `"https://example.com/a%2fpath"` both canonicalise to the same string, and the dedup guard will correctly suppress the second insertion.

---

## Overall impact & recommendation

Both defects directly affect the **deduplication contract** that the platform relies on to guarantee:

* **Uniqueness** of `(tenant_id, source_url, chunk_index)` (migration 003)  
* **Privacy‑by‑default** – a private row can never be silently re‑created as public.

If left unfixed, a malicious actor (or even a benign crawler) can cause **duplicate rows** that bypass the `DO NOTHING` conflict logic, resulting in the **exposure of private content**.  This is a clear violation of the platform’s security and data‑integrity guarantees and therefore warrants an immediate **BLOCK**.

### Action items

1. **Patch `ingested_source_urls`** so that it matches historical rows regardless of the caller’s casing (as shown above).  
2. **Extend `canonical_source_url`** to normalise percent‑encoding (RFC 3986) so that logically identical URLs map to a single canonical key.  
3. Add targeted unit tests:
   * Verify that a canonical query finds a historically‑cased row.  
   * Verify that two URLs differing only by `%2F` vs `%2f` are treated as identical by the dedup guard.

Only after these fixes (and a fresh review of the updated head) should the PR be considered for re‑submission.

--- 

**Result:** **BLOCK** – the PR cannot be merged in its current form.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
- `shape: expected exactly one `## VERDICT` section, found 0 — UNKNOWN (malformed attempt)`
