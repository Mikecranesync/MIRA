# Gate 7 adversarial review — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, security boundaries, cross-repository contract, deletion/destructive, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `085a1b909cb6d7a560d290df318330c2bb86ee22`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (72): docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-code-explain-pg16.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 70,440/70,440 (cap 80,000)
- reviewed-diff sha256 (sent bytes): `871fb01ddbec8319c8e838233aca137139c8be4b7cc05f2e59759b1852888159`
- full scoped-diff sha256 (pre-cap): `871fb01ddbec8319c8e838233aca137139c8be4b7cc05f2e59759b1852888159`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] Evidence‑artifact removal bypasses file renames/moves** — 
- **[medium] Adding `.log` to documentation‑suffix list changes PR‑kind classification** — 
- **[low] `canonical_source_url` does not normalize default ports** — 

## Raw review

## VERDICT
**BLOCK**

The changes introduce a high‑severity security regression and a medium‑severity functional regression that were not exercised by the added test‑suite.

---

## FINDINGS

### 1. **[severity: high] Evidence‑artifact removal bypasses file renames/moves**
- **What breaks:**  
  `drop_evidence_artifacts()` only inspects the *target* (`b/…`) path of a diff header to decide whether to drop the file:

  ```diff
  +def drop_evidence_artifacts(diff: str) -> tuple[str, list[str]]:
  +    kept: list[str] = []
  +    dropped: list[str] = []
  +    keep = True
  +    for line in diff.splitlines(keepends=True):
  +        if line.startswith("diff --git "):
  +            target = line.rsplit(" b/", 1)[-1].strip()
  +            keep = not is_evidence_artifact(target)          # ← only target checked
  +            if not keep:
  +                dropped.append(target)
  +        if keep:
  +            kept.append(line)
  +    return "".join(kept), dropped
  ```

  When an evidence artifact (a file under `docs/architecture/convergence/units/evidence/`) is **renamed** or **moved** to a non‑evidence location, the `diff --git` line reports the *new* (`b/`) path, which is **not** recognised as evidence. The function therefore keeps the diff, including the full file contents under the new name.

- **Concrete input/state that triggers it:**  
  A PR that contains a rename diff such as:

  ```
  diff --git a/docs/architecture/convergence/units/evidence/secret.log b/src/secret.log
  similarity index 100%
  rename from docs/architecture/convergence/units/evidence/secret.log
  rename to src/secret.log
  ```

  The file `secret.log` (an evidence artifact) is moved to `src/secret.log`. Because only the `b/` path is examined, the artifact is **not** dropped, and the full contents of `secret.log` are sent to the LLM reviewer. Sensitive data that were meant to be kept out of the review (e.g., private keys, tokens, or internal logs) can thus be leaked.

- **File & line evidence:**  
  `tools/gate7_review.py` – lines defining `drop_evidence_artifacts` (added in this PR, see diff hunk starting at the definition of the function).

- **Why this is a defect:**  
  The gate’s documentation explicitly states that *“preserved review artifacts … are historical EVIDENCE … not claims the PR makes.”* The intention is to **exclude** these artifacts from the review entirely. By failing to drop them when they appear on the *source* side of a rename, the implementation silently defeats the security boundary, allowing untrusted data to flow into the model prompt. This is a classic “silent‑scope” failure and constitutes a data‑leak vulnerability.

- **Suggested mitigation:**  
  - Parse **both** sides of the diff header (`a/…` and `b/…`) and drop the diff if **either** path is an evidence artifact.  
  - For rename operations, also drop the subsequent content hunk (or replace it with a placeholder) to guarantee no artifact payload is emitted.  
  - Add a unit test exercising a rename from an evidence path to a non‑evidence path, asserting that the diff is fully removed.

---

### 2. **[severity: medium] Adding `.log` to documentation‑suffix list changes PR‑kind classification**
- **What breaks:**  
  `_DOC_SUFFIXES` now includes `".log"`:

  ```diff
  -_DOC_SUFFIXES = (".md", ".markdown", ".rst", ".txt")
  +_DOC_SUFFIXES = (".md", ".markdown", ".rst", ".txt", ".log")
  ```

  The `pr_kind()` function classifies a PR as *documentation* if **any** changed file ends with a suffix from `_DOC_SUFFIXES`. Consequently, a PR that only adds a new log file (e.g., `debug.log`) will be reported as “partly documentation” instead of “code”.

- **Concrete input/state that triggers it:**  
  A change that adds `mira-crawler/tests/debug.log` (or any other log) and no code changes. `pr_kind()` will return `"documentation"` and the gate will inject the **decision‑point reminder** text, which is irrelevant for pure‑code changes and may confuse reviewers.

- **File & line evidence:**  
  `tools/gate7_review.py` – the modification of `_DOC_SUFFIXES` (see diff hunk adding `".log"`).

- **Why this is a defect:**  
  The gate’s intent is to surface documentation‑only changes so that the reviewer can apply the appropriate “READ BEFORE YOU DECIDE” reminder. Broadening the suffix list to include log files conflates routine test‑artifact logs with genuine documentation, leading to false‑positive “documentation” classification and unnecessary reminder text. This can distract reviewers and increase the chance of missing real defects.

- **Suggested mitigation:**  
  - Keep `.log` out of `_DOC_SUFFIXES` and treat log files as **code** artifacts (they are typically generated by tests or CI).  
  - If log files must be considered documentation for a specific workflow, introduce an explicit whitelist (e.g., only logs under `docs/` directories) instead of a blanket suffix rule.  
  - Add a regression test for `pr_kind()` covering a PR that adds a top‑level `.log` file and asserts that the kind remains `"code"`.

---

### 3. **[severity: low] `canonical_source_url` does not normalize default ports**
- **What breaks:**  
  The canonicalisation lowers the scheme and host but **preserves the explicit port**. URLs that differ only by an explicit default port (`:80` for `http`, `:443` for `https`) are treated as distinct keys:

  ```
  https://example.com/path        → https://example.com/path
  https://example.com:443/path    → https://example.com:443/path
  ```

- **Concrete input/state that triggers it:**  
  Two ingest events for the same logical resource, one with `https://example.com/path` and another with `https://example.com:443/path`. The dedup key `(tenant_id, source_url, chunk_index)` will consider them different, resulting in **duplicate rows** for the same content.

- **File & line evidence:**  
  `mira-crawler/ingest/store.py` – the implementation of `canonical_source_url` (the return statement after host/port handling).

- **Why this is a defect:**  
  Duplicate rows increase storage, break the “one‑canonical‑key per resource” guarantee, and may cause later `chunk_exists` checks to miss an existing row (since the raw URL of the first insert is stored without the explicit port). Although not a direct security breach, it is a data‑integrity regression that can surface under high ingest volume.

- **Suggested mitigation:**  
  - Detect and strip default ports (`:80` for `http`, `:443` for `https`) during canonicalisation.  
  - Add unit tests covering default‑port canonicalisation cases.  

---

## NOT REVIEWED
*Runtime behaviour of the full ingest pipeline under high‑concurrency workloads (e.g., race conditions between `chunk_exists` and `insert_chunk`).*  
*Performance impact of the `OR (source_url = :raw)` clause on large `knowledge_entries` tables.*  
*Behaviour of `canonical_source_url` on exotic URI schemes (e.g., `data:`, `mailto:`) – not covered by the current test matrix.*  

--- 

**Overall recommendation:** Block the PR until the evidence‑artifact rename bug is fixed, the `.log` suffix handling is reviewed, and default‑port normalisation is addressed. These regressions expose confidential data and degrade the reliability of the deduplication contract that the gate is explicitly intended to protect.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
