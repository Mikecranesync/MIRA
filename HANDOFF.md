# HANDOFF — Technician Beta Recovery, Workstream B

**Date:** 2026-08-29
**Branch:** `codex/technician-beta-recovery-b` (worktree `C:/Users/hharp/.codex/worktrees/technician-beta-recovery-b`)
**Base:** `origin/main` @ `4a695bf311241ec4e2b9d0a269a3630ff7477bcd` (Workstream A merged as #3468 fix)
**PRD:** `docs/prd/2026-08-29-technician-beta-recovery-prd.md` §8 (delivery-sequence PR 2)
**Scope delivered:** Workstream B only. Workstreams C–E untouched. No merge, deploy, dispatch, production call, Doppler read, or SQL against any shared environment happened in this session.
**Status:** GREEN for the offline/disposable-DB slice; the staging lane runs on the PR (CI provisions it). Human gates: PR review + merge (Mike); production probe dispatch + QA-tenant secrets (Mike).

---

## 1. Root cause / why the old gate was not production-equivalent

- `beta-gate.yml` proved the **NodeChat** `/files/` door with the **shared GS10 fixture** and inherited whatever `MIRA_ENFORCE_APPROVED_RETRIEVAL` staging happened to have. Under the production flag the NodeChat route keeps the legacy `verified = true` rule (`namespace/node/[id]/chat/route.ts:327` filters `chunk.verified === true`), so that lane could not exercise — or catch — the #3437/#3468 defect at all.
- The behaviour production depends on is the **notebook** contract (`equipment-notebooks/[id]/chat` → `validateChatSources` → `retrieveNodeChunks({approvedSourceDocIds})`), where confirmed tenant-private chunks stay `knowledge_entries.verified=false` and are admitted only through the server-derived confirmed set (Workstream A).
- The health door had no non-secret way to say which gate is effective (#3328 class), so nothing could *assert* the flag.

## 2. Design (smallest coherent diff)

| File | Change |
|---|---|
| `tests/beta/_notebook_probe.py` | **One reusable probe** (library + CLI). Public Hub APIs only, in mobile's order: `GET /api/health/` (gate must be enforced) → `POST /api/equipment-notebooks/` → grounded chat with **no sources → `422 no_sources_selected`** (pre-upload, provider-free) → `POST /api/namespace/node/{nodeId}/files/` with a **run-unique, runtime-generated 2-page PDF** (pure-python writer, sentinel `QZxxxxxx` + value on page 2) → `POST …/sources/` (attach = `user_confirmed`, the product's confirmation) → **poll** `GET /api/equipment-notebooks/{id}/` until `sources[].readiness.canChat` (contract, no fixed sleep) → sentinel question → judge: `answered`, ≥1 citation, **every** citation `docId == run upload id**, sentinel page (2) cited, sentinel value in the answer, `usage.provider`/`model` non-null → `GET …/passage/?page=2` carries the sentinel (passage identity) → unsupported question (vocabulary disjoint from the document) → judge: `insufficient_evidence`, zero citations, **no usage frame** (provider-free) → cleanup **only** the run's notebook/upload/file via `DELETE`, even after failure. Redacted JSON evidence + per-step timings. DRY-RUN (exit 0, zero requests) unless hub base + auth are present. Signs in with an *existing* login when given email/password; never registers. |
| `tests/beta/beta_ready_notebook_confirmed_source.py` | The pytest release-gate entry; skips without `BETA_PROBE_*`. |
| `tests/beta/test_notebook_probe.py` | 23 offline tests pinning the judge + flow (see §3). |
| `mira-hub/src/app/api/health/route.ts` (+ `__tests__/route.test.ts`) | Additive non-secret field `approvedRetrievalEnforced` = `MIRA_ENFORCE_APPROVED_RETRIEVAL === "true"` (the exact boolean `manual-rag.ts` reads). Lets CI and the prod probe **assert** the effective gate. |
| `mira-hub/scripts/provision-beta-gate.ts` | Emits `BETA_PROBE_HUB_BASE`/`BETA_PROBE_COOKIE` for the new lane; `--cleanup` (staging sweep, tenant-scoped by the run's own tenant id) now also removes notebook-lane tables, skipping absent tables/columns. |
| `.github/workflows/beta-gate.yml` | Legacy job **unchanged**. New job **`notebook-gate`**: builds the Hub, starts it with **explicit** `MIRA_ENFORCE_APPROVED_RETRIEVAL=true MIRA_CANONICAL_SEAM=1`, asserts `/api/health/.approvedRetrievalEnforced == true` before anything else, provisions a fresh stranger tenant + credentials per run, runs the gate, sweeps only that tenant, uploads **redacted** Hub log + probe report on failure. New job **`admission-regression`** (no secrets, `postgres:16` service): the Workstream A integration suite under the flag — RED the moment the admission predicate is reverted. New dispatch input **`prove_regression`** reverts the predicate in the built Hub and *requires* the notebook lane to FAIL (§8.4 exit-gate proof, never merges anything). Path filters extended to the notebook routes + health. Line 49 (`actions/checkout@v6`) untouched — Dependabot #2251's hunk rebases mechanically. |
| `.github/workflows/beta-probe-prod.yml` | Manual-only (`workflow_dispatch`; no schedule, no `workflow_run`). Inert unless **`execute: true` (boolean, default false) AND both `BETA_PROBE_QA_EMAIL`/`BETA_PROBE_QA_PASSWORD` secrets** exist on the `production` environment; otherwise `--dry-run` sends nothing. Public app APIs only; evidence artifact retained 30 days. States in output that Mike owns dispatch + credentials. |
| `tests/beta/README.md` | File table updated. |

Deliberate interpretation: on the notebook contract, "grounded ask with nothing attached" is `422 no_sources_selected` (structured, no provider, nothing persisted) — the probe requires exactly that pre-upload, and requires a **200 SSE `insufficient_evidence` with no usage frame** for the post-confirmation unsupported question. A pre-upload turn that *answers* fails the lane before any upload happens.

## 3. Red → green evidence

**Probe unit tests (RED before implementation):**
```
ModuleNotFoundError: No module named 'tests.beta._notebook_probe'   (1 error during collection)
```
**GREEN:** `python -m pytest tests/beta/test_notebook_probe.py tests/beta/test_gate_harness.py tests/beta/test_gate_sources.py tests/beta/beta_ready_notebook_confirmed_source.py --confcutdir=tests/beta -q` → `38 passed, 1 skipped` (the skip = the live gate without env, by design).

**Deterministic regression (disposable Postgres 16, gate ON) — the §8.4 shape:**
- fix present: `approved-source-admission.integration.test.ts` → `10 passed (10)`
- admission predicate reverted locally (`approvedSourceFilterSql` → `approvalFilterSql()`): → `9 failed | 1 passed (10)` (cases 1–9 red; only "no approved set ⇒ legacy rule" stays green)
- restored: `10 passed (10)`; `git diff --stat mira-hub/src/lib/manual-rag.ts` → empty (byte-identical to main).

**Health route:** `route.test.ts` → `2 passed` (`"true"`→true; `"false"`/`"1"`/unset→false; no secret values, exact key set).

**CLI dry-run (no env):** `python tests/beta/_notebook_probe.py` → prints `DRY-RUN … no request was sent`, exit 0; the unit test asserts `httpx.Client` is never constructed.

**Live staging lane:** runs in CI on this PR (`notebook-gate`); not run from this session (no Doppler/staging access used). `prove_regression=true` is the one-click red proof for Mike.

## 4. Verification commands (exact)

```bash
# worktree root; keep cwd here (hooks resolve root-relative)
PYTHONUTF8=1 python -m pytest tests/beta/test_notebook_probe.py tests/beta/test_gate_harness.py tests/beta/test_gate_sources.py tests/beta/beta_ready_notebook_confirmed_source.py --confcutdir=tests/beta -q   # 38 passed, 1 skipped
PYTHONUTF8=1 python tests/beta/_notebook_probe.py                       # DRY-RUN, rc=0
uvx ruff check tests/beta/_notebook_probe.py tests/beta/test_notebook_probe.py tests/beta/beta_ready_notebook_confirmed_source.py
actionlint .github/workflows/beta-gate.yml .github/workflows/beta-probe-prod.yml
(cd mira-hub && node node_modules/vitest/vitest.mjs run src/app/api/health)            # 2 passed
(cd mira-hub && npx eslint src/app/api/health scripts/provision-beta-gate.ts)          # clean
(cd mira-hub && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json)        # 0 errors in touched files (32 pre-existing elsewhere, same set as Workstream A §6)
git diff --check -- . ':!PLAN.md'                                                      # clean (PLAN.md hard-break spaces are operator-authored)

# regression proof (disposable DB)
docker run -d --name mira-wsb-pg -e POSTGRES_PASSWORD=testpw -e POSTGRES_DB=mira_test -p 5602:5432 postgres:16
export TEST_DATABASE_URL="postgres://postgres:testpw@127.0.0.1:5602/mira_test" MIRA_TEST_DB_CONFIRM=DISPOSABLE
export MIRA_INTEGRATION_MIGRATIONS="<the list in beta-gate.yml admission-regression env>"
(cd mira-hub && node scripts/setup-integration-db.mjs)
(cd mira-hub && MIRA_ENFORCE_APPROVED_RETRIEVAL=true node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts src/lib/__tests__/approved-source-admission)
docker rm -f mira-wsb-pg
```

## 5. Historical repair — closed honestly (PRD §7.3 / PLAN step 5)

No backfill/migration ships. Workstream A case 4 proved a pre-fix confirmed source with `verified=false` chunks is retrievable through the corrected admission with the tenant's verified-count 0→0; `admission-regression` now re-proves that on every PR. The earlier read-only detection SQL was **not** added to this PR (scope correction: no SQL anywhere in Workstream B; the probe is the detection path, through public APIs).

## 6. Dry-run semantics + the human gate

- `beta-probe-prod.yml`: manual dispatch only. `execute` unchecked → dry-run. `execute` checked but either QA secret missing → dry-run. Only `execute=true` + both secrets → live, and then only public APIs against an **existing** QA tenant (registration is not used: `/api/auth/register` does not mirror the data-side `tenants` row, so a freshly registered tenant cannot upload — provisioning, not a public-API concern).
- Mike: adds `BETA_PROBE_QA_EMAIL`/`BETA_PROBE_QA_PASSWORD` to the `production` environment (any required reviewers on that environment apply), dispatches, reads `probe-evidence.json`. A merge may be green without this; a design-partner-readiness claim may not (PRD §8.3).

## 7. Collision notes

- **PR #3477** (`equipment-notebooks.ts`, its domain test, 2 mobile files): **not edited, not read for edits**. The probe consumes its public contract only; #3477's successor-id remap composes (the probe sends the id it uploaded, the server derives the admitted set).
- **Dependabot #2251** (`actions/checkout@v6→v7` on `beta-gate.yml:49`): line untouched; new jobs pin `@v6` consistently — a mechanical rebase either way.
- No open PR touches `beta-gate.yml`, `health/route.ts`, `provision-beta-gate.ts`, or `tests/beta/` (checked `gh pr list` at session start).

## 8. Honest limitations / risks

1. The live `notebook-gate` job has **not** run from this session; its first evidence is this PR's CI run. If it fails on a contract detail (e.g. text-PDF page anchoring by `unpdf`), the failure artifact is redacted and uploaded; the probe is unit-pinned so the fix is in one file.
2. Cleanup is **proof, not observation**: the active session cookie (supplied or minted by email/password sign-in) is held outside the `try` and reused in `finally`; every run-owned `DELETE` (notebook, upload, file) must return 2xx or 404, and any other status or exception is a probe **failure** (tests: cleanup 500, cleanup exception, 404-as-gone, email/password cleanup auth). Known consequence: `DELETE /api/files/{id}` returns 409 `has_links` while the upload door's node link exists, so the first live run may fail on cleanup — that is the honest signal that a public detach/delete path is needed for run-owned files (not silently tolerated). Residual rows cannot contaminate a later run (fresh sentinel; citation `docId` must equal the run's own upload).
3. `require_usage` defaults on (production runs `MIRA_CANONICAL_SEAM=1`); `BETA_PROBE_REQUIRE_USAGE=0` documents the legacy-cascade escape hatch, never used by CI.
4. `tests/beta/test_upload_retrieval_citation.py::test_retrieval_reads_only_knowledge_entries` fails under `--confcutdir=tests/beta` (`No module named 'shared'` — it needs the parent conftest's sys.path); pre-existing (#2077), unrelated, unchanged.
5. The legacy NodeChat lane remains **not** production-equivalent by design (§1); replacing it is a product decision outside this PR.

## 9. PLAN.md row-by-row

| PLAN step | Result |
|---|---|
| 1 Preflight/trace | ✅ clean worktree on `4a695bf31`, hooks resolve, no prod overrides; contract traced from routes + mobile client; #3477/#2251 boundaries honored |
| 2 Reusable probe | ✅ `_notebook_probe.py` (library + CLI), public APIs only, run-unique doc/sentinel, contract readiness, confirmation, exact doc/page/provider, other-tenant exclusion, provider-free refusals, redacted evidence |
| 3 Staging CI | ✅ explicit flag + health assertion, fresh tenant per run, `admission-regression`, `prove_regression`, redacted artifacts |
| 4 Prod entry point | ✅ `beta-probe-prod.yml`, manual, boolean + secrets gated, dry-run default, Mike owns dispatch |
| 5 Historical repair | ✅ no mutation; SQL preflight withdrawn per scope correction |
| 6 Verify + hand off | ✅ this file; commits + PR (unmerged) |
