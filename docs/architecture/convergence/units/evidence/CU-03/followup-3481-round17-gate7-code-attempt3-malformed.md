# Gate 7 adversarial review — PR #3481

**Verdict:** UNKNOWN · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, cross-repository contract, deletion/destructive, forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `7ead5fe244e9b448f4d8e4a2b8903a6350b3cfb2`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (150): .claude/commands/gate7-review.md, docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md, docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code-attempt1-cascade-failed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-code-explain-pg16.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 100,128/100,128 (cap 110,000)
- reviewed-diff sha256 (sent bytes): `c569292380fee6e586cc186b088df8b1ed67b65358037e7ff9e40339911ee791`
- full scoped-diff sha256 (pre-cap): `c569292380fee6e586cc186b088df8b1ed67b65358037e7ff9e40339911ee791`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

_No structured findings parsed — see the raw review below._

## Raw review

## Gate 7 – Adversarial Review (XHIGH)

**PR under review:** `fix(ingest): CU‑03 Gate 9 follow‑up – case‑insensitive origin discovery`  
**Scope of the review:** All files changed in this PR (diff reproduced above) plus the surrounding *gate‑7* tooling that was updated.

Below is a **catalog of defects that the current test‑suite does *not* exercise**.  
Each item is presented with:

| # | Defect type | Where it lives in the code | Why it is a problem (security / data‑integrity / regression) | Evidence that the defect is not covered by the existing tests | Suggested remediation (high‑level) |
|---|-------------|---------------------------|---------------------------------------------------------------|---------------------------------------------------------------|------------------------------------|

---

### 1️⃣  **Deduplication → duplicate rows when default ports are present**  
**File / function:** `mira‑crawler/ingest/store.py → canonical_source_url`  

*Problem* – The function lower‑cases **scheme** and **host only**.  It deliberately **preserves the port component verbatim**.  
Consequences:

| a)  Two URLs that resolve to the same resource (e.g. `http://example.com/path` and `http://example.com:80/path`) are **treated as different** dedup keys.  
| b)  The `INSERT … ON CONFLICT … DO NOTHING` clause will not fire because the `source_url` column differs, resulting in **duplicate rows** for the same logical document.  
| c)  Duplicate rows break the *“one canonical key per resource”* invariant that the migration 003 (`idx_ke_chunk_dedup`) was designed to enforce.  

*Why the tests miss it* – The `TestCanonicalSourceUrl` suite covers a range of schemes, hosts, IPv6, file‑URLs, etc., **but never includes a URL with an explicit default port** (`:80` for http, `:443` for https).  The `test_store_chunks_cannot_create_a_second_differently_cased_key` only checks case‑variation, not port‑variation.

*Security / data‑corruption impact* –  
- **Storage bloat** (two rows for the same document).  
- **Visibility leakage**: a later ingest of the same document with a different port will be stored as a *new* private row, potentially exposing a private copy to a public origin (if the policy later classifies the other origin as public).  
- **Conflicting updates**: the `conflict` test expects a **DO NOTHING** action; with two distinct keys the conflict never occurs, violating the “private‑visibility flag never upgraded on conflict” guarantee.

*Suggested fix* – Extend `canonical_source_url` to **strip default ports** for http/https (and optionally other schemes). Example:

```python
if scheme == "http" and port == ":80":
    port = ""
if scheme == "https" and port == ":443":
    port = ""
```

Add unit‑tests for both `http://example.com:80/x` → `http://example.com/x` and `https://example.com:443/x` → `https://example.com/x`.

---

### 2️⃣  **Potential leakage via the log‑ref hash**  
**File / function:** `mira‑crawler/ingest/store.py → _log_ref`  

*Problem* – The refusal‑log now prints:

```
"{origin} sha256:{hash_of_full_url[:12]}"
```

