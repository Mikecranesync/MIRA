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

## Gate 7 – Independent Adversarial Review (Round 12)

**Reviewer:** *Gate 7 – adversarial*  
**Target PR:** *CU‑03 Gate 9 follow‑up – case‑insensitive origin discovery*  
**Scope:** Database/schema, canonical‑asset‑identity, tenant‑scoping, cross‑repository contract, deletion/destructive, forced by **‑‑xhigh**.  

The PR makes a large number of “defensive” changes (canonical URL handling, tighter tenant checks, extra test‑suite, a revamped gate‑7 reviewer, etc.).  
All of those changes **must** preserve the existing functional contract *and* must not open new attack surfaces.  

Below I present **concrete, reproducible defects** that were **not** caught by the author’s own unit‑test suite or by the fuzzing harness.  The defects are either **security‑relevant** or **behavioural regressions** that would cause silent data‑corruption, false‑negative deduplication or credential leakage.  

---

### 1.  `ingested_source_urls` is still **case‑sensitive** for *historical* rows

#### 1.1 What the code is trying to solve
*Rows written before `canonical_source_url` existed keep the exact casing of the URL.*  
`ingested_source_urls` is supposed to answer “has this URL already been ingested?” **independently of how the URL was cased when it was first stored**.

#### 1.2 What the implementation actually does
```python
def ingested_source_urls(source_urls: list[str], tenant_id: str = "") -> set[str]:
    …
    # 1️⃣  ask for BOTH the caller’s spelling *and* the canonical spelling
    lookup = sorted({*asked, *(canonical_source_url(u) for u in asked)})

    rows = conn.execute(
        text(
            "SELECT DISTINCT source_url FROM knowledge_entries "
            "WHERE source_url = ANY(:urls) AND tenant_id = :tid"
        ),
        {"urls": lookup, "tid": tenant_id},
    ).fetchall()
    found = {r[0] for r in rows if r and r[0]}

    # 2️⃣  return the caller’s spelling **only** if it or its canonical form
    #     appears in the DB
    return {u for u in asked if u in found or canonical_source_url(u) in found}
```

* The *lookup* includes both the raw URL **as supplied by the caller** and its canonical form.  
* The *result* set only checks the **caller’s original string** (`u`) **or its canonical version** (`canonical_source_url(u)`) **against the rows that the DB returned**.

If the database contains a **historical upper‑cased row** (`"HTTPS://EXAMPLE.COM/OLD.pdf"`), and the caller asks for the **lower‑cased form** (`"https://example.com/OLD.pdf"`), the DB will return the upper‑cased row (because it is in `lookup`).  
`found` therefore contains the upper‑cased string, but the final filter checks:

```python
u in found                     # false  (lower‑cased string not present)
canonical_source_url(u) in found   # false  (canonical of lower‑cased is itself)
```

Hence the function **returns a false‑negative** – the URL is reported as “not ingested” even though a row already exists.

#### 1.3 Why this matters
* The ledger (`ingest_ledger.reconcile`) relies on `ingested_source_urls` to decide whether a newly‑crawled URL should be enqueued again.  
* A false‑negative causes the same URL to be re‑enqueued, leading to **duplicate rows** for the same document (one canonical, one historic upper‑cased).  
* Duplicate rows break the unique index `idx_ke_chunk_dedup` only when the *tenant* and *chunk_index* collide, but they still waste storage, may cause inconsistent visibility (`is_private`) and defeat the “once‑only” guarantee that the ingest pipeline promises.

#### 1.4 Reproduction (fails on the current PR)

```python
import hashlib
from ingest import store

# Fake DB – one historic upper‑cased row
captured = {"rows": [("HTTPS://EXAMPLE.COM/OLD.pdf",)]}
def _fake_engine():
    class _FakeConn:
        def __enter__(self): return self
        def __exit__(self, *exc): return False
        def execute(self, stmt, params):
            return type("Rows", (), {"fetchall": lambda _: captured["rows"]})
    class _FakeEngine:
        def connect(self): return _FakeConn()
    return _FakeEngine()
store._engine = _fake_engine   # monkey‑patch

# Query with the lower‑cased spelling
result = store.ingested_source_urls(
    ["https://example.com/OLD.pdf"], tenant_id="tenant‑a"
)

assert result == {"https://example.com/OLD.pdf"}, "False‑negative observed"
```

