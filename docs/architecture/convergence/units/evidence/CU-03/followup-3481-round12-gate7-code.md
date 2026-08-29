# Gate 7 adversarial review — PR #3481

**Verdict:** UNKNOWN · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, canonical asset identity, tenant scoping, cross-repository contract, deletion/destructive, forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `e5f18a19f8be7fad841c79ec4f101d7e15145147`
- scope (--paths): mira-crawler/, tests/, .github/, tools/
- excluded by scope (102): docs/architecture/convergence/units/CU-03.md, docs/architecture/convergence/units/evidence/CU-03/README.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round10-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round11-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round2-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round3-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round4-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round5-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs-attempt1-truncated.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round6-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-code-explain-pg16.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round7-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code-attempt1-malformed.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round8-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-code-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-docs-rebuttal.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-code.stderr.log, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.md, docs/architecture/convergence/units/evidence/CU-03/followup-3481-round9-gate7-docs.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-adjudication.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.md, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-final-head.stderr.log, docs/architecture/convergence/units/evidence/CU-03/round-12-groupA-rebuttal.md
- diff chars sent/total: 79,004/79,004 (cap 90,000)
- reviewed-diff sha256 (sent bytes): `6372d712a1d7787e2ba4bb805171c1adbe71e827e2a33672c1d8d1f8b16cf666`
- full scoped-diff sha256 (pre-cap): `6372d712a1d7787e2ba4bb805171c1adbe71e827e2a33672c1d8d1f8b16cf666`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

_No structured findings parsed — see the raw review below._

## Raw review

**Gate 7 Independent Adversarial Review – CU‑03 “Round‑10 Group A” Follow‑up**  
**Repository:** `mira‑crawler` (and the gate‑7 tooling)  
**Reviewer:** Gate 7 independent reviewer – no stake in landing  

---

## TL;DR – What broke (or will break) after this PR

| Area | Symptom | Why it matters | Evidence |
|------|---------|----------------|----------|
| **Duplicate rows in `knowledge_entries`** | `chunk_exists` and `ingested_source_urls` will *miss* historical rows that differ only in scheme/host case, causing the next ingest to create a *second* row for the same logical origin. | The dedup key (`tenant_id, source_url, chunk_index`) is defined as a **case‑sensitive** unique index. Duplicates violate the guarantee that a given origin+chunk is stored at most once, leading to data bloat, possible divergent visibility flags, and eventual violation of the unique index when a later migration tries to clean it up. | See analysis of `canonical_source_url` + `chunk_exists` (lines 41‑57 in `store.py`). The query only checks `(source_url = :url OR source_url = :raw)`. If the caller supplies the *canonical* spelling, `:url` and `:raw` are identical, so a historical row stored with a *different* case (e.g. `HTTPS://EXAMPLE.COM/...`) is **not** matched. |
| **`ingested_source_urls` false‑negatives** | The helper that tells the ledger “has this URL landed?” will not recognise a historical row when the caller provides the canonical spelling. | The ingestion pipeline uses this helper to decide whether a URL needs to be re‑queued. A false‑negative will cause the same document to be re‑ingested, creating duplicate rows (the same issue as above) and extra work. | `ingested_source_urls` builds `lookup = sorted({*asked, *(canonical_source_url(u) for u in asked)})`. When `asked` already contains the canonical spelling, the set collapses to a single value, never includes the historic mixed‑case variant. |
| **Empty‑diff abort on evidence‑only PRs** | `main()` now aborts with `error: nothing left to review after excluding evidence artifacts` (exit 1) if the only changes are under `docs/.../units/evidence/`. | Evidence artifacts are meant to be *excluded* from review, but a legitimate PR that updates only those artifacts (e.g. fixing a stale log or updating a reviewer‑generated README) should still be accepted as a **PASS**. Treating it as a hard failure blocks the CI pipeline for a perfectly valid change. | The guard is at line 84‑92 of `main()` after `diff, artifacts = drop_evidence_artifacts(diff)`. No test covers this path. |
| **Potential secret leakage via `--include‑evidence`** | The new flag allows the raw evidence artifacts (often containing unredacted logs) to be sent to the LLM. The flag is not highlighted as a security‑sensitive option. | If a reviewer (or an automated script) enables the flag, secrets that appear only inside those logs will bypass the existing `redact()` step and be exposed to the model, violating the “no‑secret‑leak” policy. | Flag added at line 71‑78 of `tools/gate7_review.py`; no warning or documentation change to stress the risk. |
| **`pr_kind` now treats `.log` as documentation** | Adding `.log` to `_DOC_SUFFIXES` changes the classification of any log file change from “code” to “documentation”. | Many internal tools use `.log` files as generated artefacts that are not meant to affect the “kind” decision. A PR that adds a new `.log` file for debugging will now be classified as “partly documentation”, triggering the “READ BEFORE YOU DECIDE” reminder and potentially causing a “BLOCK” where a “PASS” was intended. | Change at line 270‑273 of `tools/gate7_review.py`. No regression test for a PR that adds a single `.log` file only. |
| **`decision_point_reminder` appears before “Output STRICT”** (intended) **but is not excluded for “code” PRs** | The reminder is omitted for `kind == "code"`, however the *mixed* case still injects a multi‑hundred‑character block before the output shape. Some downstream tooling (e.g. the cascade provider) expects the output to start *immediately* after the “Output STRICT” line; the extra block may be counted as part of the “prompt” and cause token‑budget overruns. | The cascade provider’s max‑token limit is already tight (24000/32000). Adding a ~1 kB reminder for every mixed PR can push the prompt over the limit, leading to truncated model responses and false‑negative “PASS” results. | No test asserts that the total token count stays under the limit when the reminder is present. |