The hash is a **truncated SHA‑256 (48 bits)** of the *entire* URL, **including path and query**.  Even though the path/query are not printed, an attacker who can read the logs can perform a **dictionary/brute‑force attack** on short, low‑entropy query strings (e.g. `?token=abc123`) and recover the original URL.  The 12‑character hex digest is well within a feasible search space for typical token lengths.

*Why the tests miss it* – `TestRefusalLogging` only asserts that the *path* and *query* do not appear verbatim. It does **not** check whether the hash is *cryptographically safe*.

*Security impact* –  
- **Credential exposure**: tokens, file‑ids, or any secret embedded in the URL become recoverable.  
- **Cross‑tenant leakage**: if a token uniquely identifies a tenant’s resource, the hash becomes a *fingerprint* that can be correlated across logs.

*Suggested mitigation* –  
- Either **omit the hash altogether** (log only the origin, as originally designed).  
- Or use a **keyed HMAC** with a secret rotation key, and truncate **after the HMAC**, not the raw SHA‑256.  
- If a hash must stay, increase the truncation length (e.g. 20 hex chars ≈ 80 bits) and document the threat model.

Add a test that verifies the hash cannot be trivially reversed for a known short token (e.g. use a pre‑computed rainbow‑table lookup).

---

### 3️⃣  **Strict reviewer‑output shape may reject valid LLM replies**  
**File / function:** `tools/gate7_review.py → validate_review_shape` (and `fresh_review_verdict`)  

*Problem* – The reviewer brief now *enforces* exactly **one** `## VERDICT`, **one** `## FINDINGS`, **one** `## NOT REVIEWED`. Any deviation (extra blank lines after a heading, an additional Markdown block, a stray table, a bold‑styled verdict, etc.) leads to `UNKNOWN`.  

Consequences:

| a)  Real‑world LLMs frequently emit **extra newline** or a **trailing space** after a heading.  
| b)  The gate will discard the whole review as `UNKNOWN`, forcing a *re‑run* and consuming a round budget.  
| c)  The change is **not covered by the test‑suite** – the tests only check that a well‑formed “PASS / BLOCK” block works; they never simulate a realistic LLM output that contains, say, an empty line after `## VERDICT`.

*Regression impact* – In production the gate may start **blocking** PRs that previously passed, not because of a real defect but because the LLM output format is too strict. This is a *behavioural regression* and defeats the purpose of the “high‑effort” gate.

*Suggested remediation* –  
- Loosen the validation to **ignore harmless whitespace** after headings: treat the first non‑empty line after a heading as the verdict.  
- Accept a **bold‑wrapped verdict** (`## VERDICT\n**PASS**`) as a legacy fallback.  
- Add a set of **fuzzed reviewer‑output fixtures** (tables, extra paragraphs, bold verdicts) to the test‑suite to guarantee tolerant parsing.

---

### 4️⃣  **Tenant‑ID validation may break callers that pass non‑string IDs**  
**File / function:** `mira‑crawler/ingest/store.py → ingested_source_urls`  

*Problem* – The guard now rejects **any non‑string** tenant identifier (`int`, `None`, etc.) and returns an empty set. Historically the function accepted any object that could be bound to `:tid` (SQLAlchemy would coerce it to text).  

Impact:

| a)  Some internal utilities (e.g. a background job that receives a numeric tenant primary‑key) may call `ingested_source_urls(…, tenant_id=42)`.  
| b)  With the new guard they will receive *no* provenance information, causing the **ledger probe** to think the URL is “not ingested” and attempt an insert.  
| c)  If the insert succeeds, a **row with an empty tenant_id** is created, leaking data across tenants (any later query that omits the tenant filter will now see this row).  

*Why not caught* – The test suite only checks for empty/whitespace strings and `None`; it never passes an **integer** tenant ID.

*Suggested fix* –  
- Coerce non‑string IDs to `str` **before** the `strip()` check, or raise a clear `TypeError` that is caught upstream.  
- Update the test‑suite with a case for an integer tenant ID and assert the expected behaviour (either accept after conversion or raise).

