# Notebook startup query repair — local verification

Local repair verified. Not yet staged, physically retested or accepted for customer use.

## Revision and ownership

- Application baseline and currently inspected staging Hub: `090c8e15bfcbd85f0091103cf5a6f5fc6b221056`, v3.444.8.
- Tested repair: `cc9feca5f1f879466920b21f1634945702ab9b96`, Hub package 2.54.3. The accompanying proof commit changes documentation only.
- Original implementation reused intact from PR [#4610](https://github.com/Mikecranesync/MIRA/pull/4610), head `c0483baac0c2f5f9aeec5afb0a2a585ad53dfd8b`. That commit is an ancestor of this candidate; no replacement helper or competing PR was created.
- Codex CLI owns this continuation of #3882 / #4609: concurrent-restore regression, reconciliation with current CI, package metadata and proof. The original branch/worktree and other writers' work were preserved. Remote #4610 still points to c0483baa; its historical GREEN review does not approve this successor.
- Evidence-only Pixel PR: [#5233](https://github.com/Mikecranesync/MIRA/pull/5233), head `8129ed418b5aac362f0e768a868f028237f6715e` when inspected.

## Reproduced failure and smallest repair

The Pixel trial retained its notebook/thread URL after Chrome restart but rendered the general-question workspace without its Job sheet control. Its complete failing list-request trace was not captured, so this repair is not claimed to be the sole established cause of that physical failure.

An independent, bounded reproduction on the unchanged staging baseline used the approved QA technician's 71-notebook workspace and three concurrent desktop Chrome tabs. The notebook-list route returned HTTP 200 once and HTTP 500 twice (9.8–10.4 seconds). Both failing tabs still lacked the Job sheet control after 45 seconds. No model call or new job/order was used.

The old route obtained one tenant-context transaction per notebook to load threads, in addition to the notebook list. Three 71-notebook restores therefore acquired the five-connection pool 216 times. A new real-Postgres test reproduces that amplification. These are pool leases/tenant transactions, not 216 simultaneous TCP connections.

The existing #4610 repair batches all visible thread summaries in one query per request. The same workload now acquires the pool six times. The JSON response, per-notebook limits, completed-turn filter, tenant context, owner-private threads and visible legacy threads retain their established semantics. Empty workspaces use only the notebook-list transaction.

No selection/privacy rule, app feature, schema, shared flag, pool limit or timeout was changed. The current outbox Postgres CI gate was retained while the existing list-thread job was integrated. Each named regression file must execute every case; a partially skipped file fails the job.

## Evidence

| Surface | Result at tested repair | Receipt |
|---|---|---|
| Disposable Postgres 18.6, five-connection pool | PASS: two new cases; six pool leases, 71 notebooks, other-owner/pending turns excluded, empty-tenant control | `green-after-mutation.log` |
| Existing #4610 Postgres equivalence/privacy cases | PASS: seven cases, including per-notebook limits and wrong-tenant notebook IDs | `green-after-mutation.log` |
| Regression sensitivity | PASS: temporarily restoring baseline list route makes the new budget case fail at 216 versus 6; exact repaired route restored | `mutation-receipt.json`, `mutation-old-route.log` |
| Exact local CI test-step replay | PASS with all nine cases; nonzero exit for all-skipped and partially executed files | `ci-pg-receipts.json`, `ci-pg-full.log`, `ci-pg-partial.log`, `ci-pg-skip.log` |
| Hub unit suite | PASS: 583 files / 13,035 tests; 53 pre-existing opt-in database tests skipped in four files | `hub-unit-final-receipt.json`, `hub-unit-final.log` |
| Hub production build | PASS at root-path/base-API configuration; provider credentials removed | `build-root-api-receipt.json`, `build-root-api.log` |
| Changed TypeScript lint / commit hooks / diff hygiene | PASS | `lint.log`, commit hook output, `git diff --check` |
| Candidate functions reading actual staging data | PASS: three concurrent list + batch reads, 71 notebooks each, 326 / 637 / 639 ms; server-enforced `default_transaction_read_only=on` | `candidate-readonly-benchmark.json` |
| Local compiled browser against read-only staging DB | BLOCKED: normal password login returned 401. Auth's existing bootstrap includes schema/backfill writes; the enforced read-only restriction was retained. This attempt is not a browser pass. | `local-server-receipt.json`, `local-three-tabs-debug.log` |
| Actual CI / fresh exact-head reviews | NOT RUN for this successor. Old #4610 results are historical. | `4610-current.json` |
| Staging deployment / repaired physical Pixel restart | NOT RUN. Phone was not used in this repair slice. | Pixel evidence remains tied to 090c8e15 |
| Two real technicians / complete Level 3 lane | NOT ACCEPTED; human acceptance remains outstanding. | #5233 and existing Level 3 acceptance records |

The millisecond readings are observations, not newly approved performance thresholds. Direct library reads do not prove full browser rendering or a physical restart.

The first broad unit runs failed only because cross-module test fixtures were omitted by the task's sparse checkout. Existing tracked fixtures were hydrated; no application code was changed to repair those harness failures. The final full run is green.

## Reproduce without shared writes or provider calls

Use this source in an isolated checkout with its locked dependencies. Start a disposable local Postgres database, then use the repository's existing setup:

```sh
cd mira-hub
export TEST_DATABASE_URL=postgres://USER@127.0.0.1:PORT/DISPOSABLE_DB
export MIRA_TEST_DB_CONFIRM=DISPOSABLE
npm run db:integration:setup
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts \
  tests/integration/list-threads-by-notebook.integration.test.ts \
  tests/integration/notebook-restore-query-budget.integration.test.ts
npm test -- --maxWorkers=2
NEXT_PUBLIC_BASE_PATH= NEXT_PUBLIC_API_BASE= NEXT_TELEMETRY_DISABLED=1 npm run build
```

Remove provider credentials from test/build environments. The opt-in integration files must report all seven and both two cases passing; skipped output proves nothing. The mutation control uses the baseline API route only in the disposable worktree and restores the exact repaired bytes immediately afterward.

## Remaining release action

Resume the existing #4610, rather than opening a duplicate code PR. Verify its remote head is still c0483baa; this candidate descends from that head and can update it without force. Its changed head/body requires fresh CI and the applicable exact-head reviews before any merge.

Updating a code PR automatically invokes the repository's provider-backed AI review workflow (`.github/workflows/code-review.yml`); the explicit no-new-paid-review boundary still applies. No such run was initiated. A branch push without a PR does not match the inspected push workflow filters and is only a source-publication receipt.

After the required authorization and green checks: deploy only the Hub at the exact approved merged revision, retain existing data/flags, and verify the staging generation. Reuse the existing PUMP-01 / job `0ea9256a-5989-45e7-bba8-19dc81f2c564` / Atlas 1653 fixture. Reopen its URL in three browser tabs, verify the correct notebook and existing Job sheet, then perform Chrome force-stop/relaunch in a newly authorized Pixel window. Do not create another Atlas order for a restore test. Repeat the existing scoped acceptance only when its provider allowance is explicitly confirmed.

No production readiness or Level 3/4 acceptance is claimed by this repair.

## Durable local evidence

`/Users/charlienode/Documents/Codex/2026-11-05/task/codex-pixel-restart-20261106T011756Z-16a2c0`

The task-owned database, localhost server, credential file and socket were stopped/removed after verification. No shared schema, customer record, flag or access setting was changed. No phone operation or paid call was made in this repair slice.
