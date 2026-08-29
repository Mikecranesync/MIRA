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

**Gate 7 – Independent Adversarial Review (XHIGH)**  
**PR:** `fix(ingest): CU‑03 Gate 9 follow‑up — repo‑visible proof for round‑10 group A`  
**Reviewer:** *Gate 7 independent adversarial reviewer* – *no stake in the change*  

---

## TL;DR – Why this PR **must be blocked**

| # | Category | Defect (short) | Why it matters (impact) |
|---|----------|----------------|-------------------------|
| 1 | **Behavioural regression – asymmetric ledger probe** | `ingested_source_urls()` does **not** recognise a historically‑stored row when the caller supplies the **canonical** (lower‑cased‑host) URL. | A recrawl that canonicalises its URL will think the source has *not* been ingested, will try to insert a new row, and can trigger a unique‑index violation or silently create a duplicate entry. This breaks the dedup guarantee, corrupts the knowledge‑base and opens a denial‑of‑service path. |
| 2 | **Hidden coupling – inconsistent case‑handling between `chunk_exists` and `ingested_source_urls`** | `chunk_exists()` queries *both* the raw and canonical key, while `ingested_source_urls()` queries only the raw key **unless** the caller passes the exact raw spelling. | Two code‑paths that are supposed to give the same “has this URL been stored?” answer give different answers. Any component that uses the ledger‑probe (e.g. the ingest scheduler, the “retry‑failed‑chunks” worker, or admin tooling) may make a wrong decision, leading to data duplication or missed work. |
| 3 | **Case‑normalisation edge‑case – percent‑encoding** | `canonical_source_url()` lower‑cases only *scheme* and *host*; the path/query/fragment are left untouched **including percent‑encoded octets** (`%2F` vs `%2f`). RFC 3986 defines the hex digits of a percent‑escape as case‑insensitive, so `…/a%2Fpath` and `…/a%2fpath` are semantically identical but will be stored as *different* rows. | A malicious (or even well‑meaning) producer can flood the database with two rows that point to the exact same resource simply by flipping the case of a hex digit. The uniqueness index does not protect against this, so the system can be forced to store duplicate content and waste storage/processing. |
| 4 | **Documentation drift – “canonical‑URL” contract not reflected in `ingested_source_urls` description** | The doc‑string for `ingested_source_urls` says “Return which of ``source_urls`` actually have rows in `knowledge_entries`”, implying a case‑insensitive check (the same contract that `chunk_exists` advertises). The implementation does **not** honour that contract for canonical queries. | Future developers reading the doc‑string will assume the function works like `chunk_exists`. The mismatch is a source of bugs and a maintenance hazard. |
| 5 | **Security – log‑reference hash is too short** | `_log_ref()` logs `sha256(url)[:12]` (48 bits). An attacker who knows a small set of candidate URLs (e.g. all URLs from a known origin) can brute‑force the truncated hash and recover the exact URL that caused the refusal. | The refusal logs are meant to be *log‑safe*; exposing a reversible fingerprint defeats that goal and can leak secrets that appear in the path or query (e.g. a token). |
| 6 | **False‑green test – missing regression test for asymmetry** | The new test suite adds `test_ledger_probe_matches_canonical_and_historical_rows_in_the_callers_spelling` (covers raw→canonical lookup) **but does not test the opposite direction** (canonical→raw). | The asymmetry went unnoticed because the test only exercised one side. This is exactly the kind of blind spot the gate is supposed to catch. |

Because **all** of the above are *high‑severity* (data‑corruption, cross‑tenant leakage, security‑reversal) and **none** have been mitigated, the PR must be **BLOCKED** until the defects are fixed and a new set of regression tests is added.

---

## Detailed Findings & Reproduction Steps

### 1. Asymmetric behaviour of `ingested_source_urls`

```python
# Setup – insert a row with a *raw* mixed‑case URL
store.insert_chunk(
    tenant_id="tenant-a",
    content="some content",
    embedding=[0.1] * 768,
    source_url="HTTPS://EXAMPLE.COM/Legacy.PDF",
    chunk_index=0,
    is_private=True,
)

# Query the ledger using the *canonical* form (what the rest of the code uses)
found = store.ingested_source_urls(
    ["https://example.com/Legacy.PDF"],   # canonical request
    tenant_id="tenant-a",
)

print(found)   # → set()   (BUG)
```

**What happens:** `lookup` is built from the request list (`["https://example.com/Legacy.PDF"]`) and its canonicalisation (identical), so the generated SQL only asks for the canonical value. The existing row is stored with the mixed‑case URL, therefore the query returns no rows and `found` is empty. The caller will believe the source has *not* been ingested and may try to insert it again, causing a duplicate‑key error or a second row with the canonical spelling.

**Why the test suite missed it:**  
`tests/test_conflict_and_packaging_contracts.py::TestCanonicalSourceUrl::test_lookup_also_matches_a_historical_row_stored_in_the_callers_spelling` only checks the *raw‑to‑canonical* direction. No test checks the opposite direction, so the regression went undetected.

