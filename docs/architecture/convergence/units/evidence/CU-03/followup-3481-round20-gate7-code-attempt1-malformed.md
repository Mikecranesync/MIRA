# Gate 7 adversarial review — PR #3481

**Verdict:** UNKNOWN · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, cross-repository contract, deletion/destructive, forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `4abb63d000f7760d506319a7edcbcee59ecf0e32`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (202): .claude/commands/gate7-review.md, docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md, docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code-attempt1-cascade-failed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round16-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt3-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code-attempt3-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round17-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round18-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt3-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt3-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt4-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt4-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt5-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt5-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt6-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt7-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-adjudication-attempt8-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt2-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt2-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt3-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt3-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt4-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt4-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt5-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt5-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt6-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt6-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt7-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt7-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt8-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-code-attempt8-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round19-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-code-explain-pg16.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 118,890/118,890 (cap 120,000)
- reviewed-diff sha256 (sent bytes): `0a409c6223078b76a6b43aec3ac449e6e19dfb7d69f0ee76e75f8fcb6792f0a0`
- full scoped-diff sha256 (pre-cap): `0a409c6223078b76a6b43aec3ac449e6e19dfb7d69f0ee76e75f8fcb6792f0a0`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

_No structured findings parsed — see the raw review below._

## Raw review

## Gate 7 – Independent Adversarial Review (Round 12)  
**PR:** `fix(ingest): CU‑03 Gate 9 follow‑up – case‑insensitive origin discovery`  
**Reviewer:** *adversarial (Gate 7 independent)* – **my job is to **disprove** the change.**  

Below is a **high‑effort, X‑HIGH** analysis that looks for **hidden coupling, regressions, security failures, tenant leakage, data‑corruption, irreversible migration, false‑green tests, duplicated logic, scope creep, documentation drift, observability gaps, premature deletion** – i.e. any structural flaw the author’s own tests or the fuzz harness could have missed.

---

## 1. SECURITY – LOGGING OF USERINFO (CREDENTIALS) IN REFUSAL WARNINGS  

| Component | Change | Problem | Evidence | Severity |
|-----------|--------|----------|----------|----------|
| `mira‑crawler/ingest/store.py` – new function `_log_ref` | `origin = urlsplit(url).netloc or "<no host>"` | `urlsplit(...).netloc` **includes the user‑info part** (`username:password@host`).  When a source URL contains credentials (e.g. `https://user:secret@example.com/doc.pdf`) the warning `logger.warning("Refusing … %s …", _log_ref(source_url), …)` writes the *full user‑info* to the log.  The function’s docstring claims the log is “log‑safe” and that it never reveals a **path or query**, but it **does reveal credentials**.  This is a classic credential‑leak via logging. | ```python
def _log_ref(url: str) -> str:
    …
    origin = urlsplit(url).netloc or "<no host>"
    return f"{origin} sha256:{hashlib.sha256(url.encode('utf-8')).hexdigest()[:12]}"
```  
If `url = "https://bob:Pa$$w0rd@evil.com/secret.pdf"` the log line becomes:  

```
Refusing knowledge_entries write for bob:Pa$$w0rd@evil.com — …
```  

| **HIGH** – credential leakage can be exploited by anyone with log‑access (operations, monitoring, CI, SIEM, etc.).  

### Fix  
Replace `netloc` with the **hostname (and optional port)** only, never the user‑info:

```python
parsed = urlsplit(url)
origin = parsed.hostname or "<no host>"
if parsed.port:
    origin = f"{origin}:{parsed.port}"
```

Sanitize any `@`‑delimited credentials before logging, or drop the origin entirely and keep only the hash.

---

## 2. PERFORMANCE / SCALABILITY – OR‑CONDITION IN `chunk_exists` PREVENTS INDEX USAGE  

