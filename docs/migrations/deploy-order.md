# Migration Deploy Order — Cowork Q2 2026

**Status:** Pre-merge reference — migrations live on individual cowork branches until those PRs merge.
**Owner:** Merging engineer
**Last updated:** 2026-04-27
**Source issues:** #607 (this doc), #562, #565, #566, #568, #574, #575, #576, #578, #579

---

## Filename convention

All hub migration files follow:

```
mira-hub/db/migrations/YYYY-MM-DD-NNN-name.sql
```

Lexicographic sort on filename = dependency order. If a new migration breaks this (FK to a table in a later-numbered file), CI fails via `npm run db:check-order`.

Seed files live separately in `mira-hub/db/seeds/` and are **not** run by the migration runner. See §Seed special-cases.

---

## Ordered migration list

| # | File | Issue / Branch | Hard deps | Soft deps | Run timing |
|---|------|----------------|-----------|-----------|------------|
| 1 | `2026-04-05-002-asset-hierarchy.sql` | #562 `agent/issue-562-asset-hierarchy-0405` | None from this batch | None | Pre-deploy (additive) |
| 2 | `2026-04-05-003-failure-codes.sql` | #568 `agent/issue-568-failure-codes-iso14224-0405` | None | None | Pre-deploy (additive) |
| 3 | `2026-04-05-004-pms.sql` | #566 `agent/issue-566-pm-procedures-0405` | #562 (`cmms_equipment` table, `cmms_areas` FK) | None | Pre-deploy (additive) |
| 4 | `2026-04-05-005-work-orders.sql` | #565 `agent/issue-565-wo-lifecycle-0405` | #562 (asset FK), #568 (failure_codes FK), #566 (pms FK — see note) | None | Pre-deploy (additive) |
| 5 | `2026-04-24-006-llm-keys.sql` | #574 `agent/issue-574-byo-llm-asset-chat` | None | None | Pre-deploy (additive) |
| 6 | `2026-04-24-007-webhooks.sql` | #576 `agent/issue-576-outbound-webhooks-0331` | None | None | Pre-deploy (additive) |
| 7 | `2026-04-24-008-tenants-rls.sql` | #578 `agent/issue-578-multi-tenancy-0445` | All above (RLS policies reference all tables) | `factorylm_app` role must exist — see Doppler `NEONDB_APP_ROLE` | **During deploy** — RLS changes affect live queries immediately |
| 8 | `2026-04-24-009-sso.sql` | #579 `agent/issue-579-sso-saml-oidc-0445` | #578 (FKs to `tenants` table + RLS policies) | SAML/OIDC Doppler vars provisioned | During deploy |
| 9 | `2026-04-24-010-pwa-sync.sql` | #575 `agent/issue-575-mobile-pwa-0445` | #565 (`work_orders` FK) | None | Pre-deploy (additive) |
| 10–12 | P2 batch migrations (see §P2 batches) | #562–#577 P2 batch PRs | #578 RLS must be live | None | After #578 soak period |

**Notes on #565 PM foreign key:** The FK from `work_orders.pm_id → pms(id)` is tagged `TODO(#566)` in the branch — it is a free UUID column with no constraint in the current migration. Add the FK constraint via a follow-up migration once both branches are merged to main. Do not hold up the deploy sequence for this; the constraint-absent state is safe for read paths.

---

## Recommended run order (verified)

```
1.  2026-04-05-002-asset-hierarchy.sql  (#562)   — base, no deps
2.  2026-04-05-003-failure-codes.sql    (#568)   — independent
3.  2026-04-05-004-pms.sql              (#566)   — needs #562
4.  2026-04-05-005-work-orders.sql      (#565)   — needs #562, #568, #566
5.  2026-04-24-006-llm-keys.sql         (#574)   — independent
6.  2026-04-24-007-webhooks.sql         (#576)   — independent
7.  2026-04-24-008-tenants-rls.sql      (#578)   — RLS gate, needs all above
8.  2026-04-24-009-sso.sql              (#579)   — needs #578
9.  2026-04-24-010-pwa-sync.sql         (#575)   — needs #565
10. P2 batches (any order, after #578)
```

---

## RLS rollout phasing for #578

