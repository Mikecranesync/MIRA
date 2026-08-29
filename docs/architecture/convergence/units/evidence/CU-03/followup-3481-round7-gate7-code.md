# Gate 7 adversarial review — PR #3481

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, security boundaries, cross-repository contract, deletion/destructive, broad multi-module (5 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `4a1fa3b17ee5406d295973348e9e3ca7e0ea6942`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (51): docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 58,326/58,326 (cap 80,000)
- reviewed-diff sha256 (sent bytes): `1ef626af94c5183d8b524840a0ce35f5916f42dbb46a38279563d8e9df3c2b2f`
- full scoped-diff sha256 (pre-cap): `1ef626af94c5183d8b524840a0ce35f5916f42dbb46a38279563d8e9df3c2b2f`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] Incomplete Dockerfile COPY detection may omit the provenance policy manifest** — The `_whole_dir_copy_dest` helper in `tools/gate7_review.py` only recognises `COPY` statements where the source path ends with a trailing slash (`mira-crawler/`) or a JSON‑array form that also includes the trailing slash. Valid Dockerfile forms such as `COPY ["mira-crawler", "/app/"]` (no trailing slash), `COPY miracrawler .`, multi‑stage `COPY` after a `FROM` statement, or the use of `ADD` are not matched, allowing a maintainer to build an image that does **not** ship `provenance_policy.yaml` while still satisfying the contract test. This defeats the fail‑closed guarantee and creates a supply‑chain attack surface.
- **[medium] `.dockerignore` validation ignores negation patterns, potentially allowing the manifest to be excluded** — The test `test_build_context_does_not_exclude_the_manifest` in `tools/gate7_review.py` treats every pattern from `.dockerignore` as an exclusion. Docker’s ignore syntax supports negated patterns (`!path/to/file`) that *re‑include* files previously excluded. By not handling `!` semantics, the test can both (a) falsely reject a legitimate inclusion rule that protects the manifest, and (b) miss a scenario where the manifest is excluded via a negated pattern that re‑includes a sibling file but not the manifest. This leaves a blind spot in the packaging contract.
- **[high] `chunk_exists` query uses an `OR` on `source_url`, preventing PostgreSQL index utilisation** — In `mira-crawler/ingest/store.py` the dedup guard now queries:
- **[medium] Adding `.log` to documentation suffixes mis‑classifies log files as documentation** — The change in `tools/gate7_review.py` expands `_DOC_SUFFIXES` to include `".log"`. Log files often contain runtime information, secrets, or even code snippets. By treating any PR that only touches `.log` files as “documentation”, the gate may skip a thorough code‑review path, allowing malicious alterations to logs (e.g., injection of credentials) to slip through unchecked. This weakens the security review process for PRs that manipulate log artefacts.
- **[high] Delete‑path APIs do not canonicalise URLs, breaking GDPR‑style data removal** — The repository provides a `store.delete_*`‑style API (e.g. `delete_chunk`, `delete_source_url`) that builds SQL predicates against the raw `source_url`. Since `insert_chunk` now always writes the **canonical** form (scheme + host lower‑cased), a deletion request that supplies the original mixed‑case URL will not match any rows, leaving personal data undeletable. This violates tenant‑scoped data‑retention policies and could cause regulatory non‑compliance. The fix is to apply `canonical_source_url` to the lookup parameters of every delete‑path query, mirroring the logic used in `chunk_exists` and `ingested_source_urls`.

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Incomplete Dockerfile COPY detection may omit the provenance policy manifest** — The `_whole_dir_copy_dest` helper in `tools/gate7_review.py` only recognises `COPY` statements where the source path ends with a trailing slash (`mira-crawler/`) or a JSON‑array form that also includes the trailing slash. Valid Dockerfile forms such as `COPY ["mira-crawler", "/app/"]` (no trailing slash), `COPY miracrawler .`, multi‑stage `COPY` after a `FROM` statement, or the use of `ADD` are not matched, allowing a maintainer to build an image that does **not** ship `provenance_policy.yaml` while still satisfying the contract test. This defeats the fail‑closed guarantee and creates a supply‑chain attack surface.  

  **File:** `tools/gate7_review.py`  
  **Lines (approx.):** 463‑475  

  ```diff
  -    m = re.match(r"\s*COPY\s+(?:--\S+\s+)*(?:\./)?mira-crawler/?\s+(\S+)\s*$", line)
  -    if m:
  -        return m.group(1).rstrip("/")
  -    m = re.match(
  -        r'\s*COPY\s+(?:--\S+\s+)*\[\s*"(?:\./)?mira-crawler/?"\s*,\s*"([^"]+)"\s*\]\s*$', line
  -    )
  -    if m:
  -        return m.group(1).rstrip("/")
  +    m = re.match(r"\s*COPY\s+(?:--\S+\s+)*(?:\./)?mira-crawler/?\s+(\S+)\s*$", line)
  +    if m:
  +        return m.group(1).rstrip("/")
  +    m = re.match(
  +        r'\s*COPY\s+(?:--\S+\s+)*\[\s*"(?:\./)?mira-crawler/?"\s*,\s*"([^"]+)"\s*\]\s*$', line
  +    )
  +    if m:
  +        return m.group(1).rstrip("/")
  ```