| Component | Change | Problem | Evidence | Severity |
|-----------|--------|----------|----------|----------|
| `mira‑crawler/ingest/store.py` – `chunk_exists` query | `WHERE (source_url = :url OR source_url = :raw)` | The unique index created by migration 003 is on the **exact tuple** `(tenant_id, source_url, (metadata->>'chunk_index')::int)`. Adding an `OR` on the same column forces PostgreSQL to **disable index‐only scans** and can fall back to a **sequential scan** for large tables. With billions of knowledge‑entries this can degrade ingest throughput dramatically (minutes → hours). | ```sql
SELECT COUNT(*) FROM knowledge_entries
WHERE tenant_id = :tid
  AND (source_url = :url OR source_url = :raw)
  AND metadata->>'chunk_index' = :idx
```  

| **MEDIUM‑HIGH** – a performance regression that can cause time‑outs in production ingest pipelines, effectively a denial‑of‑service for high‑traffic tenants.  

### Fix  
Perform the canonical‑lookup **outside** the SQL statement:

```python
def chunk_exists(...):
    canonical = canonical_source_url(source_url)
    with _engine().connect() as conn:
        cnt = conn.execute(
            text("""SELECT COUNT(*) FROM knowledge_entries
                    WHERE tenant_id = :tid
                      AND source_url IN (:url, :canonical)
                      AND metadata->>'chunk_index' = :idx"""),
            {"tid": tenant_id,
             "url": source_url,
             "canonical": canonical,
             "idx": str(chunk_index)}).scalar()
```

Alternatively, run **two separate indexed queries** (fast) and OR‑combine the Python results. This restores index usage.

---

## 3. DATA DUPLICATION – NON‑NORMALISATION OF DEFAULT PORTS  

| Component | Change | Problem | Evidence | Severity |
|-----------|--------|----------|----------|----------|
| `canonical_source_url` | Lower‑cases scheme & host **only**; retains the port verbatim | URLs that are semantically identical but differ only by an *explicit default port* (`http://example.com` vs `http://example.com:80`, `https://example.com:443`) will be treated as **different canonical keys**. Consequently two rows can be created for the same logical resource, defeating the dedup guarantee and inflating storage. | ```python
if not rest.startswith("//"):
    return f"{scheme}:{rest}"
…
if hostport.startswith("["):
    …   # IPv6 handling
else:
    host, colon, port = hostport.partition(":")
    port = colon + port
return f"{scheme}://{userinfo}{at}{host.lower()}{port}{tail}"
```  

If `url = "http://example.com"` → `"http://example.com"` (no port).  
If `url = "http://example.com:80"` → `"http://example.com:80"` (port kept).  

| **HIGH** – violates the migration’s “exact‑match UNIQUE index” guarantee; duplicate rows lead to data bloat, inconsistent provenance, and possible privacy‑policy violations (different visibility flags per duplicate).  

### Fix  
Strip **default ports** for the two well‑known schemes:

```python
if (scheme == "http" and port == ":80") or (scheme == "https" and port == ":443"):
    port = ""   # drop default
```

Apply this before constructing the final URL.

---

## 4. TENANT‑SCOPING REGRESSION – SILENT FAILURE ON INVALID TENANT IDs  

| Component | Change | Problem | Evidence | Severity |
|-----------|--------|----------|----------|----------|
| `ingested_source_urls` | Early return `if not isinstance(tenant_id, str) or not tenant_id.strip(): … return set()` | The function now **fails closed** (returns empty set) when `tenant_id` is missing or malformed. While this prevents cross‑tenant leakage, **it also silently hides programming errors**: callers that inadvertently pass `None` or `""` will see “nothing ingested” and may assume the ledger is up‑to‑date, when in fact the check was never performed. No warning is emitted in the `except` path (only a warning when the query fails). The earlier version performed a *cross‑tenant* query, which was a bug but also a useful diagnostic; the new silent path makes debugging harder. | ```python
if not isinstance(tenant_id, str) or not tenant_id.strip():
    logger.warning("ingested_source_urls called without a tenant_id — refusing the probe")
    return set()
```  

| **MEDIUM** – hidden coupling between callers and the ledger probe; a subtle bug can lead to false‑positive “already ingested” decisions, causing **data loss** (chunks never stored).  

### Fix  
* Keep the strict tenant guard but **raise** a clear exception (or return a sentinel) so the caller cannot mistake “empty set = nothing ingested” for a successful query.  