`008-tenants-rls.sql` ships RLS in three stages. **Do not skip stages.**

### Stage 1 — Shadow mode (1 week minimum)

- All `ENABLE ROW LEVEL SECURITY` policies are created.
- A permissive policy is added alongside each restrictive policy. The permissive policy writes every would-be denial to `rls_shadow_violations(table_name, tenant_id, user_id, query_fragment, created_at)`.
- No live requests are blocked. Shadow violations are logged for review.
- Monitor: `SELECT table_name, COUNT(*) FROM rls_shadow_violations GROUP BY 1 ORDER BY 2 DESC;`
- **Exit criterion:** Zero shadow violations for 48 consecutive hours.

### Stage 2 — Table-by-table strict enforcement

- Drop the permissive policy on one table at a time, hottest-traffic tables last.
- Apply in this order: `cmms_equipment` → `work_orders` → `knowledge_entries` → `hub_uploads` → `pms` → `pm_schedules` → `webhook_endpoints` → `tenant_llm_keys` → `hub_tenants`/`hub_users` (last, highest blast radius).
- After each table: tail `rls_shadow_violations` for 15 minutes, check Grafana 4xx rate.
- **Rollback per table:** re-add the permissive policy; the restrictive policy stays (no data change).

### Stage 3 — Application-layer cleanup (30 days after Stage 2 completes)

- Remove redundant `WHERE tenant_id = $X` filters from API routes that now rely on RLS.
- Tracked in separate issues filed during Stage 2.
- RLS becomes the single enforcement layer.

---

## Seed special-cases

### iso-14224-seed.sql (#568)

- **Location:** `mira-hub/db/seeds/iso-14224-seed.sql` (NOT in `migrations/`)
- **Runner:** NOT run by the migration runner. Apply manually once:
  ```bash
  psql $DATABASE_URL -f mira-hub/db/seeds/iso-14224-seed.sql
  ```
- **Idempotency:** The seed uses `ON CONFLICT (code) DO NOTHING` per row. Re-running is safe after the idempotency fix lands (tracked in #568 blocker). Verify fix is in before running.
- **SHA guard:** A header comment records the SHA of the seed file. Before running, confirm `sha256sum mira-hub/db/seeds/iso-14224-seed.sql` matches — if it doesn't, a local edit has diverged from the canonical version.
- **Timing:** Run after migration #3 (`003-failure-codes.sql`), before deploying the app. Failure codes table must exist.
- **Expected row count:** ~12 classes × 8 failure modes × ~6 mechanisms × ~5 causes ≈ 800–1200 rows. Verify: `SELECT COUNT(*) FROM iso_failure_codes;`

---

## Rollback strategy per migration

> **None of these migrations ship a DOWN script.** Recovery options depend on the change type.

| Change type | Example | Recovery |
|---|---|---|
| Additive — `ADD COLUMN IF NOT EXISTS`, new table | All migrations in this batch | **Roll forward only.** Write a new migration that drops the column / table. No data loss risk. |
| NOT NULL constraint + backfill | `010-pwa-sync.sql` sync_state column | Roll forward only. If backfill is wrong, UPDATE the column value in place. |
| FK constraint | `005-work-orders.sql → pms` | Drop the constraint in a new migration. Existing rows are not affected. |
| RLS policy | `008-tenants-rls.sql` | In Stage 1 (shadow), re-add permissive policy. In Stage 2+, same approach per table. Schema is not modified; policy drop/re-add is instant. |
| Destructive (NOT NULL without default, column rename, type change) | None in this batch | **PITR only.** NeonDB point-in-time recovery window is 7 days. Target: timestamp 5 minutes before `psql` was run. Command: NeonDB console → Branch → Restore. Estimated downtime: 15–30 min. |

**PITR target window:** Log the exact UTC timestamp when `psql` starts each migration file. This is your restore target if PITR is needed.

---

## P2 batches

P2 batch PRs (`agent/p2-batch-563-564-567-0903`, `agent/p2-batch-569-570-571-0903`, `agent/p2-batch-572-573-0903`) may run in any order **after** `008-tenants-rls.sql` is live and Stage 1 soak is complete. They assume RLS policies exist. Apply them before Stage 2 begins so all tables are RLS-protected simultaneously.