---

## Detailed Findings

### 1. `canonical_source_url` + `chunk_exists` – duplicate rows

* **Implementation** – `chunk_exists` (store.py 41‑57) runs:

```sql
SELECT COUNT(*) FROM knowledge_entries
WHERE tenant_id = :tid
  AND (source_url = :url OR source_url = :raw)
  AND metadata->>'chunk_index' = :idx
```

* **Problem** – When the caller supplies the *canonical* form (scheme/host lower‑cased), `:url == :raw`. Historical rows that were written before the canonicalisation step keep the *original* casing (e.g. `HTTPS://EXAMPLE.COM/foo.pdf`). Those rows are *not* matched, because the query never asks for the alternative casing.

* **Consequence** – A recrawl that now supplies the canonical URL will see `COUNT = 0` → `INSERT` → a *second* row with the same logical origin but different `source_url`. The unique index (`idx_ke_chunk_dedup`) will treat them as distinct, violating the dedup contract (F1) and potentially allowing a later `DO UPDATE` to expose private content (F1 → F2 regression).

* **Missing Test** – Only the “reverse” case (raw → canonical) is exercised (`test_lookup_also_matches_a_historical_row_stored_in_the_callers_spelling`). The *forward* case (canonical → raw) is **not** covered.

* **Suggested Fix** – Make the existence check case‑insensitive for scheme and host, e.g.:

  ```sql
  SELECT COUNT(*) FROM knowledge_entries
  WHERE tenant_id = :tid
    AND (
      LOWER(split_part(source_url, '://', 1)) = LOWER(split_part(:url, '://', 1))
      AND LOWER(split_part(split_part(source_url, '://', 2), '/', 1)) =
          LOWER(split_part(split_part(:url, '://', 2), '/', 1))
      OR source_url = :url
    )
    AND metadata->>'chunk_index' = :idx;
  ```

  Or, more simply, store a *canonical* column (e.g. `source_url_canonical`) and index on that. Until a migration is in place, the query should at least include `canonical_source_url(:url)` as a second bound value and compare against it.

* **Immediate mitigation** – Add a fallback `OR source_url = :canonical` where `:canonical = canonical_source_url(:url)`. This will catch the opposite‑case scenario without a full migration.

### 2. `ingested_source_urls` – false‑negative ledger probe

* **Implementation** – Lines 374‑383 construct `lookup = sorted({*asked, *(canonical_source_url(u) for u in asked)})` and then query `WHERE source_url = ANY(:urls)`. If the caller already supplies the canonical spelling, the set collapses to a single entry and never includes the historic mixed‑case variant.

* **Problem** – The ledger will answer “not ingested” for a URL that *is* already stored with a different case, prompting the crawler to enqueue it again (duplicate rows again).

