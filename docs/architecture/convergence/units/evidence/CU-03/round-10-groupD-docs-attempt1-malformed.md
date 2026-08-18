# Gate 7 adversarial review — PR #3268

**Verdict:** BLOCK · **Effort:** xhigh · **Reviewer:** groq (openai/gpt-oss-120b)
**Escalation triggers:** database/schema, authorization, tenant scoping, security boundaries, cross-repository contract, deletion/destructive, concurrency/idempotency/state, broad multi-module (9 top-level dirs), forced by --xhigh

> Independent = different vendor + fresh context + a brief to disprove. NOT a second
> human, and the reviewer did not run the tests. Gate 7 is one check of eleven.

## Run receipts

- head: `2655e69863cb47dbc128dee1d5ea864cc40d5e50`
- scope (--paths): docs/
- excluded by scope (28): .claude/commands/gate7-review.md, .github/workflows/ci.yml, mira-bots/tools/learning_ingester.py, mira-core/scripts/ingest_equipment_photos.py, mira-crawler/crawler/base_crawler.py, mira-crawler/ingest/store.py, mira-crawler/main.py, mira-crawler/tasks/_shared.py, mira-crawler/tasks/full_ingest_pipeline.py, mira-crawler/tasks/ingest.py, mira-crawler/tasks/manualslib_scraper.py, mira-crawler/tasks/patents.py, mira-crawler/tasks/playwright_crawler.py, mira-crawler/tasks/reddit.py, mira-crawler/tasks/youtube.py, mira-crawler/tests/test_celery_tasks.py, mira-crawler/tests/test_ingest.py, mira-crawler/tests/test_manufacturer_normalize.py, mira-crawler/tests/test_oem_trust.py, mira-crawler/tests/test_store_verified.py, mira-crawler/tests/test_write_path_visibility.py, mira-hub/scripts/verify-node-subtree-retrieval.ts, mira-hub/tests/e2e/folder-brain-proof.spec.ts, tests/test_architecture.py, tests/test_gate7_review.py, tools/gate7_review.py, tools/qa/security/knowledge_entries_read_allowlist.yml, tools/vendor_coverage_ingest.py
- diff chars sent/total: 159,587/159,587 (cap 165,000)
- reviewed-diff sha256: `65fa232b13907b7c843558df9f77a3015aacee504b0c560251a782267f5eb59d`
- requested reasoning_effort: high (see Cascade attempts for what was sent)

## Findings

_No structured findings parsed — see the raw review below._

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[high] Security hardening not applied – code changes missing** — The PR description claims that the critical security fixes (I‑1: required `is_private` keyword on `insert_chunk`/`store_chunks`/`ingest_text_inline`; I‑2: `ingest_url` now validates URLs against `sources.yaml`; I‑3: `learning_ingester` rows are forced private) have been implemented. However, the diff only modifies documentation files under `docs/…`. No files in `mira‑crawler/`, `mira‑bots/`, `mira‑hub/`, or any `tests/` directory are changed. Consequently the vulnerabilities remain unaddressed in the code base.  
  **Diff evidence:**  
  ```diff
  diff --git a/docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md b/docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md
  index d10e7de00..9777f02f7 100644
  --- a/docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md
  +++ b/docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md
  ```
  (Only documentation files are touched; there is no `mira-crawler/ingest/store.py`, `tasks/ingest.py`, `learning_ingester.py`, etc. in the change.)

- **[high] Test suite not updated – missing test files** — The PR narrative repeatedly references “16 red‑first behavior locks”, “new tests”, and a “test‑locked CI step”. Yet the diff adds no new or modified test files (`tests/…`). All new files are under `docs/…` (e.g., evidence logs). Without the promised tests the Gate 7 “red‑first proof” cannot be verified, leaving the security hardening unexercised.  
  **Diff evidence:**  
  ```diff
  diff --git a/docs/architecture/convergence/units/evidence/CU-03/round-1-crash.log b/docs/architecture/convergence/units/evidence/CU-03/round-1-crash.log
  new file mode 100644
  index 000000000..13bc37c42
  --- /dev/null
  +++ b/docs/architecture/convergence/units/evidence/CU-03/round-1-crash.log
  ```
  (All added files are documentation/evidence; there is no `tests/test_write_path_visibility.py` or any other test file in the diff.)

- **[high] Inconsistent gate status – documentation claims PASS while evidence logs show BLOCK** – The newly added `CU-03.md` states “Gate 7 PASS (adjudicated …)”, yet the attached evidence files (`round‑3-full-diff.md`, `round‑4-full-diff.md`) each record a **BLOCK** verdict. This discrepancy suggests that the documentation is out‑of‑sync with the actual review outcome, potentially misleading downstream reviewers into thinking the findings have been resolved when they have not.  
  **Diff evidence (status claim):**  
  ```diff
  +**Status:** implemented — Gate 9 round-3 **NO‑GO findings fixed**; the round-9 adjudicated
  +"PASS" is **VOID** (see Gate 9 round 3 below) — awaiting fresh Gate 7 round 10 on the new
  +head, then Gate 9 human GO
  ```
  **Diff evidence (BLOCK outcome):**  
  ```diff
  +# Gate 7 adversarial review — PR #3268
  +
  +**Verdict:** BLOCK
  ```

- **[medium] Evidence truncation hides potential defects** — Several evidence markdown files note that the diff sent to the LLM was truncated at 40 k characters (e.g., `round‑3-full-diff.md`). If critical security‑relevant code changes or findings reside beyond the truncation point, they are invisible to the reviewer, creating a structural blind spot.  
  **Diff evidence:**  
  ```diff
  +Gate 7: sending 40,000/52,620 diff chars to a third‑party provider (redacted: IP/MAC/SN) � TRUNCATED
  ```

- **[low] Missing schema migration for new `is_private` column** — The PR asserts “no schema change”, yet the described security fix requires a non‑nullable `is_private` column on `knowledge_entries`. If the column does not already exist with an appropriate default, the migration is missing, which could cause runtime DB errors or silently fall back to the old default (`false`), re‑introducing the leak. This risk is not demonstrated in the diff.  
  **Diff evidence (claim of no schema change):**  
  ```diff
  +- **Risk:** medium-high (tenancy-adjacent) → **Gate 7 xhigh**, human GO. Not a pilot candidate for exactly that reason.
  +- **Status:** implemented … **No schema change**
  ```

## NOT REVIEWED
- **Runtime behavior of the actual security code** – Because no source files (`store.py`, `ingest.py`, `learning_ingester.py`, etc.) are present in the diff, we cannot verify that the required `is_private` parameter is enforced at runtime, that `shared_corpus_source_allowed` correctly validates `sources.yaml`, or that the `file://` carve‑out is properly sandboxed.

- **Database schema state** – Without a migration diff we cannot confirm the presence, nullability, or default of the `is_private` column, nor any row‑level security policies that may be required.

- **Downstream read‑path enforcement** – The PR mentions no changes to read‑side contracts; we cannot confirm that private rows are correctly filtered for tenants.

- **Interaction with external scripts or third‑party tools** – Any existing scripts that call `insert_chunk`/`store_chunks` directly (outside the repo’s Python code) may still lack the new argument, but we cannot see them.

- **Observability / logging** – The diff does not add any log statements or metrics for gate failures; we cannot assess whether failures will be monitored.

- **Platform‑specific path handling** – The `file://` validation may behave differently on Windows vs. POSIX; without code we cannot confirm correct handling of case‑insensitivity, drive letters, or UNC paths.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
