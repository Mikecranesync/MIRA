# Upload lifecycle: current-main reconciliation and real database proof

Local repair verified. No successor review, actual CI, shared migration, deployment or customer acceptance is claimed.

- Main baseline: `090c8e15bfcbd85f0091103cf5a6f5fc6b221056`.
- Original #4091 source preserved as ancestor: `e68f3bd9fd9b492bc928eaf46f846e03ecd57003`.
- Reconciled implementation: `41bf73890`; alias safety repair: `635797e23bd68879a4360005c57c3f74697667c2`.
- Final tested application/test revision: `ce01b6b0b83ffca01c837fa8de16ca8ecac5ae82`, Hub package 2.60.0. The successor proof and fixture-allowlist commit does not change application/test source.
- Original branch and other owners' worktrees are unchanged. Codex CLI owns this bounded continuation.

## Reconciled behavior

The original upload-attempt implementation is merged onto current main. The three conflicts preserve main's retrieved-page safety logic, the original server-side alias lookup before the tenant transaction, and both retrieval functions. No source approval, selected citation, tenant filter or exact page/section constraint is relaxed.

A new integration failure was reproduced: selecting a duplicate upload's alias could omit the owner's stored safety chapter and cited-page content. Safety and exact-page retrieval now consume the existing server-derived alias map and approved owner IDs while retaining the selected alias's citation identity. Normal requests omit the optional map when it is empty, preserving the existing route contract.

The new real-Postgres regression runs the actual upload tenant context, cancellation and chunk writer, redirecting only the database connection to disposable fixtures. One case holds the writer's share lock, proves cancellation is waiting on that lock, completes the in-flight write, then verifies cancellation removes the private chunks and rejects a stale writer. The second case rejects a wrong-tenant writer, persists the current attempt and proves an exact retry does not duplicate the chunk.

Three hash-bound read-guard entries describe only generated private fixture cleanup/readback. No global test exemption or application read exemption was introduced.

## Reproducible evidence

| Check | Actual result | Private receipt |
|---|---|---|
| Alias safety regression | Old helpers: 2 fail / 54 pass; repaired: 58 pass including route coverage | upload-alias-safety-red.log, upload-alias-safety-green.log |
| Alias sensitivity | Restoring pre-fix helpers reproduces both failures; repaired source restored | upload-safety-mutation-receipt.json |
| Real Postgres cancellation, isolation and retry | 2 passed | upload-pg-restored.log |
| Race sensitivity | Removing the share lock fails the cancellation-waits assertion; preservation control passes; exact source restored, 2 green | upload-pg-mutation-receipt.json |
| Exact new CI step | Full execution exits 0; partial execution and missing opt-in exit 1 | ci-upload-receipts.json |
| Canonical migration 099 local upgrade/replay | Existing rows/history unchanged; old attempt NULL; new attempt UUID; second apply preserves UUID | migration-099-local-receipt.json |
| Full Hub unit suite | 595 files / 13,110 passed; 53 existing opt-in cases skipped across 4 files | upload-full-unit-final.log |
| Root-path production build | PASS at ce01b6b0b without provider credentials | upload-build-final-receipt.json |
| Changed-file lint | Zero errors; existing unused-import warnings remain | upload-final-lint.log, upload-lint.log |
| Knowledge-entry read guard | PASS, 215 read sites classified | upload-security-read-guard.log |
| Commit hooks / actionlint / diff check | PASS | commit output and local check logs |

The skip-control replay intentionally omits the already completed database setup to exercise the test opt-in/count guard. It is not a claim that a whole CI job could skip its setup successfully. CI execution itself remains unverified.

## Release dependencies

1. Refresh #4091's head/body only after accounting for its automatic provider review and persistent staging migration side effects. This repair has not updated that PR.
2. Preserve the original review ledger. Four authoritative rounds have already run, with round 4 explicitly post-cap authorized. A successor needs specific approval for post-cap round 5; do not reset the three-round cap or reuse an old attestation.
3. Migration 099 (`3321dfee7de2ff0353f18b53368bfe4193f26e0145c1dfa53671574b384bd2ea`) has been tested only in a disposable local schema. The PR's workflow can auto-apply it to persistent staging. Explicit shared-migration authority is required before that trigger. Production requires the sanctioned migration process after its source is available on main.
4. Run fresh exact-head/body reviews and actual required CI, then the existing SHA-conditioned merge, exact-SHA staging and generation-matched acceptance gates. Reproduce cancellation/retry/alias behavior on the deployed surface before claiming it fixed there.
5. Preserve source/tenant/approval controls. No flags, access, shared data, equipment or security settings were changed.

## Reproduce the new unpaid database check

```sh
cd mira-hub
export TEST_DATABASE_URL=postgres://USER@127.0.0.1:PORT/DISPOSABLE_DB
export MIRA_TEST_DB_CONFIRM=DISPOSABLE
export MIRA_INTEGRATION_EXTRA_MIGRATIONS=003_kb_hardening.sql,049_grant_app_knowledge_entries_insert.sql,099_hub_uploads_attempt_id.sql
node scripts/setup-integration-db.mjs
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/upload-attempt-races.integration.test.ts
```

Confirm the canonical filename of migration 099 in the checkout before invoking setup; use only disposable targets and remove provider credentials.

Durable private receipts: `/Users/charlienode/Documents/Codex/2026-11-06/task/codex-digest-fixes-20261106T151723Z-cb3a56`.
