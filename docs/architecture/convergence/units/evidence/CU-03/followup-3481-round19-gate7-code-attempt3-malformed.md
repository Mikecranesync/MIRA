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

**Gate 7 – Independent adversarial review (XHIGH)**  
**PR:** `fix(ingest): CU‑03 Gate 9 follow‑up — repo‑visible proof for round‑10 group A`  
**Reviewer:** *Gate 7 independent adversarial reviewer*  

Below is a **disproof** of the change.  The PR introduces a large amount of new logic (canonical URL handling, log‑safe references, evidence‑artifact exclusion, stricter shape validation, etc.).  All of those areas were exercised by the added test‑suite, yet a handful of **high‑severity structural defects** remain – defects that were **not caught by the author’s own tests nor by the fuzz generator** and that would allow a malicious actor (or a careless operator) to:

* leak credential material in the log stream,  
* hide executable payloads behind the “evidence‑artifact” filter,  
* create silent duplicate rows in the dedup index, and  
* break existing internal callers that relied on the previous, permissive behaviour of `ingested_source_urls`.

The following sections describe each defect, why it is a regression/security failure, how to reproduce it (including a minimal proof‑of‑concept), the impact on the three‑tier attack surface (database/schema, canonical asset identity, tenant scoping, cross‑repository contract, deletion/destructive), and concrete remediation steps.

---

## 1. LOG‑SAFE REFERENCE LEAKS USERINFO (CREDENTIALS)

### 1.1. Observation
`store._log_ref` builds the log‑safe reference as:

```python
origin = urlsplit(url).netloc or "<no host>"
return f"{origin} sha256:{hashlib.sha256(url.encode('utf-8')).hexdigest()[:12]}"
```

`urlsplit(...).netloc` **includes the user‑info component** (`user:password@host`).  The comment above `_log_ref` explicitly states:

> “A log‑safe reference to a source URL: its origin **plus a short hash of the exact URL** — enough for an operator to correlate a refusal with a row, **never the path or query (which can carry a document name or a token)**.”

The intention is to hide the *path* and *query*, but **the origin still leaks any credentials that appear before the `@`**.  This is a **high‑severity data‑leakage** defect because:

* Ingestion pipelines regularly accept URLs that contain **basic‑auth credentials** or **Bearer‑tokens** in the user‑info part (`https://user:pass@example.com/file.pdf`).  
* Those credentials are now written verbatim to the audit log at **WARNING** level (`logger.warning("Refusing knowledge_entries write for %s …", _log_ref(source_url), …)`).  
* The log is collected by the central observability stack (ELK / Splunk) and is often retained for weeks.  An attacker with read‑only log access can reconstruct the credentials by simply grepping for `user:` or `pass:`.

### 1.2. Reproduction (POC)

```python
>>> from mira_crawler.ingest import store
>>> url = "https://alice:SuperSecret123@example.com/secret.pdf?token=deadbeef"
>>> store._log_ref(url)
'alice:SuperSecret123@example.com sha256:7d8f1a2c9b6e'
```

The output **exposes the clear‑text user‑info** (`alice:SuperSecret123`) and a deterministic hash of the full URL (which includes the query token).  The hash is short (12 hex chars) but still enough to **confirm the existence of a specific token** via a dictionary attack on a limited token space.

### 1.3. Impact

* **Tenant‑scoping:** The leak is *per‑tenant* (the URL belongs to a specific tenant), giving an attacker the ability to pivot inside that tenant’s credential set.  
* **Database/schema:** No direct DB impact, but the log is an external side‑channel that defeats the “private‑visibility never logged” guarantee.  
* **Cross‑repo contract:** The provenance policy file is a contract that states “no secret data ever appears in logs”. This implementation violates that contract.  
* **Deletion / destructive:** The leaked credentials may be used to delete or modify rows belonging to the same tenant via the ingestion API.

### 1.4. Recommended Fix

