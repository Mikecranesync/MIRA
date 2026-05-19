# Phase 0 — End-to-End Verification

**Date:** 2026-05-19
**PR:** [#1418](https://github.com/Mikecranesync/MIRA/pull/1418) — *feat: Phase 0 — schema (025/026/027) + photo→KG demo loop*
**Branch:** `claude/happy-dirac-094c0b`
**Environment:** Doppler `factorylm/stg` → Neon staging branch (`ep-polished-hall-ahcqtcxe-pooler.c-3.us-east-1.aws.neon.tech`)
**Result:** **PASS** — 35/35 schema checks + 6/6 integration tests green

---

## What this proves

Before today, PR #1418's CI surface only proved that the *Python* worker
was syntactically valid (offline tests covered the four early-exit paths
and the confidence-band calibration). Nothing in CI proved that:

1. migrations 025/026/027 actually apply against a real Neon branch,
2. the tables, indexes, RLS policies and `factorylm_app` grants come
   out the shape the migrations declare,
3. `propose_from_nameplate()` end-to-end writes a row that the Hub
   `/proposals` page would read back,
4. tenant RLS is real and not a code-path the owner role silently
   bypasses.

This run produces deterministic proof for all four.

## What was added

| Artifact | Purpose |
|---|---|
| `tools/verify_phase0_deploy.py` | Post-apply schema checker. Prints a PASS/FAIL table for every table, column, index, RLS policy, grant, and CHECK constraint declared by migrations 025/026/027. Exits 1 on any drift. |
| `tests/integration/test_phase0_schema.py` | Six pytest tests against a real Neon branch — three round-trips, one RLS isolation, one demo-loop end-to-end, one early-exit. |
| `.github/workflows/migration-verify.yml` | Auto-apply + verify on every PR that touches `mira-hub/db/migrations/**`. Runs against the `staging` environment. |
| `.github/workflows/photo-e2e-verify.yml` | Auto-runs the demo-loop subset on every PR that touches the worker, the ingest helper, or the engine glue. |

## Evidence — staging Neon

### Migration apply (2026-05-19)

```
=== Applying mira-hub/db/migrations/025_tag_entities.sql ===
BEGIN, CREATE TABLE, 5× CREATE INDEX, ALTER TABLE (ENABLE RLS),
DROP POLICY IF EXISTS, CREATE POLICY, GRANT, COMMIT  ✅

=== Applying mira-hub/db/migrations/026_wiring_connections.sql ===
BEGIN, CREATE TABLE, 5× CREATE INDEX, ALTER TABLE (ENABLE RLS),
DROP POLICY IF EXISTS, CREATE POLICY, GRANT, COMMIT  ✅

=== Applying mira-hub/db/migrations/027_ai_suggestions.sql ===
BEGIN, CREATE TABLE, 4× CREATE INDEX, ALTER TABLE (ENABLE RLS),
DROP POLICY IF EXISTS, CREATE POLICY, GRANT, COMMIT  ✅
```

Each migration is wrapped in `--single-transaction --set ON_ERROR_STOP=1`
so a failure on any statement aborts the whole file.

### `verify_phase0_deploy.py` output

<details>
<summary>35/35 PASS — click to expand</summary>

```
Verifying Phase 0 schema against db=neondb host=::1

CHECK                                     STATUS  DETAIL
----------------------------------------  ------  ------
table tag_entities                        PASS    exists
table wiring_connections                  PASS    exists
table ai_suggestions                      PASS    exists
columns tag_entities                      PASS    all present
columns wiring_connections                PASS    all present
columns ai_suggestions                    PASS    all present
index idx_tag_entities_uns_path_gist      PASS    exists
index idx_tag_entities_source_address     PASS    exists
index idx_tag_entities_sparkplug_topic    PASS    exists
index idx_tag_entities_component          PASS    exists
index idx_tag_entities_pending            PASS    exists
index idx_wiring_connections_source       PASS    exists
index idx_wiring_connections_dest         PASS    exists
index idx_wiring_connections_wire_number  PASS    exists
index idx_wiring_connections_cable        PASS    exists
index idx_wiring_connections_pending      PASS    exists
index idx_ai_suggestions_pending          PASS    exists
index idx_ai_suggestions_risk             PASS    exists
index idx_ai_suggestions_source_doc       PASS    exists
index idx_ai_suggestions_reviewer         PASS    exists
RLS enabled tag_entities                  PASS    enabled
RLS enabled wiring_connections            PASS    enabled
RLS enabled ai_suggestions                PASS    enabled
policy tag_entities_tenant                PASS    present
policy wiring_connections_tenant          PASS    present
policy ai_suggestions_tenant              PASS    present
grants tag_entities factorylm_app         PASS    ['INSERT', 'SELECT', 'UPDATE']
grants wiring_connections factorylm_app   PASS    ['INSERT', 'SELECT', 'UPDATE']
grants ai_suggestions factorylm_app       PASS    ['INSERT', 'SELECT', 'UPDATE']
CHECK tag_entities.data_type              PASS    ok
CHECK tag_entities.source_kind            PASS    ok
CHECK tag_entities.approval_state         PASS    ok
CHECK ai_suggestions.suggestion_type      PASS    ok
CHECK ai_suggestions.status               PASS    ok
CHECK ai_suggestions.risk_level           PASS    ok

RESULT: PASS  (35 checks passed)
```

Exit code: `0`.

</details>

### Integration tests

<details>
<summary>6/6 PASS — click to expand</summary>

```
============================= test session starts ==============================
platform darwin -- Python 3.9.6, pytest-8.4.2, pluggy-1.6.0
collected 6 items

tests/integration/test_phase0_schema.py::test_tag_entities_roundtrip                       PASSED [ 16%]
tests/integration/test_phase0_schema.py::test_wiring_connections_roundtrip                 PASSED [ 33%]
tests/integration/test_phase0_schema.py::test_ai_suggestions_roundtrip                     PASSED [ 50%]
tests/integration/test_phase0_schema.py::test_rls_tenant_isolation_ai_suggestions          PASSED [ 66%]
tests/integration/test_phase0_schema.py::test_propose_from_nameplate_writes_suggestion     PASSED [ 83%]
tests/integration/test_phase0_schema.py::test_propose_from_nameplate_empty_tenant_no_write PASSED [100%]

============================== 6 passed in 2.98s ===============================
```

What each test exercises:

| Test | Coverage |
|---|---|
| `test_tag_entities_roundtrip` | INSERT a tag with `data_type='REAL'` + `source_kind='modbus_register'`, read back `approval_state` defaults to `'proposed'`, DELETE. |
| `test_wiring_connections_roundtrip` | INSERT a `wire_number='W-1147'` `function_class='signal'` row, verify `approval_state='proposed'` default. |
| `test_ai_suggestions_roundtrip` | INSERT a `component_profile` suggestion, verify `status='pending'`, `risk_level='low'`, `proposed_by='llm:unknown'` defaults. |
| `test_rls_tenant_isolation_ai_suggestions` | `SET LOCAL ROLE factorylm_app`, insert as tenant A, query as tenant B → 0 rows; query as tenant A → 1 row. Owner cleans up. |
| `test_propose_from_nameplate_writes_suggestion` | Full demo loop — call the worker, assert it returns a `suggestion_id`, re-query the table from a fresh transaction, confirm `proposed_by='photo:phase0-verify'`. Uses a unique model number to force the `component_profile` branch (no template match). |
| `test_propose_from_nameplate_empty_tenant_no_write` | Early-exit: empty `tenant_id` → `{}` returned, no DB call. |

</details>

## Why the RLS test is meaningful

The `NEON_DATABASE_URL` in Doppler `factorylm/stg` connects as
`neondb_owner`, which has implicit `BYPASSRLS`. A naive
"insert-as-A-then-select-as-B" test would silently pass even if the
policy were dropped, because owner sees everything.

The integration test uses `SET LOCAL ROLE factorylm_app` inside each
isolated transaction, so the row-level policy is actually enforced.
Verified pre-flight that `neondb_owner` can `SET ROLE factorylm_app`
(`pg_has_role` = `t`) and that `factorylm_app` has the
`SELECT/INSERT/UPDATE/DELETE` grants the worker needs on
`installed_component_instances`.

## Harness sanity check

Both harnesses were proved to fail on demand:

* `verify_phase0_deploy.py` — injected an extra expected table and policy/
  grant entries. Output reported `RESULT: FAIL (5/40 checks failed)` with
  exit code `1`. Confirms the harness can surface drift.
* `tests/integration/test_phase0_schema.py` — appended `test_harness_sanity_must_fail` with `assert 0 == 99`. pytest reported `FAILED` with exit code `1`. Test was removed before final capture.

A first-pass version of `verify_phase0_deploy.py` crashed (rather than
reporting FAIL) when a checked table was absent — the `::regclass` cast
raised before the result could be printed. Caught + fixed during the
sanity check, see `_check_rls()`.

## Operational notes

* **Auto-apply on PR is OK because the migrations are idempotent**
  (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS`,
  `CREATE INDEX IF NOT EXISTS`). A re-run on a staging branch that
  already has 025–027 is a no-op.
* **Production migrations still go through `apply-migrations.yml`**
  (workflow_dispatch, `environment: production`, required reviewers).
  `migration-verify.yml` only writes to the staging Neon branch.
* **Test cleanup is best-effort** — every test wraps its DELETE in a
  `finally:` block so a failing assertion still leaves the staging
  branch clean.
* **Pollution budget**: at worst, a half-run that crashes before cleanup
  leaves O(1) rows behind per failed test. Acceptable for a shared
  staging branch and well below the 100-row-floor any production
  reader cares about.

## Next steps (not done here)

* Add `migration-verify.yml` to the **deploy-vps.yml** required-checks list (so a red gate blocks prod deploys touching schema). Discussed but kept out of this PR — it touches branch-protection rules and should be a separate review.
* Wire the workflows into the existing `staging-gate.yml` `needs:` chain once we observe a few runs and confirm cadence + cost.
* Backfill a `tools/verify_phase0_deploy.py` equivalent for migrations 021/022/023 next time we touch them — same pattern.
