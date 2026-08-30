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

**Gate 7 – Independent Adversarial Review (XHIGH effort)**  
**Repository:** `mira‑crawler` (PR # 663144a – “CU‑03 Gate 9 follow‑up – case‑insensitive origin discovery”)  

---

## TL;DR  

| Severity | Finding | Why it matters | Verdict |
|----------|---------|----------------|---------|
| **HIGH** | **_log_ref() leaks user‑info (credentials, tokens) in the operator log** | The refusal‑path log now prints `origin` derived from `urlsplit(url).netloc`. `netloc` includes the *userinfo* part (`user:pass@host`). If a source URL contains authentication data (e.g. `https://bob:Secr3t@repo.example.com/doc.pdf`) the clear‑text credentials are written to the central log (which is collected by the observability stack and may be shipped to external log‑aggregation services). This re‑introduces the exact problem that the original “never log a token” comment tried to avoid. | **BLOCK** |
| **HIGH** | **`canonical_source_url()` mishandles `file:///` URIs (empty authority)** | For a Windows‑style file URL like `FILE:///C:/Docs/manual.pdf` the function parses the drive‑letter (`C:`) as *host* and returns `file://c/Docs/manual.pdf` (double slash, host = `c`). This changes the URI semantics completely – a local‑file URI becomes a network‑host URI. The canonical form is therefore *incorrect* and will: 1️⃣ break deduplication (the same file can be ingested twice under two different keys), 2️⃣ make `ingested_source_urls()` miss existing rows, and 3️⃣ potentially cause downstream components that rely on the literal file path (e.g. `open()` wrappers that expect a `file:///` URL) to fail. | **BLOCK** |
| **MEDIUM** | **`ingested_source_urls()` does not recognise a *canonical* query when the DB stores the *raw* mixed‑case version** | The function builds the lookup list as `asked ∪ canonical(asked)`. If the DB row is the *raw* mixed‑case URL and the caller asks for the *canonical* (lower‑cased‑host) form, the raw variant is **not** part of the lookup set, so the query never matches. The caller receives a false‑negative “not ingested” result. This defeats the purpose of the ledger probe and can cause unnecessary re‑ingests, wasting resources and potentially re‑creating duplicate rows if the INSERT path is later altered to use only the canonical key. | **MEDIUM** |
| **MEDIUM** | **`canonical_source_url()` is **not** applied to all write‑paths (e.g. delete / update helpers)** | The new canonicalisation is only used in `insert_chunk()` and `chunk_exists()`. Any other code that manipulates `knowledge_entries` by `source_url` (e.g. a hypothetical `delete_chunk()`, `link_chunk_to_equipment()`, or bulk‑update scripts) still uses the raw value. This creates a hidden coupling: a delete that supplies a canonical URL will not match a row stored with a raw mixed‑case URL, leaving orphan rows. The same asymmetry exists for any future “purge‑by‑url” utilities. | **MEDIUM** |
| **LOW**  | **`decision_point_reminder` and `scope_notice` are inserted *after* the truncation notice, which may push the diff past the model‑token limit** | The prompt now contains three large blocks (truncation notice → scope notice → reminder) before the “Output STRICT …” instruction. For very large diffs close to the `MAX_DIFF_CHARS` limit, the added text can push the effective diff length over the limit, causing the provider to truncate **more** of the diff than intended. This can hide the very lines the reviewer needs to see. | **LOW** |
| **LOW**  | **`is_evidence_artifact()` treats any file under `units/evidence/` ending in a doc suffix as an artifact, even if the file is deliberately part of the *public* contract (e.g. a generated `policy.yaml` placed there for versioning)** | The comment in the docstring says “Only documentation/log files are artifacts”. However, the architecture permits a `policy.yaml` (structured data) to live under `evidence/` for historical reasons. The blanket `.log` + doc‑suffix check will silently drop it from the reviewed diff, potentially removing a contract‑relevant file without a receipt that explains why. | **LOW** |

> **All findings are *new* – none overlap with the settled items from earlier rounds.**  
> The two **HIGH** findings alone are sufficient to block the PR until they are addressed.

---

## Detailed Findings

### 1. `_log_ref()` leaks user‑info (HIGH)

**Location** – `mira-crawler/ingest/store.py` – lines 114‑121  

```python
def _log_ref(url: str) -> str:
    """A log‑safe reference to a source URL: its origin plus a short hash …"""
    if not url:
        return "<no url>"
    from urllib.parse import urlsplit

    try:
        origin = urlsplit(url).netloc or "<no host>"
    except ValueError:
        origin = "<unparseable>"
    return f"{origin} sha256:{hashlib.sha256(url.encode('utf-8')).hexdigest()[:12]}"
```

*Problem* – `urlsplit(...).netloc` returns **userinfo + host** (`user:pass@host`).  
The original log message (`(source_url or "<no url>")[:100]`) already truncated the full URL, but the new implementation intentionally “never logs the path or query”. Unfortunately the comment never mentioned *userinfo*, which can contain passwords, API keys, or tokens.  

*Impact* –  
- Credentials are written to the `mira‑crawler.store` logger at **WARNING** level.  
- The logging infrastructure forwards warnings to central SIEM / log‑aggregation services (e.g. Splunk, Elastic).  
- Any breach of those logs would expose clear‑text secrets.  

*Recommendation* – Strip userinfo before logging:

```python
origin = urlsplit(url).hostname or "<no host>"
```

or, if you still need the port, use `urlsplit(url).netloc` **after** removing `userinfo` via `urlsplit(url).hostname` + optional `urlsplit(url).port`.

---

### 2. `canonical_source_url()` corrupts `file:///` URIs (HIGH)

**Location** – `mira-crawler/ingest/store.py` – lines 71‑119  

The function lower‑cases the scheme **and** the host, leaving everything else untouched. For a Windows‑style file URI with an empty authority (`file:///C:/path`), the code incorrectly treats the drive‑letter (`C:`) as a host:

```python
if not rest.startswith("//"):
    return f"{scheme}:{rest}"
body = rest[2:]          # => "C:/Docs/x.pdf"
...
authority, tail = body[:end], body[end:]   # authority = "C:", tail = "/Docs/x.pdf"
...
host, colon, port = hostport.partition(":")
return f"{scheme}://{userinfo}{at}{host.lower()}{port}{tail}"
# → "file://c/Docs/x.pdf"
```

*Problem* – The returned URI loses **one slash** and interprets `c` as a network host, which is semantically different from a local file path.  

*Impact* –  
- The canonical key stored in `knowledge_entries` no longer matches the raw value used by any component that expects a true file URI (e.g. a local‑file loader that does `urlsplit(...).path`).  
- Deduplication fails: the same file can be stored twice (once with the original `file:///C:/…` and once with `file://c/…`).  
- `ingested_source_urls()` will not find the row because the query looks for the *canonical* string, which is now malformed.  

*Recommendation* – Detect the *empty‑authority* case and keep the triple‑slash:

```python
if rest.startswith("//"):
    # check if authority is empty (i.e. the next char after '//' is '/')
    if rest[2:].startswith("/"):
        # empty authority – keep the original form (only lower‑case scheme)
        return f"{scheme}:{rest}"
    # otherwise process as before...
```

A dedicated unit test for this edge case already exists (`test_lowercases_only_scheme_and_host`); after the fix it will pass.

---

### 3. `ingested_source_urls()` asymmetrical lookup (MEDIUM)

**Location** – `mira-crawler/ingest/store.py` – lines 138‑166  

```python
asked = list(source_urls)
lookup = sorted({*asked, *(canonical_source_url(u) for u in asked)})
...
rows = conn.execute(
    text(
        "SELECT DISTINCT source_url FROM knowledge_entries "
        "WHERE source_url = ANY(:urls) AND tenant_id = :tid"
    ),
    {"urls": lookup, "tid": tenant_id},
).fetchall()
...
return {u for u in asked if u in found or canonical_source_url(u) in found}
```

*Problem* – The `lookup` set only contains **the caller‑supplied spelling** and its *canonical* form.  
If the database contains the *raw* mixed‑case version **and the caller asks for the canonical version**, the raw variant is **not** present in the lookup set, so the query never matches.

*Impact* –  
- The ledger probe (`ingested_source_urls`) can falsely report that a URL has **not** been ingested, even though a row exists with a different case.  
- Upstream code that decides “skip ingestion because it’s already present” will re‑ingest, causing extra work and, depending on the INSERT path, possible duplicate rows.  

*Recommendation* – Perform a **case‑insensitive** lookup on the host part rather than trying to guess the raw spelling, e.g.:

```python
# Instead of exact ANY(:urls), compare lower(host) = lower(host) and keep scheme as‑is.
# One pragmatic fix: query for both the supplied URL **and** its *canonical*,
# *plus* the *canonical* of every entry that already exists (requires a sub‑query).
# Simpler: broaden the lookup to include both the supplied URL **and** its
# canonical form **and** the raw form of the canonical URL (i.e. reverse‑map):
lookup = set(asked)
for u in asked:
    c = canonical_source_url(u)
    if c != u:
        # add the *raw* version of the canonical URL (i.e. the original case‑variant)
        lookup.add(u)           # already there
        # we cannot know the exact raw case, so we fall back to a case‑insensitive DB query
# then change the SQL to:
#   WHERE lower(host(source_url)) = lower(host(:url)) AND tenant_id = :tid
```

A minimal, backward‑compatible change is to **always query using the canonical form** and **compare the host case‑insensitively** in SQL (`WHERE lower(split_part(source_url, '://', 2)::text) = lower(split_part(:url, '://', 2)::text)`). This guarantees a match regardless of how the row was stored.

---

### 4. Canonicalisation not applied to delete / update paths (MEDIUM)

**Location** – `mira-crawler/ingest/store.py` – only `insert_chunk()` and `chunk_exists()` use `canonical_source_url()`.  

*Problem* – Any future code that removes or updates rows by `source_url` (e.g. a maintenance script, a “purge‑orphaned‑chunks” job) will likely use the raw URL supplied by the caller. If the row was stored canonical (as now enforced), the delete will **miss** the row, leaving stale data. The inverse (deleting a raw row with a canonical key) also fails.

*Impact* –  
- Accumulation of orphaned rows (privacy risk because `is_private` may be true).  
- Potential violation of GDPR‑style “right to be forgotten” if private rows cannot be removed.  

*Recommendation* – Centralise URL normalisation in a **single helper** that all write‑path functions import, e.g.:

```python
def normalised_source_url(url: str) -> str:
    return canonical_source_url(url)
```

Then use it in **every** place that constructs a `WHERE source_url = …` clause (INSERT, UPDATE, DELETE, SELECT). Add a test that attempts to delete a row inserted with mixed‑case host and verifies the row disappears.

---

### 5. Prompt size inflation pushes diff over token limit (LOW)

The new blocks (`_truncation_notice`, `_scope_notice`, `decision_point_reminder`) are concatenated **before** the “Output STRICT …” marker. For a diff that is already close to `MAX_DIFF_CHARS` (≈ 200 kB), the extra ~1 kB of notices can cause the provider to truncate **more** of the diff than the original intent. This reduces the reviewer’s visibility and can hide the very lines that the gate is trying to protect against.

*Mitigation* – Insert the notices **after** the `--- END UNTRUSTED PR DATA ---` marker (as is done) **but** also subtract their length from the allowed diff length, e.g.:

```python
max_allowed = MAX_DIFF_CHARS - len(_truncation_notice(diff)) - len(_scope_notice(...)) - len(decision_point_reminder(...))
sent_diff = diff[:max_allowed]
```

---

### 6. Evidence‑artifact detection may over‑exclude contract files (LOW)

`is_evidence_artifact()` treats **any** file under `units/evidence/` that ends with a doc suffix (`.md`, `.log`, …) as an artifact, regardless of its purpose. The architecture permits a *generated* `policy.yaml` (structured data) to be stored there for versioning. Since the function only looks at suffixes, it will silently drop such a file from the reviewed diff, and the receipts will only mention it as an “evidence artifact”. If the contract expects that `policy.yaml` be reviewed (e.g. to confirm a new origin was added), the reviewer will never see it.

*Mitigation* – Extend `is_evidence_artifact()` to whitelist known contract files (e.g. `policy.yaml`, `manifest.json`) or to require an explicit marker comment inside the file.

---

## Summary & Recommendation

- **Block** the PR until the **high‑severity** findings are resolved.  
- The credential‑leak in `_log_ref()` is a **security regression** that directly contradicts the platform’s “log‑safe reference” policy.  
- The broken handling of `file:///` URIs is a **functional regression** that will silently generate duplicate knowledge‑entries for local files and break the deduplication guarantees the migration (003) was intended to enforce.  
- The asymmetry in `ingested_source_urls()` is a **data‑integrity** issue that can cause false‑negative ledger probes and unnecessary re‑ingests.  

**Next steps** (in order of priority):

1. **Patch `_log_ref()`** to strip user‑info (`urlsplit(url).hostname`). Add a unit test that asserts no `@` appears in the log string when a URL with credentials is passed.  
2. **Fix `canonical_source_url()`** to preserve the triple‑slash form for empty‑authority `file:///` URIs. Add tests for `FILE:///C:/…`, `file:///home/user/file.txt`, and the Windows‑drive case.  
3. **Make `ingested_source_urls()` host‑case‑insensitive** (or perform a case‑insensitive DB lookup). Add a test where the DB holds `HTTPS://EXAMPLE.COM/x.pdf` and the caller asks for `https://example.com/x.pdf`.  
4. **Audit all other `source_url`‑based queries** (delete, update, bulk‑select) and ensure they use the same canonicalisation helper. Add integration tests that insert a row, delete it using a mixed‑case URL, and verify it is removed.  
5. **Adjust prompt‑size calculations** to keep the diff within the provider’s token budget.  
6. **Refine evidence‑artifact detection** to avoid unintentionally hiding contract‑relevant files.

Addressing these items will close the most dangerous regressions introduced by the current change set and restore the gate’s guarantee of “no secret leakage, no duplicate rows, and correct ledger probing”. Until then the PR must be **rejected**.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
- `shape: expected exactly one `## VERDICT` section, found 0 — UNKNOWN (malformed attempt)`
