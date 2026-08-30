# Gate 7 adversarial review — PR #3481

**Verdict:** UNKNOWN · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, cross-repository contract, deletion/destructive, forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `aa84db7d4c8b7a7c29bafe39a42d81489c06555a`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (110): docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code-attempt1-cascade-failed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-code-explain-pg16.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 80,267/80,267 (cap 90,000)
- reviewed-diff sha256 (sent bytes): `7abd383239d8969b7b42c13f282e169810f50a44114bc0d4376e043b383af8ec`
- full scoped-diff sha256 (pre-cap): `7abd383239d8969b7b42c13f282e169810f50a44114bc0d4376e043b383af8ec`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

_No structured findings parsed — see the raw review below._

## Raw review

**Gate 7 – XHIGH adversarial review (CU‑03 “case‑insensitive origin discovery”)**  
**Result: BLOCK – a structural regression in the canonical‑URL logic introduces a silent‑duplicate‑row defect that defeats the deduplication contract and opens a tenant‑data‑leak / storage‑bloat vector.**  

---

## 1. TL;DR  

*The newly‑added `canonical_source_url()` normalises **scheme** and **host** only.  Percent‑encoded octets in the path/query are left untouched and their **hex‑digits are case‑sensitive**.  Because the dedup key `(tenant_id, source_url, chunk_index)` is an *exact* match on the stored `source_url`, two URLs that differ *only* by the case of a percent‑encoded byte (e.g. `%2F` vs `%2f`) are treated as distinct rows.  The migration that introduced the canonical‑URL function expected **case‑insensitive** equivalence for *all* components that are logically the same, but the implementation falls short.  

*The test‑suite does **not** cover this edge‑case – it only asserts that the function *preserves* percent‑encoding (`test_lowercases_only_scheme_and_host`).  Consequently the regression is invisible to the author’s own unit‑tests and to the fuzz corpus, yet it violates the documented “one canonical key for every casing of an origin” contract (see the extensive “F1 – dedup” discussion in `test_conflict_and_packaging_contracts.py`).  

*Impact: duplicate rows for the same logical document, breaking the `idx_ke_chunk_dedup` UNIQUE index contract, inflating tenant storage, and potentially exposing private content when a later recrawl writes the *canonical* row while the *raw‑casing* row remains hidden from the dedup guard.  This is a **data‑corruption / tenant‑leakage** defect that falls under the primary auto‑escalation surfaces (database/schema, canonical asset identity, tenant scoping).  

*Fix: normalise percent‑encoding to a canonical case (RFC 3986 recommends uppercase hex digits) **or** fully percent‑decode‑then‑re‑encode the path, query and fragment before lower‑casing the host.  The function should be pure, idempotent, and must guarantee that `canonical_source_url(url1) == canonical_source_url(url2)` whenever `url1` and `url2` are *semantically* identical per RFC 3986.*

---

## 2. Detailed defect description

### 2.1 What the change introduced  

* `mira‑crawler/ingest/store.py` added:
  * `_SCHEME_RE` and `canonical_source_url()`.
  * All callers of the dedup key (`chunk_exists`, `insert_chunk`, `ingested_source_urls`) now pass the **canonicalised** URL.

* The intent (as documented in the code comments and the “F1 – dedup” contract) is that **any two strings that refer to the same origin must resolve to the same stored key**, regardless of case in the scheme or host.

### 2.2 Where the implementation deviates from the intent  

`canonical_source_url()` does **exactly** what the comment says for scheme and host, *but* it deliberately **does not touch percent‑encoding**:

```python
# ... after extracting host, port, tail ...
return f"{scheme}://{userinfo}{at}{host.lower()}{port}{tail}"
```

* `tail` contains the *raw* remainder of the URL (`/path?query#frag`), unchanged.
* RFC 3986 §2.1 states that **percent‑encoded octets are case‑insensitive** – `%2F` and `%2f` are equivalent.  
* The function therefore treats the two strings as different canonical keys.

### 2.3 Concrete example that reproduces the bug  

```python
from mira_crawler.ingest import store

url_a = "https://example.com/a%2Fpath"   # uppercase hex digits
url_b = "https://example.com/a%2fpath"   # lowercase hex digits

assert store.canonical_source_url(url_a) != store.canonical_source_url(url_b)
# => True  (the two canonical strings differ)

# Insert first chunk
store.insert_chunk(
    tenant_id="tenant‑x",
    content="first",
    embedding=[0.1, 0.2],
    source_url=url_a,
    chunk_index=0,
    is_private=False,
)

# The dedup guard looks for (canonical(url_b), raw=url_b) – both miss the first row
store.insert_chunk(
    tenant_id="tenant‑x",
    content="second",
    embedding=[0.1, 0.2],
    source_url=url_b,
    chunk_index=0,
    is_private=False,
)
```

*Result:* two rows are inserted with different `source_url` values even though the two URLs resolve to the *same* resource.  
The unique index `idx_ke_chunk_dedup (tenant_id, source_url, (metadata->>'chunk_index')::int)` is **not triggered** because the `source_url` values differ byte‑for‑byte.

### 2.4 Why the existing test‑suite does not catch it  