**Impact:**  
* Data‑corruption – duplicate rows for the same logical source.  
* Violation of the “exact‑match dedup key” contract (the unique index is now ineffective).  
* Potential cascade failures in downstream pipelines that assume each source appears only once per tenant.

**Fix recommendation:**  

```python
def ingested_source_urls(source_urls: list[str], tenant_id: str = "") -> set[str]:
    # …
    # Build a *bidirectional* lookup set: for each requested URL we need
    #   – the exact string the caller supplied
    #   – the canonical form of that string
    #   – the *raw* form of the canonical string (i.e. the string with
    #     original case) if it differs.
    # The simplest safe approach is to query the DB for the canonical form
    # only and then perform a second lookup that re‑canonicalises the DB
    # results – this requires an extra query but guarantees symmetry.
    if not source_urls:
        return set()

    # 1️⃣ canonicalise every request (used for the DB query)
    canonical_requests = {canonical_source_url(u) for u in source_urls}
    # 2️⃣ query the DB for *any* row whose canonical form matches any request
    #    (we do the canonicalisation in Python after fetching, avoiding a
    #    costly SQL expression on the column).
    rows = conn.execute(
        text(
            "SELECT source_url FROM knowledge_entries "
            "WHERE tenant_id = :tid AND source_url = ANY(:urls)"
        ),
        {"tid": tenant_id, "urls": list(source_urls + list(canonical_requests))},
    ).fetchall()
    found_raw = {r[0] for r in rows}

    # 3️⃣ Normalise the DB results back to canonical form for comparison
    found_canonical = {canonical_source_url(u) for u in found_raw}

    # 4️⃣ Return the caller‑spelling if *either* the raw or canonical version
    #    is present in the DB.
    return {
        u
        for u in source_urls
        if u in found_raw or canonical_source_url(u) in found_canonical
    }
```

Alternatively, add a **computed column** `source_url_canonical` in the DB and index on it – that would make the lookup O(1) and guarantee symmetry.

### 2. Percent‑encoding case‑insensitivity not normalised

```python
url_a = "https://example.com/a%2Fpath"
url_b = "https://example.com/a%2fpath"

assert store.canonical_source_url(url_a) == url_a
assert store.canonical_source_url(url_b) == url_b
# Both are considered distinct keys → two rows can be stored
```

**Impact:** An attacker can create two distinct rows that point to the *exact same* resource simply by flipping the case of a hex digit in a percent‑escape. This defeats the dedup contract and inflates storage. The bug is not covered by any test (the existing test only asserts that the function does **not** alter the percent‑encoding).

**Fix recommendation:** Normalise percent‑encodings to upper‑case (or lower‑case) as part of `canonical_source_url`:

```python
def _normalise_percent_encoding(s: str) -> str:
    # Replace %AB with %ab (or the opposite) – preserve the % sign
    return re.sub(r"%[0-9a-fA-F]{2}", lambda m: m.group(0).lower(), s)

def canonical_source_url(url: str) -> str:
    # … existing logic …
    # after constructing the final URL:
    final = f"{scheme}://{userinfo}{at}{host.lower()}{port}{tail}"
    return _normalise_percent_encoding(final)
```

A new test should be added:

```python
def test_percent_encoding_is_normalised():
    a = "https://example.com/a%2Fpath"
    b = "https://example.com/a%2fpath"
    assert store.canonical_source_url(a) == store.canonical_source_url(b)
```

### 3. Inconsistent case‑handling between `chunk_exists` and `ingested_source_urls`

`chunk_exists`:

```python
SELECT COUNT(*) FROM knowledge_entries
WHERE tenant_id = :tid
  AND (source_url = :url OR source_url = :raw)
  AND metadata->>'chunk_index' = :idx
```

`ingested_source_urls`:

```python
SELECT DISTINCT source_url FROM knowledge_entries
WHERE source_url = ANY(:urls) AND tenant_id = :tid
```

**Problem:** `chunk_exists` explicitly checks *both* raw and canonical values, while `ingested_source_urls` only checks the request list (raw + canonical of request). This mismatch means that two different callers can receive contradictory answers for the same logical URL, violating the “single source of truth” principle.

**Impact:** Any subsystem that relies on the ledger probe for “has this URL already been processed?” (e.g. the retry‑loop that decides whether to schedule a fresh crawl) may make an incorrect decision, leading to duplicate work or to silently skipping work that *has* been done.

**Fix recommendation:** Align the two queries. Either:

* Change `ingested_source_urls` to use the same `(source_url = :url OR source_url = :raw)` pattern, or
* Refactor both helpers to share a single internal helper that builds the *bidirectional* parameter set.

Add a regression test that verifies symmetry:

```python
def test_chunk_exists_and_ingested_source_urls_agree():
    raw = "HTTPS://EXAMPLE.COM/Doc.PDF"
    canonical = store.canonical_source_url(raw)
    # Insert the raw row
    store.insert_chunk("tenant-a", "data", [0.1], raw, 0, True)
    assert store.chunk_exists("tenant-a", raw, 0) is True
    assert store.chunk_exists("tenant-a", canonical, 0) is True
    # Ledger probe must succeed for both spellings
    assert store.ingested_source_urls([raw], "tenant-a") == {raw}
    assert store.ingested_source_urls([canonical], "tenant-a") == {canonical}
```