```python
if not isinstance(tenant_id, str) or not tenant_id.strip():
    raise ValueError("tenant_id must be a non‑empty string")
```

Or, expose a separate “admin” API for cross‑tenant checks.

---

## 5. EVIDENCE‑ARTIFACT EXCLUSION CAN TURN VALID PRs INTO “EMPTY DIFF” FAILURES  

| Component | Change | Problem | Evidence | Severity |
|-----------|--------|----------|----------|----------|
| `main()` – default call `diff, artifacts = drop_evidence_artifacts(diff)` | If a PR **only changes files under `docs/architecture/convergence/units/evidence/`**, the diff becomes empty (`if not diff.strip(): error`). The CI then aborts with exit‑code 1 (`error: nothing left to review after excluding evidence artifacts`). This makes a **perfectly valid documentation‑only change impossible** unless the reviewer adds `--include-evidence`. The flag is undocumented in the public gate brief and not part of the contract; a malicious actor could deliberately add a *large* evidence‑only diff to cause the CI to fail (a denial‑of‑service vector). | ```python
if not diff.strip():
    print("error: nothing left to review after excluding evidence artifacts", file=sys.stderr)
    return 1
```  

| **MEDIUM** – introduces a new failure mode that is not covered by any test and is exploitable by an attacker who can force a CI failure simply by adding a file under the evidence directory.  

### Fix  
* Treat an “evidence‑only” diff as **passable** (e.g., automatically insert a “None found” finding) or make `--include-evidence` the **default** for documentation‑only PRs.  
* Update the brief to explicitly mention the flag and the “empty‑diff after evidence‑drop” case.

---

## 6. PARSING‑RULINGS – OVER‑PERMISSIVE BARE‑LINE MATCHING  

| Component | Change | Problem | Evidence | Severity |
|-----------|--------|----------|----------|----------|
| `gate7_review.parse_rulings(strict=True)` now also matches the **bare** pattern `F1 SUSTAINED` via `_BARE_RULING_RE`. | The regular expression is **very permissive** (`^\s*[-*]?\s*(?:\*\*)?(F\d+)(?:\*\*)?\s*[:—–-]?\s*(SUSTAINED|REFUTED)`). It can mistakenly capture **any line** that contains a token that looks like `F<number>` followed by one of the two words, even if the line is *not* a ruling (e.g., a comment, a stack trace, a piece of data). The code **does not verify** that the line lives inside the `## RULINGS` section (it does, via `_rulings_section`), but a malicious actor could embed a line that looks like a ruling **outside** the section and it will be ignored – however, the **strict** path already limits to the section. The **legacy** non‑strict path still scans the whole text and will count such stray lines, potentially turning an otherwise **PASS** adjudication into **BLOCK**. This regression was the cause of the original “bare‑ruling” bug (Round G–H).  

| **MEDIUM** – could be abused to force a “SUSTAINED” high‑severity ruling without actually providing a structured ruling block, causing an unjust BLOCK.  

### Fix  
* Require the **explicit** heading `## RULINGS` *and* the bullet format `- **[ruling: …] [id: …]**` for any accepted ruling, even in strict mode.  
* Remove the fallback to `_BARE_RULING_RE` or keep it **only for legacy reports** (i.e., `strict=False`).  

---

## 7. DOCUMENTATION DRIFT – `pr_kind` → `scoped_paths` NOT USED CONSISTENTLY  

| Component | Change | Problem | Evidence | Severity |
|-----------|--------|----------|----------|----------|
| `pr_kind` now classifies based on the *full* `paths` list, while the brief now shows a **scope notice** for `--paths`. The `scoped_paths` helper is defined but only used **once** (to compute `kind` for the brief). Other parts of the pipeline (e.g. escalation logic, diff filtering) still operate on the **unscoped** list, which can cause a mismatch between the **reported kind** (documentation) and the **actual set of files examined** (code). This mismatch can lead to *false‑positive* “documentation‑only” findings when a scoped review actually sees only code.  

