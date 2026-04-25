## Why

The 13 cowork branches each ship at least one SQL migration. Many depend on tables created by other branches' migrations (e.g. `work_orders` in #565 needs `cmms_equipment` reshape from #562; SSO migration in #579 FKs to `tenants` from #578; #566 PM procedures FKs to both #562 and #565). Running them in the wrong order = constraint failures during deploy, partial data, or worse.

This issue tracks **two deliverables**: (1) a binding deploy-order document with rationale per dependency, and (2) a tooling improvement that makes the order enforced rather than tribal knowledge.

## Source

- `docs/competitors/pre-merge-review-2026-04-25.md` §3.6 (initial sketch)
- Per-branch AGENT_NOTES files where each agent self-documented migration prerequisites
- `docs/competitors/fixes/08-568-idempotent-seed.md` (also flagged seed-after-migration sequencing)

## Acceptance criteria

### Deliverable 1 — `docs/migrations/deploy-order.md`

Authored content:

- [ ] Full ordered list of every migration filename with:
  - Filename
  - Issue / branch it ships on
  - Hard dependencies (FKs, table renames, etc.)
  - Soft dependencies (RLS expectations, GUC settings)
  - Whether it's safe to run pre-deploy (out-of-band) or must run during deploy

- [ ] **Recommended order** (verified against AGENT_NOTES blockers):
  ```
  1.  002-asset-hierarchy.sql (#562)              base — no deps from this batch
  2.  003-failure-codes.sql (#568)                independent
  3.  004-pms.sql (#566)                          depends on #562
  4.  005-work-orders.sql (#565)                  depends on #562, #568, #566
  5.  006-llm-keys.sql (#574)                     independent
  6.  007-webhooks.sql (#576)                     independent
  7.  008-tenants-rls.sql (#578)                  depends on all above (RLS gate)
  8.  009-sso.sql (#579)                          hard dep on #578
  9.  010-pwa-sync.sql (#575)                     depends on #565
  10–12. P2 batches in any order after #578 lands
  ```

- [ ] **Rollout phasing for #578** explicitly called out:
  - Stage 1 (1 week): RLS in shadow mode — all policies created but `ENABLE ROW LEVEL SECURITY` is set, while a permissive policy logs every would-be denial to `rls_shadow_violations`.
  - Stage 2: replace shadow policies with strict ones table-by-table, hottest paths last.
  - Stage 3 (30 days clean): drop redundant `WHERE tenant_id = $X` filters from app code.

- [ ] **#568 seed special-case** — `iso-14224-seed.sql` lives in `db/seeds/` (not migrations); document that it runs OUT-OF-BAND via `mira-hub/scripts/apply-iso-14224-seed.sh` (or similar) and uses the SHA-guard to no-op on re-run.

- [ ] **Rollback strategy per migration** — most are NOT rollback-able (no DOWN scripts). Document the recovery path:
  - For schema-additive migrations (`ALTER TABLE ADD COLUMN IF NOT EXISTS`): roll forward only; revert by writing a new migration that drops the column.
  - For destructive (FK changes, NOT NULL constraints): point-in-time recovery is the only safe path; document the PITR target window.

### Deliverable 2 — Migration runner improvements

- [ ] Migration filenames already follow `YYYY-MM-DD-NNN-name.sql` — verify lexicographic order matches dependency order. If not, rename pre-deploy.
- [ ] Add a `mira-hub/db/check-migration-order.mjs` script that:
  - Reads every migration file
  - Extracts `-- Issue: #NNN` from headers
  - Cross-references against a hand-maintained dep map at the head of the script
  - Fails CI if a later migration FKs to a table created by a later-numbered migration

- [ ] `package.json` script `db:check-order` runs the above
- [ ] CI step on every PR: run `npm run db:check-order`

### Deliverable 3 — runbook for the actual deploy

- [ ] `docs/ops/runbooks/cowork-deploy-2026-Q2.md` with:
  - Pre-deploy checklist (Doppler vars present, lockfile committed, all PRs merged-to-main)
  - Step-by-step `psql` commands to apply migrations in order
  - Health check after each (number of rows expected per seed, RLS shadow log monitoring command)
  - Cutover plan from shadow → strict for #578
  - Post-deploy soak metrics — what to watch for 24 hours

## Dependency order

This issue is independent of any feature branch — it's documentation + tooling. Land it BEFORE any feature branch merges to main, so the merging engineer follows the doc rather than guessing.

## Out of scope

- Building a full DB migration framework (Flyway, Alembic, etc.) — the existing simple psql-runner approach is fine for our scale.
- Automating Stage 2 / Stage 3 of the #578 rollout — these are explicit human decisions.