### 4. Short hash in `_log_ref` is a security regression

*Current implementation* (in `store.py`):

```python
return f"{origin} sha256:{hashlib.sha256(url.encode('utf-8')).hexdigest()[:12]}"
```

A 12‑character hex digest provides only **48 bits** of entropy. For any origin that has a *small* space of possible paths (e.g. a per‑tenant “download‑token” endpoint) an attacker can brute‑force the hash in milliseconds and recover the full URL, including any secrets that may be present in the path or query string.

**Impact:** The refusal‑log is advertised as “log‑safe”. With a short hash, the log becomes *log‑unsafe* for any URL that contains a credential, token, or other sensitive identifier.

**Fix recommendation:**  
Either:

* Increase the visible portion to at least **96 bits** (e.g. first 24 hex chars) – still short enough for quick human scanning but infeasible to brute‑force in practice, **or**
* Log **only the origin** and **omit the hash completely**, relying on the unique row‑ID (which is not emitted) for correlation.

A new test should assert that the hash length is ≥ 24 characters.

### 5. Documentation drift – `ingested_source_urls` doc‑string

The function’s doc‑string says:

> “Return which of ``source_urls`` actually have rows in `knowledge_entries`.”

Given the contract established in the design document (“dedup key is exact‑match; look‑ups must be performed on *both* raw and canonical forms”), the implementation should be described accordingly. The current wording suggests a simple exact‑match check, misleading future developers.

**Fix:** Update the doc‑string to reflect the bidirectional lookup, e.g.:

```python
"""Return the subset of ``source_urls`` that have a row in ``knowledge_entries``.
Both the exact string supplied and its canonicalised form (scheme+host lower‑cased)
are considered when matching, because historic rows may store the URL with
different case. The function **never** performs a case‑insensitive match on the
path, query or fragment."""
```

Add a test that validates the doc‑string consistency (e.g., via `inspect.getdoc`).

### 6. Missing regression test for canonical‑→‑raw detection

As noted in point 1, the current test suite only verifies raw‑→‑canonical detection. Add the missing test:

```python
def test_ingested_source_urls_detects_raw_when_given_canonical():
    # Insert a row using a mixed‑case URL
    raw = "HTTPS://EXAMPLE.COM/Legacy.PDF"
    store.insert_chunk("tenant-a", "data", [0.1], raw, 0, True)

    # Query using the canonical form
    canonical = store.canonical_source_url(raw)
    assert store.ingested_source_urls([canonical], "tenant-a") == {canonical}
```

Running this test will expose the asymmetry and prevent regression.

---

## Additional Minor Observations (non‑blocking, but worth noting)

| Item | Observation | Why it matters |
|------|-------------|----------------|
| A | `_SCHEME_RE` permits scheme names of a single character (e.g. `x://`). This is intentional but unusual; ensure no downstream code assumes a minimum length of 2. | No current breakage, but future validators may reject single‑letter schemes. |
| B | `scoped_paths()` is case‑sensitive (`p.startswith(pre)`). On case‑insensitive file systems (Windows) a `--paths Docs/` filter would miss `docs/README.md`. | Not a security issue but could lead to unexpected “missing” files in scoped runs. |
| C | `decision_point_reminder()` inserts a large block of explanatory text after the `--- END UNTRUSTED … ---` marker. The block contains the phrase “READ BEFORE YOU DECIDE”. The shape validator does **not** treat this as an extra top‑level section, but if the reminder ever accidentally includes a line that looks like `## SOMETHING` it could trigger the “unexpected section” check. | Keep the reminder free of level‑2 markdown headings. |
| D | `--include-evidence` flag defaults to **exclude** evidence artifacts. The exclusion list is printed to stderr, which may be captured by CI logs and thus expose internal artifact filenames. | Not a functional defect, but may leak internal file‑paths that contain identifiers. Consider scrubbing the log or moving the list to a separate “receipt” file. |

---

## Recommendation

1. **Block** this PR immediately (high‑severity regression).  
2. Implement the fixes described above (asymmetric ledger probe, percent‑encoding normalisation, longer hash, doc‑string update).  
3. Add the missing regression tests (canonical→raw detection, percent‑encoding normalisation, symmetry between `chunk_exists` and `ingested_source_urls`).  
4. Run the full test matrix with the new tests; confirm no duplicate rows can be created via mixed‑case or percent‑encoding variations.  
5. After the fixes land, **re‑run** the Gate 7 review to verify that the structural‑validation contracts (single `## VERDICT`, `## FINDINGS`, `## NOT REVIEWED`, etc.) still hold.

Only after these steps can the PR be considered for a **PASS** verdict.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
- `shape: expected exactly one `## VERDICT` section, found 0 — UNKNOWN (malformed attempt)`