The mismatch was the root cause of the original CU‑03 round‑10 “partly documentation” regression.  

| **MEDIUM** – subtle coupling that can cause the reviewer to be mis‑informed about the nature of the change, potentially hiding security‑critical code changes behind a “documentation” brief.  

### Fix  
* Apply `scoped_paths` *everywhere* the code needs the list of visible files (including `escalation`, `pr_kind`, `filter_diff_paths`, `diff_paths_excluded`).  
* Make the `--paths` handling a **first‑class filter** before any other logic, not a post‑hoc notice.

---

## 8. TEST‑SUITE REGRESSION – VERY LARGE CONTRACT TEST (`test_conflict_and_packaging_contracts.py`)  

| Component | Change | Problem | Evidence | Severity |
|-----------|--------|----------|----------|----------|
| New test file – 627 lines, ~300 assertions, heavy monkey‑patching of the DB engine. | The test **replaces the real DB engine globally** for the duration of the module (via fixture `captured`). If any test **outside** this file runs **after** it (e.g., in a parallel CI executor) the monkey‑patch could bleed, causing spurious failures or hidden state leakage. The fixture is function‑scoped, but the import of `store` happens **before** the fixture is applied, meaning the module‑level `_ENGINE` may have been instantiated earlier (e.g., by other tests) and never replaced. This creates a hidden coupling between test order and success. | The fixture does:

```python
@pytest.fixture
def captured(monkeypatch) -> dict:
    box = {}
    monkeypatch.setattr(store, "_engine", lambda: _FakeEngine(box))
    return box
```

but the global `_ENGINE` variable may have already been created.  

| **MEDIUM** – flaky CI, nondeterministic test failures, and possible production‑code side‑effects if a test inadvertently leaves the fake engine in place.  

### Fix  
* Ensure the fake engine is installed **before** any import that could instantiate `_ENGINE`. Use a **session‑scoped autouse fixture** that patches `_engine` at import time, or restructure `store` to lazily create the engine only on first use.  
* Add an explicit `pytestmark = pytest.mark.usefixtures("captured")` at the top of the module to guarantee ordering.  

---

## 9. LOG‑REDUCTION – REDACTION DOES NOT Strip USERINFO  

| Component | Change | Problem | Evidence | Severity |
|-----------|--------|----------|----------|----------|
| `gate7_review.redact` (unchanged) | The redaction patterns currently cover IP, MAC, serial numbers, but **do not cover `username:password@` in URLs**. Combined with issue 1 (logging userinfo), a URL containing credentials will survive redaction in the diff presented to the reviewer, potentially leaking secrets in the prompt sent to the LLM. | Example diff line:  

```
+ https://bob:secret@example.com/report.pdf
```  

Redaction will replace the IP/MAC etc. but leave the credential part untouched.  

| **HIGH** – LLM prompt exposure of credentials violates the “no secret data in prompts” policy and creates an information‑leak risk.  

### Fix  
* Extend the redaction regex to match `(?P<userinfo>[^/@\s]+:[^/@\s]+)@` and replace the whole `userinfo@` segment with `[REDACTED]@`.  

---

## 10. UNINTENDED CONTRACT BREAK – `--include-evidence` NOT DOCUMENTED in the Gate 7 Brief  

| Component | Change | Problem | Evidence | Severity |
|-----------|--------|----------|----------|----------|
| `--include-evidence` flag added to CLI | The gate brief (the **prompt sent to the LLM**) does **not mention** this flag or its effect on the diff. Reviewers (human or model) are unaware that evidence artifacts are stripped by default, which may lead to **missing context** and consequently to false findings. Moreover, the brief’s “WHAT KIND OF CHANGE THIS IS” section does not warn about the omission, violating the contract that the reviewer must see *everything* that could affect the decision. | The brief (generated by `build_prompt`) now contains a scope notice and decision‑point reminder but no line like “by default we exclude evidence artifacts – use `--include-evidence` to keep them”.  

| **MEDIUM** – hidden contract change; reviewers can be mis‑led.  

### Fix  
* Add a concise paragraph to the brief (after the scope notice) that states:  

