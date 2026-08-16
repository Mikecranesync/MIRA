# Gate 7 adversarial review — PR #3268

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, tenant scoping, security boundaries, cross-repository contract, concurrency/idempotency/state, broad multi-module (8 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Findings

- **[high] `insert_chunk` signature now requires a mandatory `is_private` kw‑only argument** — any existing call that forwards arguments via `**kwargs` or that supplies positional arguments after `source_type` will raise a `TypeError` at runtime, aborting the ingest task and causing a denial‑of‑service for the whole pipeline.
- **[medium] `learning_ingester` now writes `verified=false` for FAQ rows** — downstream code that assumes FAQ rows are verified may skip processing or display incomplete information, causing functional regression.
- **[low] Read‑allowlist entries have been re‑keyed with new SHA‑256 hashes** — the updated hashes must match the actual query text; otherwise legitimate reads will be blocked by the security fence.

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] `insert_chunk` signature now requires a mandatory `is_private` kw‑only argument** — any existing call that forwards arguments via `**kwargs` or that supplies positional arguments after `source_type` will raise a `TypeError` at runtime, aborting the ingest task and causing a denial‑of‑service for the whole pipeline.  
  *Evidence*: the diff shows the new function signature  

  ```diff
  def insert_chunk(
      model_number: str,
      source_url: str,
      source_type: str = "equipment_manual",
  +    *,
  +    is_private: bool,
  ) -> bool:
  ```  

  The required keyword‑only parameter is added **without a default**, meaning callers that do not explicitly provide it (including generic wrappers that use `**kwargs`) will crash. The PR description claims “every call site (12 across crawler tasks …) now carries an explicit value”, but the diff only proves the signature change; it does **not** prove that *all* call‑sites – especially any that forward arguments – were updated. A missed caller would break the ingestion service in production, which is a high‑severity availability defect.

- **[severity: medium] `learning_ingester` now writes `verified=false` for FAQ rows** — downstream code that assumes FAQ rows are verified may skip processing or display incomplete information, causing functional regression.  
  *Evidence*: the changed INSERT statement  

  ```diff
  -        false, true, 'faq', now())
  +        true, false, 'faq', now())
  ```  

  The column order is `is_private, verified`; the change flips `verified` from `true` to `false`. The PR notes “no live consumer”, but the audit does not guarantee that no other component reads `verified` for FAQs. If such a component exists, it will now treat these rows as unverified, potentially breaking UI or analytics.

- **[severity: low] Read‑allowlist entries have been re‑keyed with new SHA‑256 hashes** — the updated hashes must match the actual query text; otherwise legitimate reads will be blocked by the security fence.  
  *Evidence*: several entries in `tools/qa/security/knowledge_entries_read_allowlist.yml` changed SHA values, e.g.  

  ```diff
  -  "tools/vendor_coverage_ingest.py:158":
  +  "tools/vendor_coverage_ingest.py:158":
        query_sha256: "b9d872e5e5430ac3b5e8f0ce9305a62e700fd5dfee62d556fd467d4b1466a693"
  ```  

  If the underlying query text was not updated accordingly (the diff does not show the query change), the allowlist will reject reads from that file, potentially causing hidden data‑access failures.

## NOT REVIEWED
- Whether **all** call‑sites of `insert_chunk` (including any that use dynamic dispatch, reflection, or third‑party plugins) have been updated to supply the new `is_private` keyword. The diff only shows the function signature change; the full repository scan is not visible.
- Whether any **raw SQL** statements elsewhere (outside the shown files) insert into `knowledge_entries` without specifying the `is_private` column, thereby relying on the database default (`false`) and re‑introducing the original leakage risk.
- The exact behavior of the `file://` containment logic (TOCTOU race, symlink handling) – the diff does not include the implementation details, so we cannot confirm the mitigation is race‑free.
- Potential downstream consumers of the `verified` flag for FAQ rows; the PR claims “no live consumer”, but without a full dependency map we cannot verify that no hidden component relies on `verified=true`.

## Cascade attempts

- `groq: ok`
