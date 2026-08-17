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

- **[high] Missing implementation of promised security changes** — The PR description states that the write‑path functions `insert_chunk`, `store_chunks`, and `ingest_url` were hardened (required `is_private` kw‑only argument, URL curation via `sources.yaml`, `file://` restriction) and that `learning_ingester` rows were made private. However, the diff contains **only documentation modifications** and does **not modify any source files** (`*.py`, `*.ts`, `*.sql`). Consequently the high‑risk I‑1, I‑2, and I‑3 vulnerabilities remain unaddressed.

## Raw review

## VERDICT
BLOCK

## FINDINGS
- **[severity: high] Missing implementation of promised security changes** — The PR description states that the write‑path functions `insert_chunk`, `store_chunks`, and `ingest_url` were hardened (required `is_private` kw‑only argument, URL curation via `sources.yaml`, `file://` restriction) and that `learning_ingester` rows were made private. However, the diff contains **only documentation modifications** and does **not modify any source files** (`*.py`, `*.ts`, `*.sql`). Consequently the high‑risk I‑1, I‑2, and I‑3 vulnerabilities remain unaddressed.

  ```diff
  diff --git a/docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md b/docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md
  index d10e7de00..9777f02f7 100644
  --- a/docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md
  +++ b/docs/architecture/FACTORYLM_MIRA_ARCHITECTURE_CONVERGENCE.md
  @@ -343,6 +343,20 @@ Invoke with `py tools/gate7_review.py <PR>` (see `.claude/commands/gate7-review.
  +> **Amended 2026-08-16 (CU-03 Gate 9 round 2, owner-directed calibration).** A Gate 7
  +> **BLOCK has no Gate 9 waiver.** It is resolved only by (a) fixing the finding at the
  +> root and re‑running, or (b) the **adjudication step**: the author files a per‑finding
  +> rebuttal quoting verbatim evidence; a fresh lane call
  +> (`py tools/gate7_review.py <PR> --adjudicate <prior-report> --rebuttal <file>`)
  +> rules each finding **SUSTAINED or REFUTED** strictly on that evidence, and the
  +> round's verdict is computed **structurally** from the rulings — any sustained high ⇒
  +> BLOCK, and an unruled finding cannot pass. A fabricated finding cannot survive
  +> confrontation with quoted evidence; a real one cannot be refuted by it. **Both
  +> phases' full outputs are preserved intact as unit evidence** (summaries do not
  +> satisfy the evidence requirement). For diffs past the reviewer's char cap, review
  +> per file group (`--paths`) — every group needs its own PASS and every excluded file
  +> must be covered by another group.
  diff --git a/docs/architecture/convergence/BACKLOG.md b/docs/architecture/convergence/BACKLOG.md
  index 8c51e9222..a95e97b5f 100644
  --- a/docs/architecture/convergence/BACKLOG.md
  +++ b/docs/architecture/convergence/BACKLOG.md
  @@ -48,6 +48,7 @@
   - `store.py::insert_chunk` gains a required `is_private` parameter (no silent default); `ingest_url` validates against `sources.yaml` before shared-corpus writes; audit `learning_ingester.py` visibility.
   - Behavior-lock first: tenant-scoping tests asserting today's exact write shapes (OEM public, uploads private) before touching the code.
   - **Risk:** medium-high (tenancy-adjacent) → **Gate 7 xhigh**, human GO. Not a pilot candidate for exactly that reason.
  +- **Status: implemented 2026-08-16 — PR #3268, Gate 7 PASS (adjudicated — the lane's first; per-group review → quoted rebuttal → adjudication, evidence intact in `units/evidence/CU-03/`), awaiting Gate 9 GO.** Calibration was owner-directed at Gate 9 round 2: the lane gained `--paths` / `--diff-cap` / the adjudication step (doctrine §Gate 7 amendment — no Gate 9 waiver exists). I-1: `insert_chunk`/`store_chunks`/`ingest_text_inline` require keyword-only `is_private`, all call sites explicit. I-2: `shared_corpus_source_allowed()` sources.yaml gate in `ingest_url` (fail-closed; `file://` operator carve-out). I-3 audit verdict: learning_ingester → `is_private=true` (no prod wiring; conversation-derived). CU-03-flagged Contract 13 allowlist entries closed (both Hub TS files now pin TRUE inline). New findings filed: **#3269** (ingest_text_inline sibling gate gap), **#3270** (test_celery_tasks stale mocks, not in CI). Gate walk in `units/CU-03.md`.
  diff --git a/docs/architecture/convergence/units/CU-03.md b/docs/architecture/convergence/units/CU-03.md
  new file mode 100644
  index 000000000..5e7bfc9a6
  --- /dev/null
  +++ b/docs/architecture/convergence/units/CU-03.md
  @@ -0,0 +1,489 @@
  +# Convergence Unit — CU-03: knowledge_entries write-path hardening (I-1..I-3)
  +...
  ```

  The lack of any `*.py` (or other code) modifications directly contradicts the security hardening claims, leaving the original high‑severity leaks (hard‑coded `is_private=false`, unrestricted `file://` ingestion, uncurated URL writes) unchanged.

## NOT REVIEWED
- **Actual source‑code changes** to `mira-crawler/ingest/store.py`, `mira-crawler/tasks/ingest.py`, `mira-bots/tools/learning_ingester.py`, and related modules – not present in the diff, so we cannot verify whether the required `is_private` kw‑only argument was added, whether `shared_corpus_source_allowed` now enforces the `sources.yaml` whitelist, or whether the learning‑ingester visibility was flipped.
- **Database schema migrations** for the `knowledge_entries.is_private` column – no migration files appear in the diff; we cannot confirm the column exists, is NOT NULL, or has appropriate defaults.
- **Runtime behavior** of the new URL validation (case‑insensitive host matching, redirect handling, TOCTOU race on `file://` validation) – implementation details are absent, preventing assessment of potential security bypasses.
- **Test suite changes** – the PR mentions new red‑first tests (`test_write_path_visibility.py`, etc.), but the test files themselves are not part of the diff, so we cannot verify that they actually cover the new security gates or that they are correctly integrated into CI.
- **Observability / logging** for gate failures – no modifications to logging or monitoring are visible; we cannot determine whether failures (e.g., uncurated URL refusals) are auditable.
- **Impact on external callers** – the required `is_private` argument is a breaking API change; without seeing all call sites (including scripts, third‑party plugins, or future extensions) we cannot ensure backward compatibility.
- **Cross‑repository contracts** – potential raw‑SQL writers that bypass the Python seam are mentioned in the narrative, but no raw‑SQL files are changed; we cannot confirm that all such writers enforce the new visibility rule.

## Cascade attempts

- `groq: ok (reasoning_effort=high)`