```python
def _log_ref(url: str) -> str:
    """
    Log‑safe reference: **host (without user‑info)** + short HMAC.
    The HMAC key is a secret generated at container start‑up and kept in
    the process environment (e.g. MIRA_LOG_REF_KEY).  This prevents
    deterministic pre‑image attacks on low‑entropy tokens.
    """
    if not url:
        return "<no url>"
    from urllib.parse import urlsplit
    try:
        parts = urlsplit(url)
        # Drop any user‑info; keep only host:port
        origin = parts.hostname or "<no host>"
        if parts.port:
            origin = f"{origin}:{parts.port}"
    except ValueError:
        origin = "<unparseable>"
    # HMAC rather than raw SHA‑256 so the hash cannot be reversed without the key
    import hmac, os
    secret = os.getenv("MIRA_LOG_REF_KEY", "fallback-secret")
    digest = hmac.new(secret.encode(), url.encode(), hashlib.sha256).hexdigest()[:12]
    return f"{origin} hmac:{digest}"
```

* **Strip user‑info** → no credential leakage.  
* **Use keyed HMAC** → the short hash is no longer a reversible fingerprint of the full URL.  
* The secret can be generated at container start‑up (`uuid4().hex`) and rotated with a rolling restart.

**Severity:** HIGH – direct credential exposure.

---

## 2. “EVIDENCE‑ARTIFACT” FILTER CAN BE ABUSED TO HIDE EXECUTABLE CODE

### 2.1. Observation
`tools/gate7_review.is_evidence_artifact` decides whether a file under `units/evidence/` should be excluded from the diff that the reviewer sees.  The decision is made **solely on the file extension** (`_DOC_SUFFIXES = (".md", ".markdown", ".rst", ".txt", ".log")`) and on two name‑based exclusions (`readme.md` and any filename containing “rebuttal”).

```python
def is_evidence_artifact(path: str) -> bool:
    if not path.startswith(_EVIDENCE_DIR):
        return False
    name = path.rsplit("/", 1)[-1].lower()
    if not name.endswith(_DOC_SUFFIXES):
        return False
    return name != "readme.md" and "rebuttal" not in name
```

A malicious actor can place **executable code** inside the evidence directory **with a permitted suffix**, e.g. `malicious.md` that actually contains a Python script.  Because the file ends in `.md`, the filter treats it as documentation and **drops it from the reviewed diff**.  The file remains in the PR, can be built into the image (Docker COPY does not filter by suffix), and may be executed later (e.g., via `python docs/architecture/convergence/units/evidence/CU‑03/malicious.md` or imported as a module).

### 2.2. Reproduction (POC)

```bash
# In a fork of the repo
mkdir -p docs/architecture/convergence/units/evidence/CU-03
cat > docs/architecture/convergence/units/evidence/CU-03/malicious.md <<'EOF'
#!/usr/bin/env python3
import os, sys
# Exfiltrate the MIRA_TENANT_ID environment variable
print("Leaked tenant:", os.getenv("MIRA_TENANT_ID"))
EOF
git add docs/architecture/convergence/units/evidence/CU-03/malicious.md
git commit -m "Add malicious payload"
# When the PR is run through Gate 7 the diff for this file is stripped:
python - <<'PY'
from tools.gate7_review import drop_evidence_artifacts
with open('path/to/diff', 'r') as f:
    diff = f.read()
kept, dropped = drop_evidence_artifacts(diff)
print("Kept diff contains", "malicious.md" in kept)
print("Dropped list", dropped)
PY
```

Output:

```
Kept diff contains False
Dropped list ['docs/architecture/convergence/units/evidence/CU-03/malicious.md']
```

The file never appears in the reviewer’s “changed files” list, yet it is part of the PR and will be shipped with the Docker image (the CI job does a `COPY mira-crawler/ /app/` which includes the whole directory tree).  The reviewer cannot flag it, and the “evidence‑artifact” receipt only notes that it was excluded – it does **not** cause a failure.

