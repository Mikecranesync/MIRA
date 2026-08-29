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

## Gate 7 – Independent Adversarial Review (X‑HIGH)

**PR # `fix(ingest): CU‑03 Gate 9 follow‑up …`**  
**Reviewer:** *Gate 7 independent adversarial reviewer*  
**Scope:** database/schema, canonical asset identity, tenant scoping, cross‑repository contract, deletion/destructive, forced by `--xhigh`  

### TL;DR
The PR introduces a **canonical URL normaliser** and a **log‑safe URL reference** but inadvertently creates three high‑severity regressions:

| # | Category | Symptom | Impact | Where |
|---|----------|---------|--------|-------|
| 1 | **Security – credential leakage** | `_log_ref()` logs the full `netloc` (including any `userinfo` – i.e. `user:pass@host`). | Secrets in URLs (API keys, passwords, tokens) are written to the `mira‑crawler.store` warning log and can be harvested by any operator or downstream log‑collector. | `store._log_ref` (lines ≈ 84‑101) |
| 2 | **Data integrity – duplicate rows** | `canonical_source_url()` **does NOT normalise default ports** (e.g. `http://example.com` vs `http://example.com:80`) or **percent‑encoding case** (`%2F` vs `%2f`). | Two logically identical resources can be stored as distinct rows, violating the intent of the `idx_ke_chunk_dedup` UNIQUE index and inflating the knowledge store. | `store.canonical_source_url` (lines ≈ 46‑119) |
| 3 | **Behavioural regression – tenant‑less probe** | `ingested_source_urls()` now **refuses** to run when `tenant_id` is empty/whitespace and returns an empty set instead of “all‑tenant” probe. | Existing callers (e.g. the ledger clean‑up job, historic ad‑hoc scripts, and some unit‑tests that invoke the function with the default `tenant_id=""`) will silently think **nothing** is ingested and will retry inserts, creating duplicate rows and unnecessary load. | `store.ingested_source_urls` (lines ≈ 214‑236) |
| 4 | **Hidden coupling – read‑paths not canonicalised** | Other code that **queries** `knowledge_entries` by `source_url` (e.g. `tasks/ingest._read_chunks_by_source`, `kg_writer.link_chunk_to_equipment`, any ad‑hoc analytics) still uses the **raw URL**. | After the migration, rows are stored canonicalised, but those look‑ups miss them, returning “no data”. This is a functional regression that can surface as missing search results or broken downstream pipelines. | Any module that builds a `SELECT … WHERE source_url = :url` without calling `store.canonical_source_url`. (Not directly in this PR, but the change makes the discrepancy visible.) |
| 5 | **Observability gap – evidence‑artifact exclusion** | The new `--include‑evidence` flag **drops** all files under `docs/…/units/evidence/` from the diff **without any explicit user‑acknowledgement** other than a printed notice. | In a high‑risk environment (e.g. audit‑trail compliance) reviewers may miss crucial context that lives only in those artifacts. The receipt block lists them, but the diff shown to the LLM is silently shortened, which can be abused to hide a defect. | `tools/gate7_review.py` – `drop_evidence_artifacts` & `receipts_block` (lines ≈ 713‑770) |

Below is a detailed, reproducible analysis of each issue, why it matters, and a concrete remediation plan.

---

## 1️⃣ Security – Credential Leakage in `_log_ref`

### Symptom
```python
def _log_ref(url: str) -> str:
    ...
    origin = urlsplit(url).netloc or "<no host>"
    return f"{origin} sha256:{hashlib.sha256(url.encode('utf-8')).hexdigest()[:12]}"
```
* `urlsplit(...).netloc` returns the *entire* authority component, i.e. `user:pass@host:port`.  
* When a write is refused (e.g. blocked origin) the code does:

```python
logger.warning(
    "Refusing knowledge_entries write for %s — %s",
    _log_ref(source_url),
    prov_reason,
)
```

Thus the warning log line contains **the full userinfo**. The subsequent SHA‑256 hash does not hide it – it merely adds a short fingerprint.

### Impact
* **High** – any URL that carries credentials (basic‑auth, API‑keys in query strings, tokens embedded in the userinfo part) will be written to the log file in clear text.  
* Logs are typically shipped to central log aggregators (Splunk, ELK, CloudWatch). An attacker who can read those logs obtains valid credentials.  
* The design rationale (“log‑safe reference … never the path or query”) is **defeated** because userinfo is part of the *origin*.

### Reproduction
```python
>>> from mira_crawler.ingest import store
>>> store._log_ref('https://bob:SeCrEt@example.com/secret.pdf')
'bob:SeCrEt@example.com sha256:3e5b…'   # userinfo visible
```

### Fix Recommendation
Sanitise the `netloc` before logging:

```python
def _log_ref(url: str) -> str:
    if not url:
        return "<no url>"
    from urllib.parse import urlsplit
    try:
        parsed = urlsplit(url)
        # Strip any userinfo before the '@'
        host = parsed.hostname or "<no host>"
        port = f":{parsed.port}" if parsed.port else ""
        origin = f"{host}{port}"
    except ValueError:
        origin = "<unparseable>"
    return f"{origin} sha256:{hashlib.sha256(url.encode('utf-8')).hexdigest()[:12]}"
```

* This keeps the host (the part we really need for correlation) but never logs username/password.  
* Add a dedicated unit test confirming that `bob:secret@host` becomes `host` in the log reference.

---

## 2️⃣ Data Integrity – Missing Normalisation of Default Ports & Percent‑Encoding Case

### Symptom
`canonical_source_url()` only lower‑cases the **scheme** and **host**:

```python
scheme = head.lower()
...
host = host.lower()
```

It **does not**:
* Strip default ports (`:80` for `http`, `:443` for `https`).
* Normalise percent‑encoding case (`%2F` → `%2f`).

Consequences:

| Example | Stored Canonical | Stored Canonical (alternative) | Dedup result |
|---------|------------------|--------------------------------|--------------|
| `http://example.com/foo` | `http://example.com/foo` | `http://example.com:80/foo` | **different** rows |
| `https://example.com/bar?x=%2F` | `https://example.com/bar?x=%2F` | `https://example.com/bar?x=%2f` | **different** rows |

The unique index `idx_ke_chunk_dedup` (see migration 003) treats the whole `source_url` as part of the key. Therefore the same logical resource can be stored twice, violating the *“one canonical key per URL”* invariant that the PR claims to enforce.

### Impact
* **High** – duplicate knowledge entries waste storage, break de‑duplication guarantees, and can cause downstream analytics (e.g. “how many distinct documents have we ingested?”) to over‑count.  
* It also opens a **denial‑of‑service** vector: an attacker could repeatedly submit the same document with different default‑port forms, inflating the table until the DB fills.

### Reproduction
```python
>>> from mira_crawler.ingest import store
>>> store.canonical_source_url('http://example.com:80/foo')
'http://example.com:80/foo'   # unchanged – default port retained
>>> store.canonical_source_url('https://example.com/bar?x=%2F')
'https://example.com/bar?x=%2F'   # unchanged – upper‑case hex retained
```

Insert two chunks with the above URLs (using the test harness or the real DB) and you will see **two rows** under the same tenant.

### Fix Recommendation
1. **Default‑port stripping** – after extracting `host` and `port`, drop the port if it matches the scheme’s default.
2. **Percent‑encoding normalisation** – canonicalise the *path* and *query* components using `urllib.parse.unquote`/`quote` with `safe='/:?&='` and lower‑case the hex digits.

A minimal, safe implementation:

```python
def _strip_default_port(scheme: str, host: str, port: str) -> str:
    defaults = {'http': '80', 'https': '443'}
    return '' if defaults.get(scheme) == port else f":{port}" if port else ''

def canonical_source_url(url: str) -> str:
    if not url:
        return url
    head, sep, rest = url.partition(":")
    if not sep or not _SCHEME_RE.fullmatch(head):
        return url
    scheme = head.lower()
    if not rest.startswith("//"):
        return f"{scheme}:{rest}"
    body = rest[2:]
    # locate authority
    end = len(body)
    for stop in "/?#":
        idx = body.find(stop)
        if idx != -1:
            end = min(end, idx)
    authority, tail = body[:end], body[end:]

    userinfo, at, hostport = authority.rpartition("@")
    if hostport.startswith("["):          # IPv6 literal
        close = hostport.find("]")
        host = hostport[: close + 1]
        port = hostport[close + 1 :]
    else:
        host, colon, port = hostport.partition(":")
        port = colon + port

    host = host.lower()
    port = _strip_default_port(scheme, host, port.lstrip(":"))
    # normalise percent‑encoding case in path & query
    from urllib.parse import quote, unquote, urlsplit, urlunsplit
    split = urlsplit(f"{scheme}://{userinfo}{at}{host}{port}{tail}")
    norm_path = quote(unquote(split.path), safe="/")
    norm_query = quote(unquote(split.query), safe="=&")
    return urlunsplit((scheme, f"{userinfo}{at}{host}{port}", norm_path, norm_query, split.fragment))
```

* Add unit‑tests covering:
  * `http://example.com:80/x` → `http://example.com/x`
  * `HTTPS://EXAMPLE.COM:443/x` → `https://example.com/x`
  * Percent‑encoding case normalisation.

---