* `test_lowercases_only_scheme_and_host` explicitly checks that the function **preserves** percent‑encoding, i.e. it *expects* `%2F` to stay `%2F`.  
* There is **no test** that inserts two semantically identical URLs differing only in the case of the hex digits and asserts that the second insert is deduped.  
* The `store_chunks` test (`test_store_chunks_cannot_create_a_second_differently_cased_key`) only covers *casing of the host* – it never exercises percent‑encoding case variations.

Therefore the regression is invisible to the author’s own unit tests, the fuzz corpus, and the manual proof file `test_conflict_and_packaging_contracts.py`.

---

## 3. Impact analysis (why this is a gate‑7‑blocking defect)

| Dimension | Consequence |
|-----------|--------------|
| **Data integrity** | Duplicate rows break the “exact‑match UNIQUE index” guarantee. The system assumes a single row per `(tenant, source_url, chunk)`; downstream code (e.g., `freshness._mark_entries_stale_batch`) will treat the two rows as distinct, potentially marking one “stale” while the other remains live. |
| **Tenant leakage** | If a private document is first ingested with a *canonical* URL (lower‑cased host) and later recrawled with a *percent‑encoding case variant* (e.g., a different client library that emits lower‑case hex), the dedup guard will miss the existing row. The second (private) insert will be stored **next to** the public row, and the “private‑visibility never updated on conflict” guarantee (F1) is circumvented – an attacker could deliberately craft a URL variant to bypass the `DO NOTHING` conflict path and force a second row that is *public* while the original remains private. |
| **Storage bloat / DoS** | A malicious actor can repeatedly submit the same logical document with different percent‑encoding cases, inflating the `knowledge_entries` table arbitrarily. |
| **Compliance / Auditing** | The migration `003_kb_hardening.sql` explicitly states that the dedup key must be **exact‑match** on the canonical URL. The current implementation violates that contract, making the migration’s promise false. |
| **Security** | The dedup contract is part of the *fail‑closed* data‑integrity model. By bypassing it, an attacker can cause the system to *accept* a write that should have been rejected (e.g., a private document that becomes public because the conflict guard never fires). This is precisely the “hidden coupling / behavioral regression” the gate is meant to surface. |

All of the above fall under the auto‑escalation triggers that fired for this PR (database/schema, canonical asset identity, tenant scoping, data corruption).

---

## 4. Recommended remediation

1. **Canonicalise percent‑encoding** – either:
   * Convert all `%[0-9A-Fa-f]{2}` sequences to **upper‑case** (the common canonical form), **or**
   * Fully decode the path/query/fragment and then re‑encode using `urllib.parse.quote` with `safe="/?=&"` to guarantee a unique representation.
2. Update the docstring of `canonical_source_url()` to explicitly state the percent‑encoding normalisation rule.
3. Add a **new unit test** (in `test_conflict_and_packaging_contracts.py` or a dedicated `test_canonical_source_url.py`) that asserts:
   ```python
   assert store.canonical_source_url(
       "https://example.com/a%2Fpath"
   ) == store.canonical_source_url(
       "https://example.com/a%2fpath"
   )
   # and that a second insert with the lower‑case variant is deduped.
   ```
4. Run the migration test suite (`mira‑hub/db/migrations/003_kb_hardening.sql`) against a database pre‑populated with both variants to ensure the UNIQUE index now correctly rejects the second insert.
5. (Optional) Harden `chunk_exists` to use a *single* parameter for lookup (e.g., `WHERE source_url = :url`) after normalising the input *once* (canonical + raw) on the Python side, to avoid accidental SQL‑level OR‑logic bugs.

---

## 5. Secondary observation – evidence‑artifact exclusion policy

While unrelated to the primary regression, the newly‑added `drop_evidence_artifacts()` function **excludes any file under `docs/architecture/convergence/units/evidence/` that ends with a documentation suffix** (`.md`, `.txt`, `.log`, …).  

*Problem:* a malicious contributor could place a **payload in a Markdown file** (e.g., a Jinja2 template, a shell‑script in a code‑block, or a malicious image reference) inside that directory. The file would be **silently omitted from the diff** and never reviewed, yet later pipelines (static‑site generators, CI steps that render docs) may execute or embed the content.  

*Mitigation:* either:
* Treat **all files** under the `evidence/` hierarchy as *always‑reviewed* (i.e. do not drop them), or
* Restrict the exclusion to **generated artifacts only** (e.g., files whose name matches `*.log`, `*.stderr.log`, `*.stderr`, `*.stdout`, `*.trace`) and keep markdown files visible.

This is a *potential* security gap that the current test suite does not exercise. It should be added to the scope of the review (though not the primary blocker).

---

## 6. Verdict

**BLOCK** – The implementation introduces a subtle but critical regression in URL canonicalisation that defeats the deduplication contract, enables duplicate rows, and opens a tenant‑privacy / storage‑bloat attack surface. The defect is not covered by the existing test matrix and was not caught by the author’s fuzzing. A fix must be applied before the PR can be merged.  

*Please address the percent‑encoding normalisation and add the missing test before re‑submission. Additionally, consider tightening the evidence‑artifact exclusion rule to avoid hidden‑payload vectors.*

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
