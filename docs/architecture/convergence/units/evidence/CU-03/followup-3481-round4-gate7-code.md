# Gate 7 adversarial review — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, cross-repository contract, deletion/destructive, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `c87d298f243bee28cd51d87f2018ab37a3defa87`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (27): docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 33,621/33,621 (cap 40,000)
- reviewed-diff sha256 (sent bytes): `1c8a19b9765f1e2cfde2f24f722eec2ed94421d11308484542eccb3f99308645`
- full scoped-diff sha256 (pre-cap): `1c8a19b9765f1e2cfde2f24f722eec2ed94421d11308484542eccb3f99308645`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] False‑green test for Dockerfile manifest packaging** — 
- **[high] Inadequate simulation of a missing PyYAML dependency** — 
- **[high] Scoped‑path filtering may misclassify PR kind** — 

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] False‑green test for Dockerfile manifest packaging** –  
  The contract test `test_every_crawler_image_copies_the_whole_directory_onto_the_import_path` (in `mira-crawler/tests/test_conflict_and_packaging_contracts.py`) validates that a Dockerfile contains a line `COPY mira-crawler/ <dest>` and that `<dest>` appears in `PYTHONPATH`.  
  The helper `_whole_dir_copy_dest` (lines 226‑267) uses a **very narrow regex**:

  ```python
  m = re.match(r"\s*COPY\s+(?:\./)?mira-crawler/?\s+(\S+)\s*$", line)
  ```

  It **does not match** any of the following legitimate patterns that are common in production Dockerfiles:

  * `COPY --chown=app:app mira-crawler/ /app/`
  * `COPY ["mira-crawler/", "/app/"]` with additional whitespace or line‑continuations
  * `COPY ${MIRACRAWLER_SRC} /app/` (variable substitution)
  * multi‑stage builds using `COPY --from=builder mira-crawler/ /app/`

  Because the regex fails to recognise these valid forms, a Dockerfile could omit the `provenance_policy.yaml` manifest (or copy the directory under a different name) while the test still **passes**, giving a false sense of security that the fail‑closed contract is enforced.  If the manifest is absent at runtime, the ingest gate cannot enforce policy, potentially allowing unverified content to be ingested and shared – a **security breach**.

- **[severity: high] Inadequate simulation of a missing PyYAML dependency** –  
  The test `test_missing_pyyaml_is_a_refused_write_not_a_task_abort` (lines 381‑388) tries to emulate a missing `yaml` package with:

  ```python
  monkeypatch.setitem(sys.modules, "yaml", None)  # `import yaml` → ImportError
  ```

  Setting `sys.modules["yaml"] = None` **does not raise** `ImportError`; subsequent `import yaml` returns the `None` object, and any attribute access (e.g., `yaml.safe_load`) raises an **AttributeError**.  Production code most likely catches only `ImportError` to implement the “fail‑closed” behaviour.  Consequently, a real container that lacks `PyYAML` would cause an unhandled exception and abort the Celery task, **contrary to the design** that the write should be refused cleanly.  The test therefore provides a **false‑green guarantee** that missing PyYAML is safely handled.

- **[severity: high] Scoped‑path filtering may misclassify PR kind** –  
  `tools/gate7_review.py` introduces `scoped_paths` (lines 290‑298):

  ```python
  def scoped_paths(changed_paths: list[str], prefixes: tuple[str, ...]) -> list[str]:
      return [p for p in changed_paths if any(p.startswith(pre) for pre in prefixes)]
  ```

  The function uses a **plain `startswith` check** on the raw path strings.  If a user supplies a prefix without a trailing slash (e.g., `"docs"` instead of `"docs/"`), it will also match files such as `docsfile.py`, causing those files to be treated as “documentation”.  Conversely, a legitimate `docs/` file will be omitted if the prefix is `"docs"` (no slash) and the path begins with `"docs/"`.  This coupling between the `--paths` CLI argument and the `pr_kind` determination (used in the reviewer prompt) can lead to **incorrect PR‑kind classification**, making reviewers overlook code changes that are actually present.  Mis‑classification undermines the review process and can allow regressions to slip through.

These three high‑severity findings expose security gaps, false‑positive test coverage, and a functional regression that could let policy violations go undetected.

## NOT REVIEWED
- The actual runtime behaviour of the ingest gate inside the Celery worker when `PyYAML` is truly missing (the test only exercises the gate function, not the worker’s exception handling).  
- Whether multi‑stage Docker builds that copy the `mira‑crawler` directory in an earlier stage but later remove `provenance_policy.yaml` still satisfy the contract (the test only checks the presence of a `COPY` line).  
- ORM‑level updates to `knowledge_entries.is_private` that are generated via SQLAlchemy’s query builder rather than raw SQL strings; the test’s source‑code scanner would miss such updates.  

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