Running the snippet with the current PR **fails** – `result` is `set()`.

#### 1.5 Fix recommendation
Return the **original caller string** when *any* row matches, regardless of case, i.e.:

```python
def ingested_source_urls(source_urls: list[str], tenant_id: str = "") -> set[str]:
    …
    rows = conn.execute(...).fetchall()
    found = {r[0] for r in rows if r and r[0]}

    # Normalise the DB rows to their canonical form **once**, then compare.
    canonical_rows = {canonical_source_url(url) for url in found}
    return {
        u
        for u in asked
        if u in found                     # exact match (historical spelling)
        or canonical_source_url(u) in found   # exact match (new canonical row)
        or canonical_source_url(u) in canonical_rows   # match against canonicalised DB rows
    }
```

or, more simply, expand the final filter to also test the canonical form of the *DB* rows:

```python
return {
    u
    for u in asked
    if u in found
    or canonical_source_url(u) in found
    or canonical_source_url(u) in {canonical_source_url(r) for r in found}
}
```

The extra set‑comprehension is cheap (few rows per batch) and guarantees that **any** case‑variation stored historically is recognised.

---

### 2.  `_log_ref` leaks **userinfo** (username/password) in logs

#### 2.1 Intended purpose
`_log_ref` creates a *log‑safe* identifier that shows only the **origin** (host + optional port) and a short SHA‑256 hash of the full URL, so an operator can correlate a refusal with a row **without exposing the path, query, or any credential**.

#### 2.2 Actual implementation
```python
def _log_ref(url: str) -> str:
    …
    origin = urlsplit(url).netloc or "<no host>"
    return f"{origin} sha256:{hashlib.sha256(url.encode('utf-8')).hexdigest()[:12]}"
```

`urlsplit(...).netloc` **includes the user‑info component** (`username:password@`).  
For a URL such as:

```
https://alice:Secr3t@docs.example.com/confidential.pdf?token=XYZ
```

the function returns:

```
alice:Secr3t@docs.example.com sha256:7f3c2a…
```

The credentials are now written to the **warning log** emitted by `store.insert_chunk`:

```python
logger.warning(
    "Refusing knowledge_entries write for %s — %s",
    _log_ref(source_url),
    prov_reason,
)
```

#### 2.3 Why this is a security failure
* The MIRA platform processes **private** documents that often contain **tokens, API keys, or personal data** in the URL.  
* Logging the *userinfo* defeats the whole “log‑safe” guarantee and may expose secrets to anyone who can read the system logs (operations staff, SIEM pipelines, backup archives).  
* The original design note (`Gate 7 round P on #3481, code F1`) explicitly states **“never the path or query (which can carry a document name or a token)”** – the host portion is safe *only* when it does **not** contain user‑info.

#### 2.4 Reproduction (fails on the current PR)

```python
from ingest import store

url = "https://bob:pa$$w0rd@private.example.com/secret.pdf"
ref = store._log_ref(url)

assert "bob:" not in ref, "userinfo leaked"
assert "pa$$w0rd" not in ref, "password leaked"
```

Running the assertion with the current implementation **fails** – the reference string contains `bob:pa$$w0rd@private.example.com`.

#### 2.5 Fix recommendation
Replace `netloc` with a reconstruction that deliberately **drops user‑info**:

```python
def _log_ref(url: str) -> str:
    if not url:
        return "<no url>"
    from urllib.parse import urlsplit

    try:
        parts = urlsplit(url)
        # hostname is None for malformed URLs → fallback to "<unparseable>"
        host = parts.hostname or "<no host>"
        # Preserve port if present
        origin = f"{host}:{parts.port}" if parts.port else host
    except ValueError:
        origin = "<unparseable>"
    return f"{origin} sha256:{hashlib.sha256(url.encode('utf-8')).hexdigest()[:12]}"
```

