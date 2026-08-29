# Gate 7 adversarial review — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, security boundaries, cross-repository contract, deletion/destructive, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `d8b000663bbf6e1470c0956226e851041a91128f`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (43): docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 55,931/55,931 (cap 60,000)
- reviewed-diff sha256 (sent bytes): `00884a28ad6e0d691195dd9b166f9b227cfdd73d6f2cac44d8db080449909ea4`
- full scoped-diff sha256 (pre-cap): `00884a28ad6e0d691195dd9b166f9b227cfdd73d6f2cac44d8db080449909ea4`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] Duplicate logical rows due to historic non‑canonical URLs** — 
- **[medium] Single‑letter scheme URLs are not canonicalised** — 
- **[medium] Percent‑encoding case is not normalised** — 
- **[high] Inclusion of “.log” in documentation suffixes leaks potentially sensitive logs to the LLM** — 
- **[medium] Decision‑point reminder text may push the diff over the model’s token limit, truncating critical changes** — 
- **[low] The new 554‑line test file (`test_conflict_and_packaging_contracts.py`) markedly increases CI runtime** — 
- **[medium] Packaging‑contract scanner only recognises `COPY` directives; it will miss valid `ADD` or multi‑stage `COPY` patterns** — 
- **[low] Non‑deterministic ordering of URL parameters in `ingested_source_urls`** — 

## Raw review

## VERDICT
BLOCK  

## FINDINGS
- **[severity: high] Duplicate logical rows due to historic non‑canonical URLs**  
  *File:* `mira-crawler/ingest/store.py`  
  *Lines:*  
  ```diff
  +def canonical_source_url(url: str) -> str:
  +    ...  # lower‑cases scheme and host only
  ```
  *Trigger:* A `knowledge_entries` row that was written **before** this PR contains a URL with mixed‑case scheme/host, e.g.  
  `source_url = "HTTPS://example.com/doc.pdf"` (raw case).  
  A later ingest of the same logical document supplies the same URL in canonical form (`"https://example.com/doc.pdf"`).  
  `insert_chunk` (line ≈ 140) lower‑cases the URL before the `INSERT`, while `chunk_exists` (line ≈ 90) also lower‑cases the lookup key. Because the historic row stores the *raw* URL, the lookup does **not** find it, the `INSERT` succeeds, and a second row is created. The unique index defined in migration 003 (`idx_ke_chunk_dedup`) is case‑sensitive, so the two rows coexist.  
  *Impact:*  
  - Breaks the dedup guarantee that a given `(tenant_id, source_url, chunk_index)` identifies at most one chunk.  
  - Allows the “private‑visibility” conflict contract (F1) to be bypassed: a private row can be duplicated as a public one under a different casing, exposing data that should remain private.  
  - Increases storage bloat and can cause downstream analytics to double‑count the same document.  
  *Why not caught:* The new test suite (`test_conflict_and_packaging_contracts.py`) simulates the *canonical* write path but never exercises a pre‑existing non‑canonical row; the fake engine does not enforce the unique index, so the duplicate‑row scenario is invisible to the tests.

- **[severity: medium] Single‑letter scheme URLs are not canonicalised**  
  *File:* `mira-crawler/ingest/store.py` – `canonical_source_url` implementation.  
  *Lines:*  
  ```python
  if not sep or len(head) < 2 or not _SCHEME_RE.fullmatch(head):
      return url  # not a URL (bare path, Windows drive letter) — untouched
  ```
  The `len(head) < 2` guard rejects any URL whose scheme is a single character (e.g. `x://example.com`). RFC 3986 permits one‑letter schemes, and such URLs are treated as *non‑canonical* by this function, leaving the scheme’s case unchanged.  
  *Trigger:* Ingest of a custom protocol URL like `X://service.local/resource`. The stored `source_url` retains the uppercase `X`, while a later ingest using the lowercase `x` will be canonicalised to `x://…` and will not match the existing row, creating a duplicate.  
  *Impact:* Same dedup‑collision problem as above, but limited to exotic/custom protocols.  
  *Why not caught:* No test covers a one‑letter scheme; the test matrix only includes standard `http/https` schemes.

- **[severity: medium] Percent‑encoding case is not normalised**  
  *File:* `mira-crawler/ingest/store.py` – `canonical_source_url`.  
  *Lines:* (the function only lower‑cases scheme and host, leaving the rest untouched).  
  *Trigger:* Two URLs that differ only in the case of percent‑encoded octets, e.g.  
  `https://example.com/a%2Fpath` vs `https://example.com/a%2fpath`. Both refer to the same resource, but the function treats them as distinct keys.  
  *Impact:* Duplicate rows for the same logical document, violating the dedup contract and potentially leaking private content.  
  *Why not caught:* No test exercises percent‑encoding variations; the test suite only checks scheme/host case.

- **[severity: high] Inclusion of “.log” in documentation suffixes leaks potentially sensitive logs to the LLM**  
  *File:* `tools/gate7_review.py`  
  *Lines:*  
  ```python
  _DOC_SUFFIXES = (".md", ".markdown", ".rst", ".txt", ".log")
  ```
  By treating `.log` files as *documentation*, the gate now feeds the full contents of any log file that appears in a PR diff to the LLM reviewer. Log files frequently contain secrets (API keys, tokens, internal URLs). The original gate deliberately excluded logs to avoid exposing them.  
  *Impact:* Confidential information may be ingested by the LLM, violating the platform’s data‑privacy policy and potentially creating a compliance breach.  
  *Why not caught:* No test verifies that log contents are redacted before being sent to the model; the change is purely lexical.