---

### 5️⃣  **`.log` files are now treated as documentation, affecting `pr_kind`**  
**File / function:** `tools/gate7_review.py → _DOC_SUFFIXES` (added “`.log`”) and `pr_kind`  

*Problem* – A PR that **adds a new logging configuration file** (e.g. `src/my_app/logging.conf` or even a `.log` source file) will be classified as **“documentation”** rather than **“code”**.  

Consequences:

| a)  The **decision‑point reminder** (which only appears for non‑code PRs) will be injected, possibly confusing the reviewer.  
| b)  The **kind‑block** that explains “preserved review artifacts are historical evidence” will be added, even though the change is pure code.  
| c)  More subtly, the *conflict‑behaviour* tests (F1) rely on the *code*‑kind path; mis‑classification could hide a code‑only defect behind a “documentation” brief.  

*Why not covered* – No test exercises `pr_kind` on a PR that touches a `.log` file; the existing test only checks “code” vs “documentation” with `.md`/`.txt`.  

*Suggested remediation* –  
- Restrict the `.log` entry to **only the evidence directory** (`docs/.../units/evidence/`), not globally.  
- Keep the original `_DOC_SUFFIXES` (`.md, .markdown, .rst, .txt`) for generic classification, and add a *separate* detection for “evidence logs” in the `is_evidence_artifact` helper.  

Add a unit‑test that verifies `pr_kind(["some/logging.conf"]) == "code"` and `pr_kind(["docs/evidence/foo.log"]) == "documentation"`.

---

## Summary of Findings

| # | Defect | Severity (Gate 7) | Immediate risk |
|---|--------|-------------------|----------------|
| 1 | Duplicate rows caused by un‑normalised default ports | **High** – data corruption & privacy breach | Multiple rows for the same document; conflict‑logic bypass |
| 2 | Log‑ref hash may leak secrets (truncated SHA‑256) | **High** – credential exposure | Brute‑force recovery of tokens from logs |
| 3 | Over‑strict reviewer‑output shape → false UNKNOWN verdicts | **Medium** – workflow regression | Unnecessary round‑consumption, blocking legitimate PRs |
| 4 | Tenant‑ID guard rejects integer IDs → cross‑tenant leakage | **Medium** – possible data leakage | Rows inserted with empty tenant, visible to all |
| 5 | `.log` files re‑classified as documentation | **Low** – observability / documentation drift | Mis‑labelled PRs, noisy reviewer prompts |

All of the above defects **survive the current test‑suite** and therefore constitute genuine regression or security gaps that the “fresh round‑12” gate must surface before the PR can be merged.

---

## Recommended Action Plan

1. **Canonical‑URL Port Normalisation** – Extend `canonical_source_url` to strip default ports. Add targeted unit‑tests (`http://example.com:80/...` → `http://example.com/...`).  
2. **Log‑Ref Hardening** – Replace raw‑hash logging with a keyed HMAC or drop the hash entirely. Add a security‑test that verifies the hash cannot be reversed for a known short token.  
3. **Relax Reviewer Shape Validation** – Accept benign whitespace, bold verdicts, and a single extra newline after headings. Add fuzzed‑output tests.  
4. **Tenant‑ID Coercion / Error‑Handling** – Convert non‑string IDs to `str` or raise a clear exception. Extend tests for integer IDs.  
5. **Separate Evidence‑Log Handling** – Keep `.log` out of the generic `_DOC_SUFFIXES`; handle it only in `is_evidence_artifact`. Add tests for `pr_kind` on `.log` files.

Implementing these mitigations will close the uncovered gaps, preserve the intended guarantees of Gate 7, and prevent the hidden coupling / data‑corruption / security failures that this adversarial review has identified.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
- `shape: expected exactly one `## VERDICT` section, found 0 — UNKNOWN (malformed attempt)`
