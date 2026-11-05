# Pilot migration compatibility — 2026-11-05

Owner: Codex CLI, CHARLIE. Source proof revision: 4b22223ce0c44ae652fcb9b59e3bb21666114714; base main3020e45be78b54fb422b362144e58d00e123d8bc. Tracks #5218. This is local engineering proof; shared promotion and human acceptance remain separate.

## Reproduced and repaired

Proposed113 replaced the outbox event CHECK with only fix_recorded/observation_recorded. Real PostgreSQL execution of both sibling orders with empty/populated tables failed3of4cases;113→114 on an empty outbox was the passing control. The repair preserves all four published event types in still-proposed113. Canonical114 is unchanged (SHA256 4bb2bcf9b2be0eae299ccdeb6eb531ddbf2d502d552de17e1a869211c22a079a).

Reusing a populated disposable DB exposed the corresponding rollback failure. The proposed113 rollback now removes only the observation vocabulary while preserving job_finished/work_order_requested; it does not rewrite applied114. No destructive rollback was run on a shared database.

## Exact local verification

- PostgreSQL18.6, task-owned127.0.0.1:55437, database mira_pilot_compat; explicit DISPOSABLE confirmation. Standard setup-integration-db.mjs bootstrap plus095/096/097/098/111/112.
- migration-order.integration.test.ts: six actual execution cases: each order on a fresh empty111schema, a fresh111schema with an existing fix event, and a deployed114schema with existing sheet/domain/delivery records. The first cheap review identified the missing fresh-populated path; that gap is now explicitly covered. Populated fixtures contain domain events, worksheet events and CMMS deliveries. Canonical SQL is executed; only prerequisite parent FK targets are fixtures.
- Each case preserves original rows, writes all four event kinds through factorylm_app, admits append_work_log/create_work_order, rejects invented types, enforces tenant RLS and executes the documented observation rollback while preserving other capabilities' evidence and continued writes.
- Full related real-PG run:9files,132tests pass. The suite log records each executed file and its count.
- Red-first logs retained. Post-commit forward mutation fails4cases; rollback mutation fails6. Restored bytes and130tests pass. ESLint/actionlint pass. Existing CI outbox job now executes this file and requires its own passing-file receipt; skips and failed suites remain failures.
- Hub version2.54.2; package-lock root metadata is synchronized from its stale2.36.0. Dependency versions and build settings are unchanged.

## Read-only shared-state classification

At main01a27e9fc and Hub runtime5b903995dd90b3febe2fc77bee59c7324f6036d7, staging114 matches canonical:3relations,29columns,16ordinary constraints,3RLS policies,6app grants and8indexes; both outbox CHECKs match. PostgreSQL18 exposes additional NOT NULL catalog constraints, normalized using independently compared column nullability. The114ledger entry is absent.

Production Hub runtime489088d4cc0f8d16c02036df891752120a0250da has no114tables and still has111-only event/operation checks. Proposed113 is absent from both ledgers and asset_observations is absent from both schemas. This supports repairing the unpromoted proposal without changing an applied canonical migration. Any other environment's applied113 evidence must be reconciled before promotion; this PR does not promote it.

Never seed production114 from staging evidence: production needs its separately authorized actual application. Staging needs a verified ledger reconciliation via the existing gated runner, with a fresh structural check first. No shared SQL, ledger write, flag/access change or cleanup occurred in this proof.

## Other pilot evidence and limits

Attachment PR5228 independently reviewed and merged as3020e45be; not deployed by this run. Fresh read-only Atlas run42126595397 at controller main01a27e9fc proves staging order1602 COMPLETE, create marker1, finish marker1 and full two-page duplicate scan containing only1602. It is an existing synthetic fixture, not a fresh human journey.

Physical Pixel9a Chrome156 opened actual staging. Its signed-in account is outside the synthetic0099tenant and receives404for the0099pilot notebook. Existing login was preserved; no task data was created through that account. Phone availability and this tenant check do not establish a completed phone workflow or two real technicians. Drawing-packet5204 remains held.

Private reproducible receipts: /Users/charlienode/Documents/Codex/2026-11-05/task/codex-pilot-journey-20261105T225657Z-5a2295. Staging approval plan and shortest human checklist are retained there. No customer content or authentication material is published here.
