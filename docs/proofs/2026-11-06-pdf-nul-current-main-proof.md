# PDF NUL repair: current-main integration and original-file proof

Local repair verified; no successor review, CI execution, deployment or customer acceptance claimed.

- Baseline: main `090c8e15bfcbd85f0091103cf5a6f5fc6b221056`.
- Existing PR #5038 source preserved as ancestor: `881671ae73042a7cc8e95476060fa92fb7b09d50`.
- Tested current-main integration: `f23b6bca190271e3e40a88e915d6441fe5732843`, Hub package 2.54.4. The accompanying documentation commit does not change application or test source.
- Codex CLI owns the bounded continuation, preserving the original branch, other worktrees and historical review. The old GREEN at 061a335a does not cover this successor.

## Actual source and regression

A SELECT-only staging transaction recovered two stored copies of the reported `smc3-150-in065.pdf`. Both have 1,443,636 bytes and SHA256 `9272059d0a7c9007f9cbeb29daccea3ac5233466b432d624a9a76ece6a26f566`. Original customer records were unchanged. The bytes, tenant IDs and source IDs remain private and are not committed.

The actual unpdf parser extracts four pages with ten U+0000 glyphs from those bytes. The repaired writer persisted 19 private chunks with page anchors 1, 2, 3 and 4 in task-owned Postgres 18.6. Another tenant's RLS context returned no rows. The ordinary-text control remained byte-identical. This is original-file parser/database proof, not a staging upload retry or a rendered-answer/citation claim.

The permanent regression reuses #5038's original synthetic four-page multilingual NUL-glyph PDF, retrieved from preserved commit 061a335a. It uses actual unpdf, the canonical tenant context and a real database pool; only the module's database connection is redirected to the disposable fixture. It verifies the raw extraction really contains NUL, persisted page anchors/private metadata, wrong-tenant exclusion and unchanged NUL-free text.

The standard disposable schema needs canonical migrations 003 (the writer's dedup index) and 049 (app INSERT grant). These are appended only to the existing CI fixture setup, with the existing lifecycle migrations retained. The existing required Postgres job executes both new cases, including a strict named-file count receipt. No shared migration is changed or applied by this PR.

## Verification at f23b6bca1

| Check | Actual result | Private receipt |
|---|---|---|
| Real-parser + Postgres regression | 2 passed | pdf-real-pg-restored.log |
| Old-source sensitivity | Restore baseline writer: actual NUL fails at Postgres; normal-text control passes. Exact repaired source restored and 2/2 rerun green | pdf-mutation-receipt.json, pdf-real-pg-red-baseline.log |
| Original stored SMC-3 bytes, local Postgres | 2 passed; 10 NUL glyphs, 19 chunks, four page anchors; private/RLS checks pass | pdf-actual-smc3-local.log |
| Related Postgres suites, including new cases | 4 files / 22 passed | pdf-pg-related.log |
| Exact new CI step replay | Full execution exit0; partial execution and missing opt-in both exit1 | ci-pdf-receipts.json |
| Focused ingest suites | 8 files / 35 passed | pdf-focused-unit.log |
| Full Hub unit suite | 583 files / 13,036 passed; 53 existing opt-in DB cases skipped across 4 files | pdf-full-unit-complete.log |
| Root-path Hub production build | PASS without provider credentials | pdf-build-receipt.json |
| Changed TypeScript lint / actionlint / commit hooks | PASS | pdf-lint.log and commit output |

One initial full unit run omitted an existing safety-measure fixture because of sparse checkout. The tracked fixture was hydrated; no application change was made for that harness failure. The final complete suite is green. Initial new-test fixture setup failures were corrected by using existing required tenant fields and canonical index/grant migrations; none was a deployed application failure.

## Release dependencies

1. Finalize the existing #5038 head/body and run its required fresh reviews and actual CI. The code PR update automatically starts provider-backed review; no new paid call was made in this local slice. One old authoritative review slot is used, with the existing three-round cap preserved.
2. Production's latest drift failure42225085846 is exactly the missing `114_living_work_sheet.sql` (131/132 migrations). Staging already recorded it. Sanctioned production dry-run42244081686 succeeded, with no migration apply or backfill. Canonical 114 SHA256: `4bb2bcf9b2be0eae299ccdeb6eb531ddbf2d502d552de17e1a869211c22a079a`. Apply needs its explicit authority; never seed the ledger instead of running the migration.
3. Use the existing exact-SHA Hub staging workflow, preserve flags/data/volumes, obtain generation-matched automatic acceptance, and retry the original SMC-3 through a normally authorized source/workspace. A local DB pass is not that staging door-level proof.
4. Proceed to Hub-only production only through the required source, review, migration, staging and acceptance receipts. Verify the running SHA/image and bug-specific behavior afterward. A main merge or health200 alone is not completion.

## Reproduce the unpaid permanent check

```sh
cd mira-hub
export TEST_DATABASE_URL=postgres://USER@127.0.0.1:PORT/DISPOSABLE_DB
export MIRA_TEST_DB_CONFIRM=DISPOSABLE
export MIRA_INTEGRATION_EXTRA_MIGRATIONS=003_kb_hardening.sql,049_grant_app_knowledge_entries_insert.sql
node scripts/setup-integration-db.mjs
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/pdf-nul-ingest.integration.test.ts
```

Use disposable fixtures only and remove provider credentials. The original-file check uses protected bytes in the task evidence folder; do not commit those bytes or copy them into another organization's workspace.

Durable evidence: `/Users/charlienode/Documents/Codex/2026-11-06/task/codex-digest-fixes-20261106T151723Z-cb3a56`.