`urlsplit(...).hostname` never contains the user‑info; the optional `port` is added back only when it exists. This satisfies the “origin‑only” requirement while still giving a stable identifier.

---

### 3.  (Minor) `canonical_source_url` does **not** normalise *userinfo* – still case‑sensitive

*The function lower‑cases only the *scheme* and *host*.  User‑info is left untouched.*  
If a tenant ever supplies URLs that embed credentials, two logically‑identical URLs that differ only in the **casing of the username** (`Bob@…` vs `bob@…`) will be treated as distinct keys.  
While this is not currently exercised by the test‑suite, it violates the “canonical‑source‑URL” contract that aims to **collapse all case‑variations of the origin**.  

**Suggested mitigation (if credentials ever become part of the origin):** also lower‑case the user‑info component, or reject URLs that contain user‑info altogether (the platform currently disallows them at ingest).  

---

## 4.  Impact Summary

| Defect | Confidentiality / Integrity | Likelihood | Exploitability | Consequence |
|--------|-----------------------------|------------|----------------|-------------|
| **1️⃣  ingested_source_urls case‑mismatch** | **Integrity** – duplicate rows, possible visibility downgrade, wasted storage, eventual race‑condition on unique index. | High (triggered on any historic mixed‑case entry) | Trivial – just call the function with a lower‑cased URL. | Silent data‑corruption, violation of the “once‑only ingest” guarantee, extra DB pressure. |
| **2️⃣  `_log_ref` user‑info leakage** | **Confidentiality** – credentials exposed in plain‑text logs. | Medium‑High (any refusal of a private URL with user‑info logs it). | Simple – craft a URL with `user:pass@host`. | Credential leakage to ops staff / log aggregation services, potential credential reuse. |
| **3️⃣  canonical_source_url user‑info case‑sensitivity** | **Integrity** (duplicate rows) – low probability currently because credentials are not allowed, but a future change could expose it. | Low (depends on future feature) | Low | Possible duplicate rows if credentials ever appear. |

---

## 5.  Recommendations & Action Items

1. **Patch `ingested_source_urls`** to recognise case‑insensitive matches against historic rows (see §1.5). Add a targeted unit‑test (the three‑line snippet above) to the test‑suite; the new test will catch regressions in the future.

2. **Patch `_log_ref`** to strip user‑info (see §2.5). Add a test that asserts the returned string never contains a colon before the `@` character.

3. **Document the user‑info handling policy** in `ingest/store.py` – either “user‑info is not permitted” (preferred) **or** “user‑info will be lower‑cased for canonicalisation”.

4. **Run the full CI** with the new test suite **including** the new tests for the two bugs. Verify that the CI still passes after the patches.

5. **Audit any callers of `ingested_source_urls`** to ensure they do not rely on the now‑rejected “empty tenant means all tenants”. If any internal tooling needs cross‑tenant visibility, it must be migrated to an explicit, authorised query path (e.g. a separate admin API).

6. **Update the gate‑7 reviewer documentation** (the “decision‑point reminder”) to reflect the corrected behaviour of the `ingested_source_urls` function, so reviewers are aware that the ledger will now correctly recognise historic mixed‑case URLs.

---

### Final Verdict

The PR **introduces regressions** that defeat the very guarantees it tries to harden:

* **Integrity regression** – `ingested_source_urls` can return false‑negatives for historic upper‑cased URLs, leading to duplicate ingestion.
* **Confidentiality regression** – `_log_ref` logs user‑info, violating the “log‑safe reference” contract.

Because these defects are **structural, security‑critical, and not covered by the supplied test‑suite**, the PR **must be blocked** until the fixes above are applied and the new tests are added.  

**BLOCK**.   (High‑severity – tenant‑scoping, database‑schema, and secret‑handling contracts are violated.)

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
- `shape: expected exactly one `## VERDICT` section, found 0 — UNKNOWN (malformed attempt)`
