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

## Gate 7 – Adversarial Review (XHIGH)

**Verdict:** **BLOCK** – a high‑severity tenant‑isolation defect (and a medium‑severity Docker‑ignore false‑negative) are present. The PR introduces regression‑type bugs that were not caught by the existing unit‑tests or fuzzers.

---  

### 1️⃣  HIGH – Tenant‑ID is not normalised before use – cross‑tenant dedup / data‑leak risk  

**Why it matters**  
`knowledge_entries` is scoped per‑tenant (`tenant_id` is part of the UNIQUE index).  
If a tenant identifier contains leading/trailing whitespace the system treats it as a **different tenant**:

* `chunk_exists()` and `ingested_source_urls()` accept the raw `tenant_id` string and embed it directly in the SQL query (lines ≈ 43‑55 & 389‑410 in `mira‑crawler/ingest/store.py`).  
* The guard in `ingested_source_urls()` only checks `tenant_id.strip()` for *emptiness* – it does **not** strip the value before it is bound to `:tid`.  

Consequences  

| Scenario | What happens | Impact |
|----------|--------------|--------|
| `MIRA_TENANT_ID="tenant‑a "` (trailing space) | `chunk_exists()` looks for rows where `tenant_id = 'tenant‑a '` – it will not find existing rows that were stored under the correct tenant ID `"tenant‑a"` | Duplicate inserts are attempted (the `ON CONFLICT … DO NOTHING` guard never fires) → wasted work, log‑spam and potential **DoS** on the DB. |
| Same malformed ID is later used for an **INSERT** | The row is written under the *spurious* tenant `"tenant‑a "` → data that belongs to tenant‑a becomes visible under a **different tenant namespace** (if later code normalises the ID, the row may be read by the real tenant, leaking private content). |
| An attacker can deliberately craft a tenant ID with whitespace to bypass the dedup guard and insert the same private document many times, inflating storage costs and potentially exhausting quotas. | **Tenant isolation is broken** – a violation of the “tenant‑only” contract that was explicitly adjudicated in earlier rounds (see round 3 – high finding *“Conflict handling never upgrades a row to a more‑private state”*). |

**Evidence (store.py)**  

```python
# chunk_exists – lines 36‑55 (excerpt)
def chunk_exists(tenant_id: str, source_url: str, chunk_index: int) -> bool:
    …
    raw_url = source_url
    source_url = canonical_source_url(source_url)   # <-- canonicalised
    …
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

```python
# ingested_source_urls – lines 389‑410 (excerpt)
def ingested_source_urls(source_urls: list[str], tenant_id: str = "") -> set[str]:
    …
    if not isinstance(tenant_id, str) or not tenant_id.strip():
        logger.warning("ingested_source_urls called without a tenant_id — refusing the probe")
        return set()
    …
    rows = conn.execute(
        text(
            "SELECT DISTINCT source_url FROM knowledge_entries "
            "WHERE source_url = ANY(:urls) AND tenant_id = :tid"
        ),
        {"urls": lookup, "tid": tenant_id},
    ).fetchall()
```

*The guard only validates that `tenant_id.strip()` is *non‑empty*; it does **not** pass the stripped value to the query.*

**Why the current test suite does not catch it**  

`tests/test_gate7_review.py::TestCanonicalSourceUrl::test_lookup_also_matches_a_historical_row_stored_in_the_callers_spelling` only verifies that the *raw* and *canonical* URLs are bound – it never injects a tenant ID with surrounding whitespace.  
No test exercises `ingested_source_urls` or `chunk_exists` with a tenant ID such as `"tenant‑a "`; therefore the regression is invisible to the existing coverage.

**Suggested fix**  

1. Normalise `tenant_id` **once** at the entry‑point of the ingestion pipeline (e.g. in `tasks/ingest.py`) – `tenant_id = tenant_id.strip()` – and reject any ID that does not match the allowed pattern (`^[a-zA-Z0-9_-]+$`).  
2. Inside `store.py` also normalise before binding:

```python
def _norm_tenant(tenant_id: str) -> str:
    if not isinstance(tenant_id, str):
        raise TypeError("tenant_id must be a string")
    norm = tenant_id.strip()
    if not norm:
        raise ValueError("tenant_id may not be empty or whitespace")
    return norm
