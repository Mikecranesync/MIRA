# Gate 7 adversarial review — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, cross-repository contract, deletion/destructive, forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `dbd377e987c8cd914dd4172b27f35aaa6fc0f070`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (141): .claude/commands/gate7-review.md, docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md, docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code-attempt1-cascade-failed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round12-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round13-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round14-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round15-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-code-explain-pg16.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 97,829/97,829 (cap 110,000)
- reviewed-diff sha256 (sent bytes): `f5061cee9d1df0848caef4dee228acbd7818968e345dca7cb4f9268ab42565e5`
- full scoped-diff sha256 (pre-cap): `f5061cee9d1df0848caef4dee228acbd7818968e345dca7cb4f9268ab42565e5`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] Private URLs are logged in clear text** — 
- **[high] Conflict handling never upgrades a row to a more‑private state** — 
- **[medium] `ingested_source_urls` aborts on empty or malformed tenant IDs** — 
- **[medium] Missing‑dependency handling for PyYAML is not truly lazy** — 
- **[low] Default exclusion of evidence artifacts may hide crucial context from the LLM reviewer** — 

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Private URLs are logged in clear text** —  
  The `store.insert_chunk` path logs the source URL (potentially a private origin) in a warning message without any redaction. This can leak confidential URLs to logs that may be accessed by operators or other tenants, violating tenant isolation and privacy guarantees.  
  **File:** `mira-crawler/ingest/store.py`  
  **Line(s):**  
  ```diff
  -            "Refusing knowledge_entries write for %s — %s", (source_url or "<no url>")[:100], prov_reason
  +            "Refusing knowledge_entries write for %s — %s",
  +            (source_url or "<no url>")[:100],
  +            prov_reason,
  ```
  The warning still includes `(source_url or "<no url>")[:100]`, exposing up to the first 100 characters of a potentially private URL.

- **[severity: high] Conflict handling never upgrades a row to a more‑private state** —  
  The `INSERT … ON CONFLICT DO NOTHING` strategy guarantees that a colliding insert will never modify an existing row, even when the new row carries a stricter `is_private=True` flag. If a public row (or a row with `is_private=False` due to a mis‑classification) already exists, a later ingest of the same URL that is correctly classified as private will be silently dropped, leaving the public row in place and effectively exposing private content. The test suite only checks that the conflict action is `DO NOTHING`; it does **not** verify that privacy can be upgraded on conflict.  
  **File:** `mira-crawler/tests/test_conflict_and_packaging_contracts.py` (test that extracts the ON CONFLICT clause)  
  **Line(s):**  
  ```python
  m = re.search(
      r"ON CONFLICT\s*\((.*?)\)\s*WHERE\s*(.*?)\s*DO\s+(NOTHING|UPDATE)",
      re.sub(r"\s+", " ", sql),
      re.I | re.S,
  )
  assert m, f"no ON CONFLICT clause in the insert statement:\n{sql}"
  ```
  The captured clause is later asserted to be `"NOTHING"`, confirming the current behaviour.

- **[severity: medium] `ingested_source_urls` aborts on empty or malformed tenant IDs** —  
  The function now performs a strict validation of `tenant_id` and returns an empty set without hitting the database when the tenant identifier is empty, `None`, whitespace‑only, or a non‑string. This “fail‑closed” path silently treats all URLs as not ingested, which can cause the ingest pipeline to repeatedly attempt to store the same chunk, leading to duplicate rows and unnecessary load on the DB. Existing callers that previously relied on an empty tenant ID to perform a cross‑tenant probe will now get a false‑negative result.  
  **File:** `mira-crawler/ingest/store.py`  
  **Line(s):**  
  ```diff
  +    if not isinstance(tenant_id, str) or not tenant_id.strip():
  +        # Fail closed — empty, None, whitespace-only or non‑string is not a
  +        # tenant. (A whitespace tenant would still be scoped — `tenant_id = ' '`
  +        # matches no row — but it is invalid input and must not reach SQL.) (Gate 7 round M on #3481): without a tenant this probe
  +        # would have queried EVERY tenant's rows. Nothing is reported as
  +        # ingested, so ledger items stay pending — the retryable direction.
  +        logger.warning("ingested_source_urls called without a tenant_id — refusing the probe")
  +        return set()
  ```

