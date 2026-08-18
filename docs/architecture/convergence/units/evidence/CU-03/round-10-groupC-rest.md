# Gate 7 adversarial review — PR #3268

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** tenant scoping, security boundaries, cross-repository contract, broad multi-module (9 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `2655e69863cb47dbc128dee1d5ea864cc40d5e50`
- scope (--paths): tools/, mira-bots/, mira-hub/, tests/, .github/, .claude/, mira-core/
- excluded by scope (46): docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md, docs/architecture/convergence/BACKLOG.md, docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/round-1-crash.log, docs/architecture/convergence/units/evidence/CU-03/round-2-crash.log, docs/architecture/convergence/units/evidence/CU-03/round-3-full-diff.md, docs/architecture/convergence/units/evidence/CU-03/round-4-full-diff.md, docs/architecture/convergence/units/evidence/CU-03/round-5-full-diff.md, docs/architecture/convergence/units/evidence/CU-03/round-6-groupA-crawler-prod.md, docs/architecture/convergence/units/evidence/CU-03/round-6-groupB-crawler-tests.md, docs/architecture/convergence/units/evidence/CU-03/round-6-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-7-groupA-crawler-prod.md, docs/architecture/convergence/units/evidence/CU-03/round-7-groupB-crawler-tests.md, docs/architecture/convergence/units/evidence/CU-03/round-7-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-8-groupA-crawler-prod.md, docs/architecture/convergence/units/evidence/CU-03/round-8-groupB-crawler-tests.md, docs/architecture/convergence/units/evidence/CU-03/round-8-groupC-rest.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-adjudication-1-scope-limited.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-adjudication-2-PASS.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupA-review.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-adjudication-1-scope-limited.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-adjudication-2-PASS.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupB-review.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupC-adjudication-PASS.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupC-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/round-9-groupC-review.md, mira-crawler/crawler/base_crawler.py, mira-crawler/ingest/store.py, mira-crawler/main.py, mira-crawler/tasks/_shared.py, mira-crawler/tasks/full_ingest_pipeline.py, mira-crawler/tasks/ingest.py, mira-crawler/tasks/manualslib_scraper.py, mira-crawler/tasks/patents.py, mira-crawler/tasks/playwright_crawler.py, mira-crawler/tasks/reddit.py, mira-crawler/tasks/youtube.py, mira-crawler/tests/test_celery_tasks.py, mira-crawler/tests/test_ingest.py, mira-crawler/tests/test_manufacturer_normalize.py, mira-crawler/tests/test_oem_trust.py, mira-crawler/tests/test_store_verified.py, mira-crawler/tests/test_write_path_visibility.py
- diff chars sent/total: 50,707/50,707 (cap 55,000)
- reviewed-diff sha256: `151b011ea63d1c68d615c5ed1f9b79a68d36cc53c0721d63a64f259c1e06f4d2`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

- **[high] Incomplete update of `insert_chunk` callers after required `is_private` parameter added** — The function signature now requires a keyword‑only `is_private` argument, but only a single call site in this diff was updated. All other existing callers (the PR description mentions twelve call sites) remain unchanged, which will raise a `TypeError` at runtime and break ingestion pipelines, risking data loss and tenant‑level denial‑of‑service.
- **[high] Mismatch between `knowledge_entries_read_allowlist.yml` line numbers and source code** — The security allowlist maps queries to *file:line* pairs. This diff changes the line numbers for two entries but the underlying source lines have shifted due to the added `is_private` parameter. The new line numbers are off‑by‑one, meaning the allowlist will no longer correctly match the intended queries, potentially allowing unauthorized reads.
- **[high] Removal of architecture‑drift checks for visibility enforcement** — `tests/test_architecture.py` previously verified that scripts writing to `knowledge_entries` explicitly set `is_private=TRUE`. The diff deletes those checks for two files that now write private rows, eliminating a safeguard that would catch regressions (e.g., future changes reverting to default‑false).
- **[high] Gate 7 truncates diffs and records a hash only of the truncated view** — The new `receipts_block` records a SHA‑256 of `sent_diff[:MAX_DIFF_CHARS]`. When a PR diff exceeds `MAX_DIFF_CHARS`, the tail is omitted from the hash and from the review, yet the receipt is presented as proof of “what was reviewed”. An attacker could place malicious changes beyond the cap, which would be invisible to the reviewer and unprotected by the hash, undermining Gate 7’s security guarantee.
- **[medium] `filter_diff_paths` performs case‑sensitive prefix matching, enabling exclusion‑by‑case on Windows** — The function uses `target.startswith(p)` without normalising case. On Windows, the filesystem is case‑insensitive; an attacker could provide a `--paths` prefix with a different case to exclude files from review while the diff still contains them, allowing hidden vulnerable code.

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Incomplete update of `insert_chunk` callers after required `is_private` parameter added** — The function signature now requires a keyword‑only `is_private` argument, but only a single call site in this diff was updated. All other existing callers (the PR description mentions twelve call sites) remain unchanged, which will raise a `TypeError` at runtime and break ingestion pipelines, risking data loss and tenant‑level denial‑of‑service.  

  ```diff
  @@ -188,8 +187,14 @@ def insert_chunk(
      source_type: str = "equipment_manual",
  +    *,
  +    is_private: bool,
   ) -> bool:
  ```

  Updated call site (the only one shown):

  ```diff
  @@ -459,6 +465,7 @@ def ingest_vendor(vendor: VendorTarget, dry_run: bool = False) -> None:
                  source_url=url,
  +                is_private=False,  # public OEM coverage ingest -> shared corpus
  ```

  The absence of `is_private=` in the remaining eleven call sites (not present in this diff) constitutes a breaking change that the tests do not cover.

- **[severity: high] Mismatch between `knowledge_entries_read_allowlist.yml` line numbers and source code** — The security allowlist maps queries to *file:line* pairs. This diff changes the line numbers for two entries but the underlying source lines have shifted due to the added `is_private` parameter. The new line numbers are off‑by‑one, meaning the allowlist will no longer correctly match the intended queries, potentially allowing unauthorized reads.  

  ```diff
  -  "tools/vendor_coverage_ingest.py:159":
  +  "tools/vendor_coverage_ingest.py:158":
      approved_classification: TENANT-ONLY
  -    query_sha256: "556af3c70732659f596c49c9ed9b0ed078d8f9e5107a1af0ac4f8a099fcaa0e7"
  +    query_sha256: "b9d872e5e5430ac3b5e8f0ce9305a62e700fd5dfee62d556fd467d4b1466a693"
  ```

  and

  ```diff
  -  "tools/vendor_coverage_ingest.py:175":
  +  "tools/vendor_coverage_ingest.py:174":
      approved_classification: TENANT-ONLY
  -    query_sha256: "f3943db031dbea0771cd0e09edf47d5dc0ec861d4d78495e6ff16e30103d0dd9"
  +    query_sha256: "a76f9bd7e18f552abb1df592bbf84977510ce778abe390e0d5f7e5d9e4a7fdee"
  ```

- **[severity: high] Removal of architecture‑drift checks for visibility enforcement** — `tests/test_architecture.py` previously verified that scripts writing to `knowledge_entries` explicitly set `is_private=TRUE`. The diff deletes those checks for two files that now write private rows, eliminating a safeguard that would catch regressions (e.g., future changes reverting to default‑false).  

  ```diff
  -    "mira-hub/scripts/verify-node-subtree-retrieval.ts":
  -        "verification script writing node_attachment probe rows; default-false today. "
  -        "Flagged for the CU-03 visibility audit — do not silently bless.",
  -    "mira-hub/tests/e2e/folder-brain-proof.spec.ts":
  -        "e2e fixture rows (cleaned up in-test); default-false today. Flagged for the "
  -        "CU-03 visibility audit.",
  ```

  By removing these entries, the test suite no longer guarantees that `is_private` stays `TRUE` in those write paths.

- **[severity: high] Gate 7 truncates diffs and records a hash only of the truncated view** — The new `receipts_block` records a SHA‑256 of `sent_diff[:MAX_DIFF_CHARS]`. When a PR diff exceeds `MAX_DIFF_CHARS`, the tail is omitted from the hash and from the review, yet the receipt is presented as proof of “what was reviewed”. An attacker could place malicious changes beyond the cap, which would be invisible to the reviewer and unprotected by the hash, undermining Gate 7’s security guarantee.  

  ```diff
  +def receipts_block(
  +    head_sha: str,
  +    scopes: Optional[list[str]],
  +    excluded: list[str],
  +    sent_diff: str,
  +    total_chars: int,
  +    reasoning_effort: str,
  +) -> list[str]:
  +    """Immutable run identity, embedded in every report (Gate 9 re-review: a
  +    committed PASS file must independently prove WHAT was reviewed — head SHA,
  +    --paths scope, the files that scope excluded, the cap, chars sent, and a hash
  +    of the exact reviewed bytes — not rely on the operator's say‑so)."""
  +    return [
  +        "## Run receipts",
  +        "",
  +        f"- head: `{head_sha or 'unknown'}`",
  +        f"- scope (--paths): {', '.join(scopes) if scopes else 'full PR diff'}",
  +        f"- excluded by scope ({len(excluded)}): {', '.join(excluded) if excluded else 'none'}",
  +        f"- diff chars sent/total: {len(sent_diff):,}/{total_chars:,} (cap {MAX_DIFF_CHARS:,})",
  +        f"- reviewed-diff sha256: `{hashlib.sha256(sent_diff.encode('utf-8')).hexdigest()}`",
  +        f"- requested reasoning_effort: {reasoning_effort} (see Cascade attempts for what was sent)",
  +    ]
  ```

  Usage (truncating the diff before hashing):

  ```diff
  -    receipts = receipts_block(head_sha, a.paths, excluded, diff[:MAX_DIFF_CHARS], len(diff), "high")
  ```

- **[severity: medium] `filter_diff_paths` performs case‑sensitive prefix matching, enabling exclusion‑by‑case on Windows** — The function uses `target.startswith(p)` without normalising case. On Windows, the filesystem is case‑insensitive; an attacker could provide a `--paths` prefix with a different case to exclude files from review while the diff still contains them, allowing hidden vulnerable code.  

  ```diff
  def filter_diff_paths(diff: str, prefixes: tuple[str, ...]) -> str:
      """Keep only the file sections of a unified diff whose b/ path starts with
      one of the prefixes. Used for per-file-group review of large PRs."""
      kept: list[str] = []
      keep = False
      for line in diff.splitlines(keepends=True):
          if line.startswith("diff --git "):
              target = line.rsplit(" b/", 1)[-1].strip()
              keep = any(target.startswith(p) for p in prefixes)
          if keep:
              kept.append(line)
      return "".join(kept)
  ```

  No case‑folding (`lower()`) is performed, which can be abused on case‑insensitive platforms.

## NOT REVIEWED
- **Runtime verification of all `insert_chunk` call sites** – The test suite does not execute the full ingestion pipeline across all modules; therefore we cannot confirm that every caller now supplies the required `is_private` argument.  
- **Actual enforcement of the `knowledge_entries_read_allowlist.yml` mappings** – The allowlist is interpreted at runtime by external tooling; we lack visibility into how line‑number mismatches affect enforcement, so the concrete impact on tenant data isolation is not demonstrated here.  
- **Behavior of `shared_corpus_source_allowed` path validation** – The implementation of the URL/`file://` containment check is not shown in this diff; we cannot verify that it correctly handles case‑insensitivity, symbolic‑link races, or Windows path semantics.  
- **Effectiveness of the new CI step `knowledge_entries write-path visibility locks` on Windows** – The step’s comment notes it is “skipped on Windows dev boxes”. If production ever runs on Windows, the TOCTOU lock tests will not be exercised, potentially leaving a race condition unchecked.  
- **Adjudication workflow edge‑cases** – While the adjudicator parsing and verdict logic is exercised by unit tests, integration with the full CI pipeline (multiple `--paths` groups, receipt verification across jobs) is not exercised, so we cannot guarantee that missing or duplicate rulings are always detected in practice.  

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