```
By default we exclude files under docs/…/units/evidence/ (raw reviewer output / logs). Use the `--include-evidence` flag to keep them in the diff; omitted files are listed in the receipts.
```  

---

# Summary of Findings

| # | Category | Description | Severity |
|---|----------|-------------|----------|
| 1 | **Security – Credential leakage in logs** | `_log_ref` logs `urlsplit(...).netloc` which contains user‑info. | **HIGH** |
| 2 | **Performance – OR‑condition prevents index use** | `chunk_exists` query with `(source_url = :url OR source_url = :raw)` leads to full‑table scans. | **MEDIUM‑HIGH** |
| 3 | **Data duplication – Default port not normalized** | `canonical_source_url` keeps `:80`/`:443`, causing duplicate rows for the same logical URL. | **HIGH** |
| 4 | **Tenant‑scoping – Silent failure on bad tenant ID** | `ingested_source_urls` returns empty set without raising, hiding programmer error. | **MEDIUM** |
| 5 | **Evidence‑artifact exclusion can cause empty‑diff failures** | PRs that only touch evidence files abort CI with “nothing left to review”. | **MEDIUM** |
| 6 | **Parsing rulings – Bare‑line over‑permissiveness** | `_BARE_RULING_RE` may capture non‑ruling lines in legacy mode, leading to false BLOCKs. | **MEDIUM** |
| 7 | **Scope‑notice mismatch – Kind computed on full file list** | `pr_kind` uses un‑scoped `paths`; can mis‑report “documentation” vs “code”. | **MEDIUM** |
| 8 | **Test‑suite flakiness – Large contract test patches DB globally** | Monkey‑patch may bleed into other tests, causing nondeterministic failures. | **MEDIUM** |
| 9 | **Redaction misses URL user‑info** | LLM prompt may contain credentials in URLs, violating secret‑data policy. | **HIGH** |
|10 | **Undocumented `--include-evidence` flag** | Review brief does not disclose that evidence files are stripped by default. | **MEDIUM** |

---

## Recommended Action Plan

1. **Patch `store._log_ref`** to strip user‑info and only log hostname (and optional port). Add unit test confirming that credentials are not emitted.  
2. **Rewrite `chunk_exists`** to avoid OR‑conditions; either query twice (canonical & raw) or use `IN (:url, :canonical)` with proper index support. Add performance benchmark test.  
3. **Enhance `canonical_source_url`** to drop default ports for `http` (80) and `https` (443). Add regression test verifying that `http://example.com` and `http://example.com:80` map to the same canonical key.  
4. **Make tenant‑ID validation strict** – raise `ValueError` or return a sentinel, and adjust callers accordingly.  
5. **Gracefully handle evidence‑only diffs** – treat them as a valid “None found” review, or make `--include-evidence` the default for documentation‑only changes. Add a test where the diff only contains an evidence file.  
6. **Restrict ruling parsing** – in strict mode accept only the bullet format (`- **[ruling: …] [id: …]**`). Keep the bare‑line regex only for `strict=False` (legacy reports). Add tests that ensure stray `F1 SUSTAINED` lines outside `## RULINGS` are ignored.  
7. **Apply `scoped_paths` consistently** across `pr_kind`, `escalation`, and any other function that consumes the file list. Add a test that runs the tool with `--paths docs/` and verifies that the kind is “documentation”.  
8. **Isolate the DB‑mock fixture** – use a session‑scoped autouse fixture or restructure `store` to lazily create the engine after the fixture is applied. Add a test ordering sanity check.  
9. **Extend redaction patterns** to scrub user‑info in URLs (`username:password@`). Add unit tests for URLs with credentials.  
10. **Update the gate brief** to mention the `--include-evidence` flag and the default exclusion of evidence artifacts.  

Implementing these fixes will close the high‑severity security gaps, restore the intended performance characteristics, eliminate data‑duplication bugs, and bring the gate back into compliance with the documented contracts. Until these are addressed, **the PR must be blocked**.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
- `shape: expected exactly one `## VERDICT` section, found 0 — UNKNOWN (malformed attempt)`