- **[severity: medium] Decision‑point reminder text may push the diff over the model’s token limit, truncating critical changes**  
  *File:* `tools/gate7_review.py` – `build_prompt`.  
  *Lines:*  
  ```diff
  -{_truncation_notice(diff)}
  +{_truncation_notice(diff)}{decision_point_reminder(kind)}
  ```
  The static reminder (~400 words) is appended **after** the diff. When the diff size approaches the `MAX_DIFF_CHARS` limit, the truncation logic discards the tail of the diff **before** the reminder is added, but the reminder itself consumes additional tokens, further reducing the amount of diff actually visible to the model.  
  *Trigger:* A PR with a large change set (e.g. a bulk migration) that already hits the token ceiling. The model will see the reminder and a truncated diff, missing the final few lines that may contain the defect.  
  *Impact:* False‑negative review outcomes; critical security or data‑integrity bugs hidden in the omitted tail will never be inspected.  
  *Why not caught:* The test suite only asserts that the reminder appears after the `--- END UNTRUSTED PR DATA ---` marker; it does not simulate a diff large enough to cause truncation.

- **[severity: low] The new 554‑line test file (`test_conflict_and_packaging_contracts.py`) markedly increases CI runtime**  
  *File:* `mira-crawler/tests/test_conflict_and_packaging_contracts.py` (≈ 550 lines, many parametrised sub‑tests).  
  *Trigger:* Each CI run now executes a substantially larger test suite, extending the overall pipeline duration.  
  *Impact:* Longer feedback loops for developers, higher CI cost, and increased likelihood of flaky time‑outs in resource‑constrained environments.  
  *Why not caught:* The prior low‑severity finding about “large test file” referred to a different file; this new addition was not accounted for.

- **[severity: medium] Packaging‑contract scanner only recognises `COPY` directives; it will miss valid `ADD` or multi‑stage `COPY` patterns**  
  *File:* `mira-crawler/tests/test_conflict_and_packaging_contracts.py` – `_whole_dir_copy_dest` helper and associated tests.  
  *Trigger:* A Dockerfile that packages the manifest using `ADD mira-crawler/ /app/` or copies the directory in a later stage (`FROM base AS builder … COPY mira-crawler/ …`). The scanner returns `None`, causing the test to fail **or** (if the test is adjusted) to pass incorrectly while the manifest is actually omitted.  
  *Impact:* The “manifest‑packaging” contract (F2) could be silently violated in production images that use alternative Dockerfile idioms, exposing the ingest gate to a fail‑open scenario.  
  *Why not caught:* The test suite only covers the exact `COPY` syntaxes present today; it does not enumerate the full Dockerfile grammar.

- **[severity: low] Non‑deterministic ordering of URL parameters in `ingested_source_urls`**  
  *File:* `mira-crawler/ingest/store.py` – `ingested_source_urls`.  
  *Lines:*  
  ```python
  lookup = sorted({*asked, *(canonical_source_url(u) for u in asked)})
  ```
  Sorting a set produces a deterministic order, but the order of the list passed to the DB driver may still be implementation‑dependent (e.g., different Python versions, or if `sorted` is removed in future refactor).  
  *Impact:* Minor reproducibility concern for logging/auditing of the exact SQL generated; not a functional bug but could confuse debugging.  
  *Why not caught:* No test asserts on parameter ordering.

## NOT REVIEWED
- Runtime behaviour of the production ingest workers beyond the unit‑test scope (e.g., interaction with external storage back‑ends, Celery task retries).  
- Migration scripts that will eventually canonicalise historic rows; the PR mentions a “one‑off dedup migration” but does not provide it.  
- Interaction of `canonical_source_url` with any downstream services that may expect the original casing (e.g., downstream analytics pipelines that store the raw URL for display).  
- Potential side‑effects on any code that stores URLs for non‑HTTP resources (e.g., `file:` or custom schemes) where the lower‑casing of the scheme may alter semantics.  
- The effect of the new `decision_point_reminder` on downstream LLM prompt‑engineering pipelines (e.g., token‑budget calculators).  

--- 

**Summary:** The changes introduce a high‑severity regression: historic mixed‑case `source_url` rows are no longer deduped, breaking the conflict‑visibility guarantee and opening a privacy leak. Additional medium‑severity issues (single‑letter scheme handling, percent‑encoding, log‑file exposure, diff truncation, packaging‑scanner limitations) further weaken the platform’s security and correctness posture. A remedial plan should include:

1. A migration that rewrites existing `knowledge_entries.source_url` values to the canonical form (or adds a trigger to enforce canonicalisation on INSERT/UPDATE).  
2. Remove the `len(head) < 2` guard or relax it to support single‑letter schemes.  
3. Normalise percent‑encoding (e.g., `urllib.parse.unquote` followed by `urllib.parse.quote` with a fixed case) before computing the key.  
4. Re‑exclude `.log` from `_DOC_SUFFIXES` or enforce redaction of log contents before prompting.  
5. Place the decision‑point reminder **before** the truncation notice or make its inclusion conditional on remaining token budget.  
6. Consider splitting the monolithic conflict‑and‑packaging test file or marking parts as integration‑only to keep CI fast.  
7. Expand the Dockerfile manifest scanner to recognise `ADD` and multi‑stage `COPY` patterns, or enforce a stricter Dockerfile style via linting.  

Addressing these points will restore the platform’s dedup guarantees, prevent inadvertent secret leakage, and ensure the Gate 7 review process remains reliable.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