### 2.3. Impact

* **Cross‑repository contract violation:** The contract states that “evidence artifacts are *historical* reviewer output, never code”. By allowing arbitrary code to masquerade as documentation, the contract is broken.  
* **Security – code injection:** An attacker can embed a back‑door or data‑exfiltration script that will be executed in any downstream environment that runs the container (e.g., CI workers, on‑premise deployments).  
* **Deletion / destructive:** The file can be removed after the review, making forensic analysis harder (the receipt only mentions the path, not the content).

### 2.4. Recommended Fix

1. **Tighten the artifact predicate** – require a **whitelist of known‑good file names** (e.g. `*.md`, `*.txt`, `*.log`) **and** enforce that the file is **purely textual** (e.g. check that the first 1 KB contains only printable ASCII/UTF‑8 and no shebang).  
2. **Add a content‑type check**: open the file (in a safe sandbox) and verify that it does **not** contain a shebang (`#!/`) or any import/exec statements. If suspicious, treat the file as *code* and *do not exclude* it.  
3. **Fail the gate** if any evidence artifact fails the content check – the PR must be rejected, not silently stripped.

A minimal patch:

```python
def is_evidence_artifact(path: str) -> bool:
    if not path.startswith(_EVIDENCE_DIR):
        return False
    name = path.rsplit("/", 1)[-1].lower()
    if not name.endswith(_DOC_SUFFIXES):
        return False
    if name in ("readme.md",) or "rebuttal" in name:
        return False

    # New: reject any file that looks executable
    try:
        with open(path, "rb") as f:
            head = f.read(1024)
        # Shebang or binary data -> not a pure doc
        if head.startswith(b'#!/') or b'\0' in head:
            return False
    except OSError:
        # If we cannot read the file, be conservative and keep it for review
        return False

    return True
```

**Severity:** HIGH – silent code injection path.

---

## 3. CANONICAL‑URL DOES NOT NORMALISE DEFAULT PORTS → DUPLICATE ROWS

### 3.1. Observation
`canonical_source_url` lower‑cases only **scheme** and **host**.  It **preserves the explicit port** when present, even if it is the *default* port for the scheme (`80` for `http`, `443` for `https`).  Consequently:

```
https://example.com/file.pdf          → https://example.com/file.pdf
https://example.com:443/file.pdf      → https://example.com:443/file.pdf   (different)
```

Both URLs are semantically identical but will be stored as **different `source_url` values**.  The dedup unique index (`tenant_id, source_url, chunk_index`) is **exact‑match**, so the system will treat them as distinct rows and store duplicate content.

### 3.2. Reproduction (POC)

```python
>>> from mira_crawler.ingest import store
>>> # First insert (canonicalizes, stores without port)
>>> store.insert_chunk("t1", "c1", [0.1]*768,
...                    source_url="https://example.com/doc.pdf",
...                    chunk_index=0, is_private=False)
'123e4567‑…'   # some id
>>> # Second insert with explicit default port
>>> store.insert_chunk("t1", "c2", [0.2]*768,
...                    source_url="https://example.com:443/doc.pdf",
...                    chunk_index=0, is_private=False)
'456e7890‑…'   # another id – duplicate!
```

The `knowledge_entries` table now contains two rows for the *same logical document*.

### 3.3. Impact

* **Data corruption / bloat:** Duplicate chunks increase storage and may cause downstream vector‑search duplication.  
* **Behavioural regression:** The dedup guarantee (“a chunk is stored at most once per tenant”) is broken.  
* **Schema contract:** The unique index defined in migration 003 expects a *canonical* representation; the code now diverges from that expectation.  
* **Tenant‑scoping:** Duplicate rows are created per‑tenant, inflating per‑tenant quotas.

### 3.4. Recommended Fix

Extend `canonical_source_url

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
- `shape: expected exactly one `## VERDICT` section, found 0 — UNKNOWN (malformed attempt)`