* **Missing Test** – No test verifies that `ingested_source_urls` returns the caller’s URL when the DB contains a mixed‑case row.

* **Suggested Fix** – Always query for *both* the raw and canonical forms **regardless** of whether they are identical, e.g.:

  ```python
  lookup = sorted({*asked, *(canonical_source_url(u) for u in asked), *(raw_case_variant(u) for u in asked)})
  ```

  where `raw_case_variant` could be the original case‑preserving string (if known) or simply the result of `canonical_source_url` with the scheme/host re‑upper‑cased (a cheap `upper()` on those components). The safest route is to add a functional index on `LOWER(host)`, `LOWER(scheme)` and query with `ILIKE`.

### 3. Empty‑diff abort after evidence‑artifact exclusion

* **Implementation** – Lines 84‑92 in `main()`:

```python
if not diff.strip():
    print("error: nothing left to review after excluding evidence artifacts", file=sys.stderr)
    return 1
```

* **Problem** – If a PR **only** changes files under `docs/.../units/evidence/` (e.g. a reviewer wants to update a stale log file or a generated README), the gate exits with status 1, marking the CI run as failed. The PR never gets a PASS/FAIL verdict, contradicting the contract that **every** PR should receive a definitive gate verdict.

* **Missing Test** – No test exercises a diff consisting solely of evidence artifacts.

* **Suggested Fix** – Treat “nothing left to review” as a **PASS** with a note that the PR contained only evidence artifacts:

```python
if not diff.strip():
    print("Gate 7: diff contains only evidence artifacts – automatically PASS", file=sys.stderr)
    verdict = "PASS"
    # construct a minimal prompt (or skip the LLM entirely) and exit 0
```

### 4. Security impact of `--include-evidence`

* **Implementation** – Flag added at lines 71‑78; when set, `drop_evidence_artifacts` is skipped.

* **Problem** – Evidence artifacts are **raw** reviewer/adjudicator output and lane stderr logs. Those logs often contain IPs, MAC addresses, API keys, or other secrets that the generic `redact()` step may not cover (it only looks for patterns like “IP/MAC/SN”). By enabling the flag you open a path for secret leakage to the LLM.

* **Missing Test / Documentation** – No test verifies that secrets inside an evidence artifact are redacted when the flag is on, nor does the CLI help text warn about the security risk.

* **Suggested Fix** – Either:

  1. **Remove** the flag entirely (evidence should always be excluded), or  
  2. **Make** the flag *dangerous* and require an explicit `--allow‑secret‑leakage` acknowledgment, or  
  3. **Add** a warning in the `--help` output and in the brief (`decision_point_reminder`) that enabling this flag may expose secrets.

### 5. `.log` files now count as documentation (`_DOC_SUFFIXES`)

* **Implementation** – Lines 270‑273 add `".log"` to `_DOC_SUFFIXES`.

* **Problem** – A PR that adds a single `.log` file (e.g. a build artifact committed accidentally) will be classified as `documentation` → `mixed` (if code files are also present) → the gate will inject the long “READ BEFORE YOU DECIDE” reminder. This inflates the prompt and may push the model over the token budget (see point 6). Moreover, the semantics of “documentation” are blurred: logs are generated artefacts, not human‑authored docs.

* **Missing Test** – No test verifies that a PR consisting only of a new `.log` file yields the expected kind and verdict.

* **Suggested Fix** – Keep `.log` out of `_DOC_SUFFIXES` and instead treat logs as a *separate* category (e.g. `_LOG_SUFFIXES`). If they must be counted as documentation for the “evidence artifact” contract, handle that in the evidence‑artifact detection logic, not in the generic `pr_kind` heuristic.

### 6. Prompt token‑budget regression introduced by the reminder

* **Implementation** – `decision_point_reminder` inserts a ~1 kB block for every non‑code PR (mixed or documentation).

* **Problem** – The cascade provider is called with `max_tokens=24000` for normal runs. Adding ~1 kB of static text reduces the space for the actual diff and model reasoning. For large diffs that are already near the limit, this pushes the request over the limit, causing the provider to truncate the diff early or return an error, which the gate treats as “PASS” (see `call_cascade` handling). This silently masks real defects.

* **Missing Test** – No test checks that the total prompt size stays under the provider’s limit when the reminder is present.