```

Then use `_norm_tenant(tenant_id)` in the parameter dicts for **both** `chunk_exists` and `ingested_source_urls`.  
3. Add unit tests that deliberately pass tenant IDs with leading/trailing whitespace and assert that the functions raise (or reject) rather than silently succeed.

---

### 2️⃣  MEDIUM – `.dockerignore` test does not emulate Docker’s pattern semantics – manifest may be omitted from images  

**Why it matters**  
`TestManifestPackaging.test_build_context_does_not_exclude_the_manifest` checks that the policy file (`provenance_policy.yaml`) is *not* excluded by `.dockerignore`. The test uses `fnmatchcase` on each raw line of `.dockerignore`. Docker’s ignore‑file matching differs from `fnmatchcase`:

| Docker behaviour | `fnmatchcase` behaviour |
|------------------|------------------------|
| A pattern **without a slash** (`*.yaml`) matches files **anywhere** in the context. | `fnmatchcase("mira-crawler/provenance_policy.yaml", "*.yaml")` → **False** (because the pattern does not contain a slash). |
| Leading `**/` is treated as “match at any depth”. | The test explicitly adds a variant without the `**/` prefix, but still relies on `fnmatchcase`. |

If the repository’s `.dockerignore` ever contains a generic pattern such as `*.yaml` or `provenance_*` (both plausible in a large repo), the manifest could be silently omitted from the Docker build context. The runtime gate (enforce_visibility) would then **refuse every write** for any origin that is not explicitly listed in a policy – the intended fail‑closed behaviour – but the failure would surface only at runtime, not at review time, and would be indistinguishable from a policy‑error. This defeats the “manifest packaging” contract that the PR is meant to guarantee.

**Evidence (test code)**  

```python
# test_provenance_policy.py – lines 84‑107 (excerpt)
for raw in (REPO_ROOT / ".dockerignore").read_text(...).splitlines():
    pat = raw.strip()
    if not pat or pat.startswith("#"):
        continue
    variants = {pat, pat[3:] if pat.startswith("**/") else pat}
    for c in candidates:
        for v in variants:
            assert not fnmatchcase(c, v), f".dockerignore `{raw}` excludes {c}"
```

*`fnmatchcase` does **not** replicate Docker’s “pattern without slash matches any directory level”.*  

**Why the current test suite does not catch it**  

The test only covers the current `.dockerignore` content; it does not verify the *matching semantics* themselves. If a future change adds a generic ignore rule, the test will still pass, yet the image will miss the manifest.

**Suggested fix**  

Replace the naïve `fnmatchcase` check with a Docker‑ignore matcher. A minimal fix is to use the `pathspec` library (which implements the same rules as Docker) or to re‑implement the matching rules:

```python
import pathspec

def dockerignore_excludes(path: str, patterns: list[str]) -> bool:
    # Docker treats patterns as a .gitignore‑style spec
    spec = pathspec.PathSpec.from_lines('gitwildmatch', patterns)
    return spec.match_file(path)

# In the test:
patterns = [line.rstrip() for line in (REPO_ROOT / ".dockerignore").read_text().splitlines()
            if line and not line.startswith('#')]
for candidate in candidates:
    assert not dockerignore_excludes(candidate, patterns), f".dockerignore excludes {candidate}"
```

Add a dedicated test that verifies a known Docker‑ignore pattern (e.g. `*.yaml`) correctly excludes a nested file, proving the matcher behaves like Docker.

---

### 3️⃣  LOW – Evidence‑artifact detection does not recognise `.yaml` or other non‑text artefacts  

The `is_evidence_artifact` helper treats any file under `units/evidence/` whose name ends with a doc‑suffix (`.md`, `.markdown`, `.rst`, `.txt`, `.log`) as an artifact. Policy files (`.yaml`) that are part of the evidence bundle (e.g. a captured manifest copy) would **not** be classified as an artifact and therefore would remain in the reviewed diff, potentially polluting the reviewer’s view. This is not a security breach but a minor usability regression.

**Suggested fix** – extend `_DOC_SUFFIXES` to include `".yaml", ".yml"` or make the check configurable.

---

## Summary of Findings

| # | Severity | Component | Description | Evidence |
|---|----------|-----------|-------------|----------|
| 1 | **HIGH** | `store.chunk_exists` / `store.ingested_source_urls` | `tenant_id` is not normalised (whitespace not stripped) before being bound to SQL, breaking tenant isolation and deduplication. | `store.py` lines 43‑55 and 389‑410; missing `.strip()` on `tenant_id` before query. |
| 2 | **MEDIUM** | `test_provenance_policy` (Docker‑ignore test) | Test uses `fnmatchcase` which does **not** emulate Docker’s ignore semantics; a generic pattern like `*.yaml` could silently exclude `provenance_policy.yaml` from images. | Test code lines 84‑107; mismatch between Docker and `fnmatchcase`. |
| 3 | **LOW** | `gate7_review.is_evidence_artifact` | Does not treat `.yaml` files as evidence artifacts, leaving them in the reviewed diff. | `_DOC_SUFFIXES = (".md", ".markdown", ".rst", ".txt", ".log")`. |

### Recommended Action

1. **Implement tenant‑ID normalisation** (strip whitespace, validate characters) in all store‑layer entry points (`chunk_exists`, `ingested_source_urls`, `insert_chunk`). Add tests for malformed tenant IDs with surrounding spaces.  
2. **Replace `.dockerignore` test matcher** with a Docker‑compatible implementation (`pathspec` or custom Git‑wildmatch parser) and add a regression test that confirms a pattern like `*.yaml` correctly flags the manifest file.  
3. (Optional) **Broaden evidence‑artifact suffix list** to include policy files (`.yaml`, `.yml`) or make it configurable.

Until these fixes are applied the PR must be **rejected** (BLOCK) because it re‑introduces a tenant‑isolation regression and leaves a critical packaging verification gap that could cause silent manifest loss in production images.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
- `shape: expected exactly one `## VERDICT` section, found 0 — UNKNOWN (malformed attempt)`