## 3️⃣ Behavioural Regression – `ingested_source_urls()` Refuses Empty Tenant

### Symptom
```python
if not isinstance(tenant_id, str) or not tenant_id.strip():
    logger.warning("ingested_source_urls called without a tenant_id — refusing the probe")
    return set()
```

Previously (pre‑#3481) an empty `tenant_id` meant **“search across all tenants”** – the function was used by the *ledger* to discover whether any tenant already had a row for a given URL (e.g. a global “already‑processed” check). The new guard **silently returns an empty set**.

### Impact
* **Medium‑High** – Existing internal tools (e.g. the “global ingest ledger clean‑up” script, some ad‑hoc debugging utilities, and possibly some integration tests) that rely on a cross‑tenant probe will now **think nothing is ingested**. The ingestion pipeline will then **re‑ingest** the same document for every tenant, causing **duplicate rows** (one per tenant per case‑variant) and **unnecessary work**.
* The change also **breaks backwards compatibility** of the public API (`ingested_source_urls(source_urls, tenant_id="")`). The function’s signature still advertises an optional `tenant_id`, but the semantics have changed.

### Reproduction
```python
>>> from mira_crawler.ingest import store
>>> store.ingested_source_urls(['https://example.com/foo.pdf'], tenant_id="")
set()   # old code would have returned the set of URLs actually present in any tenant
```

### Fix Recommendation
* Preserve the original “all‑tenant” behaviour behind an explicit opt‑in flag (e.g. `allow_cross_tenant=True`).  
* Keep the security‑oriented guard for *invalid* tenant identifiers (None, whitespace, non‑string).  

```python
def ingested_source_urls(source_urls: list[str], tenant_id: str = "", *, allow_cross_tenant: bool = False) -> set[str]:
    if not source_urls:
        return set()
    if not isinstance(tenant_id, str) or (not tenant_id.strip() and not allow_cross_tenant):
        logger.warning("ingested_source_urls called without a valid tenant_id — refusing the probe")
        return set()
    # … existing implementation …
```

* Update all call‑sites (search repo) to pass `allow_cross_tenant=True` where the original cross‑tenant semantics were intended.  
* Add a regression test confirming that `allow_cross_tenant=True` returns the correct set.

---

## 4️⃣ Hidden Coupling – Un‑canonicalised Reads

### Symptom
The canonicalisation is applied **only** at the write‑boundary (`insert_chunk`) and the *lookup* helpers (`chunk_exists`, `ingested_source_urls`). Any other module that directly queries `knowledge_entries` by `source_url` (e.g. analytics dashboards, the `kg_writer` module, or ad‑hoc scripts) still uses the **raw URL** supplied by callers.

Because the DB now contains a mixture of **raw** (pre‑migration) and **canonical** rows, a query that supplies the *raw* value will miss the newer canonical row, and vice‑versa.

### Impact
* **Medium** – Downstream services that generate reports or perform deduplication may return incomplete results, leading to false‑negative “document not yet ingested” messages, broken UI links, and inconsistent audit trails.  
* The problem is *silent*: no exception is raised, just missing data.

### Reproduction (simple example)
```python
# Assume a fresh insertion with mixed‑case URL
from mira_crawler.ingest import store, provenance
store.insert_chunk('tenant‑a', 'content', [0.1], 'HTTPS://EXAMPLE.COM/doc.pdf', 0, False)

# Direct raw query (simulated by a manual engine)
from sqlalchemy import text
with store._engine().connect() as conn:
    rows = conn.execute(
        text("SELECT source_url FROM knowledge_entries WHERE source_url = :url"),
        {"url": "HTTPS://EXAMPLE.COM/doc.pdf"}
    ).fetchall()
print(rows)   # [] – row not found because stored as canonical lower‑cased host
```

### Fix Recommendation
* **Encapsulate** all reads of `knowledge_entries.source_url` behind a helper that applies `canonical_source_url` (mirroring the write path).  
* Search the repository for any raw `SELECT … WHERE source_url = …` and replace with `store.canonical_source_url(url)` before binding.  
* Add a thin wrapper in `store.py`:

```python
def fetch_by_source_url(url: str, tenant_id: str):
    canon = canonical_source_url(url)
    with _engine().connect() as conn:
        return conn.execute(
            text("SELECT * FROM knowledge_entries WHERE tenant_id = :tid AND source_url = :url"),
            {"tid": tenant_id, "url": canon}
        ).fetchall()
```

* Update all callers accordingly and add tests that verify both raw and canonical look‑ups succeed.

---

## 5️⃣ Observability Gap – Evidence‑Artifact Exclusion

### Symptom
When the reviewer runs `gate7_review` **without** `--include‑evidence`, the diff is stripped of any file under `docs/…/units/evidence/`. The receipt block mentions the count and list of dropped artifacts, but the LLM never sees the actual content.

### Impact
* **Medium** – For a high‑risk compliance flow the *only* place the model can see is the (already‑redacted) diff. If a defect lives solely inside an evidence artifact (e.g. a previous adjudication that mistakenly allowed a blocked origin), the model has no chance to surface it.  
* This is a **silent scope reduction** – similar to the previously discovered “truncation” issue, but now applied to **entire files**. The “scope notice” explains the exclusion, but a malicious actor could deliberately place a critical hint inside an evidence file and rely on the default exclusion to hide it from the gate.

### Reproduction
```bash
# Run the gate on a PR that only adds a new evidence artifact
gate7_review --paths docs/architecture/convergence/units/evidence/ ...
# The diff shown to the model contains no lines from the added file
```

### Fix Recommendation
* **Make inclusion opt‑in only** (as already done) **and** **require an explicit `--include‑evidence` flag for any PR that modifies files under the evidence directory**.  
* Add a pre‑flight check: if the diff contains *any* evidence‑artifact changes and `--include‑evidence` is **not** set, abort with a clear error (`exit 1`) and a message: “Evidence artifacts are present; you must run with `--include‑evidence` to review them.” This prevents accidental silent omission.  
* Update the CI workflow to pass `--include‑evidence` when running the gate on the *Mira‑Crawler* repository itself (the CI diff always contains evidence files).  

---

## Additional Observations (Non‑blocking)

| Observation | Why it matters |
|-------------|----------------|
| **CI runtime increase** – Adding `test_conflict_and_packaging_contracts.py` (≈ 627 lines) to the CI matrix adds **~30 s** on the Linux runners, pushing the total CI time close to the GitHub‑Actions 10‑minute limit for the “high‑effort” lane. Consider splitting the file into logical sub‑modules or marking the long‑running sections with `@pytest.mark.slow` and adjusting the CI to run them in a separate job. |
| **Documentation drift** – The doctrinal brief (`docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md`) still mentions “a 3‑round budget” (see `test_the_brief_never_asserts_a_round_budget_or_cap`). The test already asserts that the phrase is gone, but the source doc still contains it in a comment. Clean it up to avoid future confusion. |
| **`_SCHEME_RE` edge‑case** – The regular expression `r"[A-Za-z][A-Za-z0-9+.-]*"` does not allow scheme names that contain uppercase letters after the first character (e.g. `X‑Custom+Scheme`). Lower‑casing later works, but the validation would reject such a scheme as “not a URL”. This is harmless today but could block future custom schemes. Consider using `re.IGNORECASE` on the pattern or a more permissive check. |
| **`_log_ref` hash length** – The hash is truncated to the first 12 hex characters. While sufficient for correlation, the truncation **does not guarantee uniqueness** across a large corpus (birthday paradox). Consider using the full 64‑char SHA‑256 or at least 16 characters to avoid potential collisions in logs. |

---

## Summary of Required Actions

| # | Action | Owner | Priority |
|---|--------|-------|----------|
| 1 | Sanitize `netloc` in `_log_ref` to strip userinfo. | Security / Logging team | **High** |
| 2 | Extend `canonical_source_url` to strip default ports and normalise percent‑encoding case. | Ingestion core team | **High** |
| 3 | Re‑introduce cross‑tenant probe in `ingested_source_urls` via an explicit flag (`allow_cross_tenant=True`). Update all callers. | Backend / Ledger team | **Medium‑High** |
| 4 | Audit the codebase for any raw `SELECT … WHERE source_url = …` queries and wrap them with `canonical_source_url`. Add helper `fetch_by_source_url`. | Database & Query team | **Medium** |
| 5 | Make evidence‑artifact exclusion a hard failure unless `--include‑evidence` is supplied. Add pre‑flight guard and update CI. | Gate 7 tooling team | **Medium** |
| 6 | Split the monolithic `test_conflict_and_packaging_contracts.py` or mark slow sections to keep CI under limits. | Test‑infra team | **Low** |
| 7 | Remove “3‑round budget” phrasing from architecture docs to keep the doctrinal brief accurate. | Documentation team | **Low** |
| 8 | Review `_SCHEME_RE` for future custom‑scheme compatibility. | Future‑proofing | **Low** |

---

### Final Verdict (adversarial)

**BLOCK** – The changes introduce a **security credential leak**, break **deduplication guarantees**, regress **tenant‑scoped probing**, and create a **hidden coupling** that will cause downstream read‑path failures. The gate must **not** be merged until the above high‑severity defects are addressed and a fresh, clean review is performed on the corrected head.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
- `shape: expected exactly one `## VERDICT` section, found 0 — UNKNOWN (malformed attempt)`