* **Suggested Fix** – Make the reminder **conditional** on diff size: only include it if `len(diff) + len(reminder) < MAX_TOKENS_ALLOWANCE`. Alternatively, move the reminder **outside** the LLM prompt (e.g. in the CI logs) and keep the prompt minimal.

---

## Additional Regression‑Testing Gaps

| Gap | Why it matters | Suggested test |
|-----|----------------|----------------|
| **Case‑insensitive lookup of historical rows** | Duplicate rows & ledger false‑negatives (see points 1 & 2). | Write a test that pre‑populates `knowledge_entries` with an uppercase‑scheme row, then calls `store.chunk_exists` with the canonical lowercase URL and asserts `True`. |
| **`ingested_source_urls` with mixed‑case DB rows** | Same duplication problem for the ingestion ledger. | Populate DB with `"HTTPS://EXAMPLE.COM/foo.pdf"` and ask `ingested_source_urls(["https://example.com/foo.pdf"], tenant_id="t")`; assert the result contains the original URL. |
| **Evidence‑only PR handling** | CI should not crash on a docs‑only evidence change. | Build a diff that only contains `diff --git a/docs/architecture/.../units/evidence/file.md b/docs/.../units/evidence/file.md` and run `gate7_review.main()`; expect exit 0 and verdict PASS. |
| **Secret leakage with `--include-evidence`** | Security policy breach. | Create a fake evidence log containing `API_KEY=SECRET123`, run with `--include-evidence`, and assert that the string `SECRET123` never reaches the provider (mock the provider and inspect the prompt). |
| **`.log`‑only PR classification** | Prevent unnecessary reminder injection. | Create a diff that adds a single `debug.log` file, run the gate, and assert `kind == "documentation"` (or “code” if that is the desired semantics) and that the reminder block is absent. |
| **Prompt length with reminder** | Avoid token‑budget overruns. | Generate a synthetic diff just under the limit, enable a mixed‑kind PR, and assert that `len(prompt) <= 24000` (or the provider’s max). |
| **`--paths` scope notice correctness** | Ensure the notice only appears when a non‑empty `excluded` list exists. | Run the gate with `--paths docs/` on a diff that *does* include out‑of‑scope files, verify the notice appears; run with a diff where all files are in‑scope, verify the notice is omitted. |

---

## Recommendations & Action Items

1. **Fix the duplicate‑row bug** – Update `chunk_exists` and `ingested_source_urls` to *always* query the canonical form *in addition* to the raw input, regardless of whether they are identical. Prefer a DB‑level functional index on lower‑cased scheme+host, or store a separate `source_url_canonical` column and use it for look‑ups.

2. **Graceful handling of evidence‑only diffs** – Change the “nothing left to review” guard to emit a PASS verdict (or skip the LLM altogether) instead of exiting with error 1.

3. **Document and protect the `--include-evidence` flag** – Add a conspicuous warning to the CLI help and to the prompt (e.g. “⚠️ Including evidence artifacts may expose secrets – use only for debugging”). Consider making the flag hidden or removing it altogether.

4. **Re‑evaluate `.log` as documentation** – If logs truly belong to the “documentation” bucket, treat them in the evidence‑artifact logic only, not in the generic `pr_kind` heuristic. Add a dedicated test case for a pure‑log PR.

5. **Make the reminder size‑aware** – Either trim it when the diff is large, or move it out of the LLM prompt (e.g. emit as a CI log message) to preserve token budget.

6. **Add the missing regression tests** (see the table above) to the test suite; ensure they run under both `xhigh` and normal modes.

7. **Update the documentation** – Reflect the new behaviour of canonicalisation, evidence‑artifact handling, and the scope‑notice in `README.md` and in the gate‑7 design docs.

8. **Run a migration audit** – Because historical rows will now have mixed case, schedule a one‑off migration that rewrites `source_url` to the canonical form and deduplicates rows before the unique index is enforced for future inserts.

---

## Final Verdict

**BLOCK** – The changes introduce a regression that defeats the core dedup guarantee (F1) and can cause silent data duplication, false‑negative ledger checks, and CI failures on evidence‑only PRs. Additionally, the new `--include-evidence` flag creates a security‑sensitive surface that is undocumented. Until the above defects are addressed and the missing regression tests are added, this PR must **not** be merged.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