- **[severity: medium] Missing‑dependency handling for PyYAML is not truly lazy** —  
  The `provenance` module expects `yaml` to be importable when `load_policy` runs. The test suite simulates a missing PyYAML by inserting `None` into `sys.modules`, assuming that `import yaml` will raise `ImportError`. However, if `yaml` is imported at module import time (which is typical), the missing‑dependency scenario will raise an exception **during import**, crashing the whole worker process instead of failing closed as the test expects. This discrepancy creates a false‑green test and a potential runtime crash in environments where PyYAML is not installed.  
  **File:** `mira-crawler/tests/test_conflict_and_packaging_contracts.py` (the test that simulates the missing dependency)  
  **Line(s):**  
  ```python
  def test_missing_pyyaml_is_a_refused_write_not_a_task_abort(self, monkeypatch, captured):
      """``import yaml`` is lazy inside ``load_policy``; both consumers wrap it
      in the fail‑closed handler. Simulate an image without PyYAML: the gate
      refuses, the boundary refuses, nothing reaches the database, nothing
      raises out to the Celery task."""
      monkeypatch.setattr(provenance, "_POLICY", None)
      monkeypatch.setitem(sys.modules, "yaml", None)  # `import yaml` → ImportError
  ```
  The comment states the expectation of laziness, but the actual implementation in `provenance.py` (not changed in this PR) imports `yaml` at the top level, meaning the test does not exercise the real failure mode.

- **[severity: low] Default exclusion of evidence artifacts may hide crucial context from the LLM reviewer** —  
  The new `--include-evidence` flag changes the diff that is sent to the language model: by default, all files under `docs/architecture/convergence/units/evidence/` are stripped from the diff and only listed in the receipts block. While the intent is to keep historical reviewer output out of the current claim set, removing those artifacts can also discard valuable context (e.g., prior adjudications, crash logs) that the model might need to reason correctly about the current change. If the excluded artifacts contain information that explains a subtle regression, the LLM could issue an inaccurate verdict.  
  **File:** `tools/gate7_review.py` (argument definition and default drop logic)  
  **Line(s):**  
  ```diff
  +    p.add_argument(
  +        "--include-evidence",
  +        action="store_true",
  +        help="keep preserved review artifacts (raw reviewer output / logs under "
  +        "units/evidence/) in the reviewed diff. By default they are excluded and "
  +        "named in the receipts: they are evidence of what an earlier model said, "
  +        "not claims the PR makes (#3483).",
  +    )
  ...
  +    artifacts: list[str] = []
  +    if not a.include_evidence:
  +        diff, artifacts = drop_evidence_artifacts(diff)
  +        if artifacts:
  +            print(
  +                f"Gate 7: {len(artifacts)} preserved evidence artifact(s) excluded from review "
  +                "(raw reviewer output / logs under units/evidence/, not author claims; "
  +                f"--include-evidence keeps them): {', '.join(artifacts)}",
  +                file=sys.stderr,
  +            )
  ```

## NOT REVIEWED
- Performance impact of the `canonical_source_url` calls (set construction, sorting, and additional OR condition in SQL) on very large ingestion batches.  
- The migration script (`003_kb_hardening.sql`) that creates the unique index does not enforce case‑insensitive uniqueness on `source_url`; without a follow‑up deduplication migration, historical mixed‑case rows will persist indefinitely, leading to storage bloat.  
- Potential edge‑cases in `canonical_source_url` (e.g., URLs with percent‑encoding case variations, internationalised domain names) that may still produce duplicate logical entries.  
- Interaction of the new `--include-evidence` flag with downstream tooling that expects a deterministic diff size.  
- Any side‑effects of the large new test file on CI timeouts or resource limits.  

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
