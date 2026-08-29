# Gate 7 adversarial review — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, security boundaries, cross-repository contract, deletion/destructive, concurrency/idempotency/state, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `9212d2b48652f72fb02ada3853c28bccff3be2ce`
- scope (--paths): docs/
- excluded by scope (9): .github/workflows/ci.yml, mira-crawler/ingest/origins.py, mira-crawler/ingest/store.py, mira-crawler/tests/test_conflict_and_packaging_contracts.py, mira-crawler/tests/test_ingest.py, mira-crawler/tests/test_provenance_policy.py, tests/test_gate7_review.py, tools/gate7_review.py, tools/qa/security/knowledge_entries_read_allowlist.yml
- diff chars sent/total: 76,489/76,489 (cap 150,000)
- reviewed-diff sha256 (sent bytes): `6b6e1577e95fbfe5c2d86d4dba5b95b3de19e16eb02f7fc0ffcef76706ecdb95`
- full scoped-diff sha256 (pre-cap): `6b6e1577e95fbfe5c2d86d4dba5b95b3de19e16eb02f7fc0ffcef76706ecdb95`
- requested reasoning_effort: high (see Cascade attempts for what was sent)
- evidence artifacts excluded from review (raw reviewer output / logs under units/evidence/, not author claims; --include-evidence keeps them) (71): docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-code-explain-pg16.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log

## Findings

- **[high] Inclusion of `.log` in documentation suffixes creates a data‑leak risk** — 
- **[high] `is_evidence_artifact` incorrectly excludes all files under `units/evidence/` from review** — 
- **[high] Parser regression – malformed findings/rulings are now silently ignored** — 
- **[medium] `canonical_source_url` does not normalise default ports, enabling duplicate rows** — 

## Raw review

## VERDICT
**BLOCK**

## FINDINGS

- **[severity: high] Inclusion of `.log` in documentation suffixes creates a data‑leak risk**  
  *File:* `tools/gate7_review.py`  
  *Trigger:* Any `.log` file that is part of the PR diff (e.g., `tools/qa/security/knowledge_entries_read_allowlist.yml` or CI logs) will be classified as documentation and therefore excluded from the redaction step. Because the Gate 7 pipeline sends the (redacted) diff to an external LLM, logs that contain secrets could be transmitted unredacted.  
  *Diff quote:*  
  ```diff
  ++_DOC_SUFFIXES = (".md", ".markdown", ".rst", ".txt", ".log")
  ```

- **[severity: high] `is_evidence_artifact` incorrectly excludes all files under `units/evidence/` from review**  
  *File:* `tools/gate7_review.py`  
  *Trigger:* An attacker can add a malicious script such as `units/evidence/malicious.py`. The function treats any path under `units/evidence/` as a “preserved review artifact” and skips it, allowing arbitrary code to bypass Gate 7 checks.  
  *Diff quote:*  
  ```diff
  ++def is_evidence_artifact(path: str) -> bool:
  ++    """A preserved review artifact: a file under units/evidence/ that is raw
  ++    reviewer/adjudicator output or a lane log — NOT the author-written index
  ++    (README.md) and NOT a rebuttal.
  ```

- **[severity: high] Parser regression – malformed findings/rulings are now silently ignored**  
  *File:* `tools/gate7_review.py`  
  *Trigger:* The updated parser accepts heading‑only findings (`### 1. **[severity: X] …`) and bare rulings (`REFUTED` without an ID). A high‑severity finding emitted without a stable ID or proper severity will be parsed as *UNKNOWN* and will not cause a BLOCK, letting an adversarial model hide critical defects.  
  *Diff quote (documentation of the change):*  
  ```diff
  ++parse_findings now accepts the heading form (`### 1. **[severity: X] T**`) …
  ++parse_rulings accepts the bare `F<n> SUSTAINED|REFUTED` form …
  ```

- **[severity: medium] `canonical_source_url` does not normalise default ports, enabling duplicate rows**  
  *File:* `mira-crawler/ingest/store.py`  
  *Trigger:* Ingesting both `http://example.com` and `http://example.com:80` creates two distinct dedup keys because the function only lower‑cases scheme and host, leaving the port unchanged. This can produce a public and a private row for the same logical origin, leaking private content.  
  *Diff quote:*  
  ```diff
  ++def canonical_source_url(url: str) -> str:
  ++    ...
  ++    source_url = canonical_source_url(source_url)
  ++    AND (source_url = :url OR source_url = :raw)
  ```

## NOT REVIEWED
The added unit tests exercise the new lower‑casing of the scheme and host and the new `test_uppercase_scheme_unclassified_origin_is_refused_and_forced_private` case, but they do **not** cover:

* Normalisation of default ports or IPv6 literals in `canonical_source_url`.  
* Scenarios where `.log` files contain secrets that should be redacted before being sent to the LLM.  
* The behaviour of the permissive parser when it receives malformed high‑severity findings (i.e., whether such findings are truly ignored).  

These gaps mean the current test suite cannot guarantee that the introduced changes are safe with respect to secret leakage, duplicate‑row privacy, or parser‑based bypasses.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