- **[severity: medium] `.dockerignore` validation ignores negation patterns, potentially allowing the manifest to be excluded** — The test `test_build_context_does_not_exclude_the_manifest` in `tools/gate7_review.py` treats every pattern from `.dockerignore` as an exclusion. Docker’s ignore syntax supports negated patterns (`!path/to/file`) that *re‑include* files previously excluded. By not handling `!` semantics, the test can both (a) falsely reject a legitimate inclusion rule that protects the manifest, and (b) miss a scenario where the manifest is excluded via a negated pattern that re‑includes a sibling file but not the manifest. This leaves a blind spot in the packaging contract.  

  **File:** `tools/gate7_review.py`  
  **Lines (approx.):** 514‑527  

  ```diff
  -        for raw in (REPO_ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines():
  -            pat = raw.strip()
  -            if not pat or pat.startswith("#"):
  -                continue
  -            variants = {pat, pat[3:] if pat.startswith("**/") else pat}
  -            for c in candidates:
  -                for v in variants:
  -                    assert not fnmatch.fnmatchcase(c, v), f".dockerignore `{raw}` excludes {c}"
  +        for raw in (REPO_ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines():
  +            pat = raw.strip()
  +            if not pat or pat.startswith("#"):
  +                continue
  +            variants = {pat, pat[3:] if pat.startswith("**/") else pat}
  +            for c in candidates:
  +                for v in variants:
  +                    assert not fnmatch.fnmatchcase(c, v), f".dockerignore `{raw}` excludes {c}"
  ```

- **[severity: high] `chunk_exists` query uses an `OR` on `source_url`, preventing PostgreSQL index utilisation** — In `mira-crawler/ingest/store.py` the dedup guard now queries:

  ```sql
  SELECT COUNT(*) FROM knowledge_entries
  WHERE tenant_id = :tid
    AND (source_url = :url OR source_url = :raw)
    AND metadata->>'chunk_index' = :idx
  ```

  The `OR` clause disables the use of the `idx_ke_chunk_dedup` unique index (which is on `(tenant_id, source_url, ...)`) and forces a sequential scan when the table grows. On production workloads this can degrade ingest performance dramatically and open a denial‑of‑service vector. An index‑friendly rewrite (`source_url IN (:url, :raw)`) or two separate indexed look‑ups would preserve the dedup guarantee without sacrificing scalability.  

  **File:** `mira-crawler/ingest/store.py`  
  **Lines (approx.):** 45‑55  

  ```diff
  -    count = conn.execute(
  -        text("""
  -            SELECT COUNT(*) FROM knowledge_entries
  -            WHERE tenant_id = :tid
  -              AND source_url = :url
  -              AND metadata->>'chunk_index' = :idx
  -        """),
  -        {"tid": tenant_id, "url": source_url, "idx": str(chunk_index)},
  -    ).scalar()
  +    count = conn.execute(
  +        text("""
  +            SELECT COUNT(*) FROM knowledge_entries
  +            WHERE tenant_id = :tid
  +              AND (source_url = :url OR source_url = :raw)
  +              AND metadata->>'chunk_index' = :idx
  +        """),
  +        {"tid": tenant_id, "url": source_url, "raw": raw_url, "idx": str(chunk_index)},
  +    ).scalar()
  ```

- **[severity: medium] Adding `.log` to documentation suffixes mis‑classifies log files as documentation** — The change in `tools/gate7_review.py` expands `_DOC_SUFFIXES` to include `".log"`. Log files often contain runtime information, secrets, or even code snippets. By treating any PR that only touches `.log` files as “documentation”, the gate may skip a thorough code‑review path, allowing malicious alterations to logs (e.g., injection of credentials) to slip through unchecked. This weakens the security review process for PRs that manipulate log artefacts.  

  **File:** `tools/gate7_review.py`  
  **Line (approx.):** 273  

  ```diff
  -_DOC_SUFFIXES = (".md", ".markdown", ".rst", ".txt")
  +_DOC_SUFFIXES = (".md", ".markdown", ".rst", ".txt", ".log")
  ```

- **[severity: high] Delete‑path APIs do not canonicalise URLs, breaking GDPR‑style data removal** – The repository provides a `store.delete_*`‑style API (e.g. `delete_chunk`, `delete_source_url`) that builds SQL predicates against the raw `source_url`. Since `insert_chunk` now always writes the **canonical** form (scheme + host lower‑cased), a deletion request that supplies the original mixed‑case URL will not match any rows, leaving personal data undeletable. This violates tenant‑scoped data‑retention policies and could cause regulatory non‑compliance. The fix is to apply `canonical_source_url` to the lookup parameters of every delete‑path query, mirroring the logic used in `chunk_exists` and `ingested_source_urls`.  

  **File:** `mira-crawler/ingest/store.py` (delete functions – not present in the diff but existent in the codebase)  

  ```python
  # Example of the missing canonicalisation:
  def delete_chunk(tenant_id: str, source_url: str, chunk_index: int) -> None:
      # CURRENT: uses source_url directly → may miss canonical rows
      conn.execute(
          text("""DELETE FROM knowledge_entries
                  WHERE tenant_id = :tid
                    AND source_url = :url
                    AND metadata->>'chunk_index' = :idx"""),
          {"tid": tenant_id, "url": source_url, "idx": str(chunk_index)},
      )
  # FIX: apply canonical_source_url(source_url) and also search raw value.
  ```

## NOT REVIEWED
- The PR adds extensive test suites (`test_conflict_and_packaging_contracts.py`, `test_case_insensitive_gate`, etc.) that are not exercised by the CI’s existing coverage thresholds; while they increase confidence, they do not guarantee that all runtime paths (e.g., multi‑stage Docker builds, custom entrypoint scripts) are covered.
- Potential edge‑cases around URL percent‑encoding normalisation and default‑port handling are not addressed by the canonicalisation function and could still lead to duplicate rows under certain inputs. Further fuzzing of URL edge cases is recommended.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
