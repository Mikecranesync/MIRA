# Runbook: Cowork Q2 2026 Deploy

**Purpose:** Step-by-step guide for merging the 13 cowork branches to `main` and applying their migrations to the NeonDB production database.
**Audience:** Merging engineer (Mike)
**Issue:** #607
**Dependency:** Read `docs/migrations/deploy-order.md` first — this runbook assumes you understand the migration order and RLS phasing.

---

## Pre-deploy checklist

Complete **every item** before touching the database. No partial deploys.

### Code readiness

- [ ] All 13 cowork PRs are approved and green on CI
- [ ] `npm run db:check-order` passes on each cowork branch (or on a merge branch)
- [ ] `mira-hub/package-lock.json` committed (issue #602 closed)
- [ ] 13 Doppler env vars provisioned in dev/stg/prd (issue #603 closed)
- [ ] Auth stubs replaced with `withTenant()` (issue #604 closed) — **required before RLS goes strict**
- [ ] PR #767 merged to `main` (base hub features + basePath migration)

### Database readiness

- [ ] Confirm `factorylm_app` role exists in NeonDB:
  ```sql
  SELECT rolname FROM pg_roles WHERE rolname = 'factorylm_app';
  ```
  If missing: create it per `docs/migrations/008-tenants-rls-README.md` (shipped with #578 PR).

- [ ] Confirm `BYPASS RLS` is NOT set on `factorylm_app`:
  ```sql
  SELECT rolbypassrls FROM pg_roles WHERE rolname = 'factorylm_app';
  -- Expected: f
  ```

- [ ] NeonDB backup confirmed (check console → Backups; or create a branch snapshot):
  ```
  NeonDB console → Project → Branches → Create branch from main (name: pre-cowork-deploy-YYYY-MM-DD)
  ```
  **Keep this branch for 7 days.** It is your PITR target if a migration must be reverted.

- [ ] Record UTC timestamp: `date -u` — this is your rollback reference point.

### Ops readiness

- [ ] Inform team: "Deploying cowork Q2 migrations — DB is read-heavy-safe during pre-deploy migrations; RLS migration (#578) may add 5–10ms to first-query latency."
- [ ] Grafana: open error rate + p95 latency dashboards, leave them visible during deploy.
- [ ] Discord #alpha-status: post "Starting cowork Q2 deploy — migration sequence beginning."

---

## Step-by-step: Apply migrations

Set your connection string first:

```bash
export DATABASE_URL="$(doppler run -p factorylm -c prd -- printenv DATABASE_URL)"
```

Apply each migration in the exact order below. After each `psql` call, run the verification query.

---

### Step 1 — asset hierarchy (#562)

```bash
psql "$DATABASE_URL" -f mira-hub/db/migrations/2026-04-05-002-asset-hierarchy.sql
```

**Verify:**
```sql
SELECT COUNT(*) FROM cmms_equipment;
SELECT COUNT(*) FROM cmms_sites;
SELECT COUNT(*) FROM cmms_areas;
-- All tables must exist; row counts ≥ 0.
```

---

### Step 2 — failure codes table (#568)

```bash
psql "$DATABASE_URL" -f mira-hub/db/migrations/2026-04-05-003-failure-codes.sql
```

**Verify:**
```sql
SELECT COUNT(*) FROM iso_failure_codes;
-- Table exists; 0 rows (seed not yet applied).
```

**Then apply the seed (one-time, idempotent after idempotency fix):**
```bash
# Verify sha matches before running:
sha256sum mira-hub/db/seeds/iso-14224-seed.sql
# Compare to hash in the file header comment.

psql "$DATABASE_URL" -f mira-hub/db/seeds/iso-14224-seed.sql
```

**Verify seed:**
```sql
SELECT COUNT(*) FROM iso_failure_codes;
-- Expected: 800–1200 rows.
SELECT COUNT(DISTINCT class_code) FROM iso_failure_codes;
-- Expected: 12.
```

---

### Step 3 — PM procedures (#566)

```bash
psql "$DATABASE_URL" -f mira-hub/db/migrations/2026-04-05-004-pms.sql
```

**Verify:**
```sql
SELECT COUNT(*) FROM pms;
SELECT COUNT(*) FROM pm_schedules;
-- Tables exist; pms row count ≥ 0.
```

---

### Step 4 — work-order lifecycle (#565)

```bash
psql "$DATABASE_URL" -f mira-hub/db/migrations/2026-04-05-005-work-orders.sql
```

**Verify:**
```sql
SELECT COUNT(*) FROM work_orders;
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'work_orders' AND column_name IN ('state', 'priority', 'started_at', 'completed_at');
-- All 4 columns must appear.
```

---

### Step 5 — LLM keys (#574)

```bash
psql "$DATABASE_URL" -f mira-hub/db/migrations/2026-04-24-006-llm-keys.sql
```

**Verify:**
```sql
SELECT COUNT(*) FROM tenant_llm_keys;
```

---

### Step 6 — outbound webhooks (#576)

```bash
psql "$DATABASE_URL" -f mira-hub/db/migrations/2026-04-24-007-webhooks.sql
```

**Verify:**
```sql
SELECT COUNT(*) FROM webhook_endpoints;
```

---

### Step 7 — RLS (#578) ⚠️ DURING DEPLOY WINDOW

> **This migration changes query behavior immediately.** Run it during a low-traffic window (night / weekend). Have Grafana open.

```bash
psql "$DATABASE_URL" -f mira-hub/db/migrations/2026-04-24-008-tenants-rls.sql
```

**Verify RLS is enabled:**
```sql
SELECT tablename, rowsecurity FROM pg_tables
  WHERE schemaname = 'public' AND rowsecurity = true;
-- Should list: cmms_equipment, work_orders, pms, pm_schedules,
--              knowledge_entries, hub_uploads, webhook_endpoints,
--              tenant_llm_keys, hub_tenants, hub_users.
```

**Verify shadow table exists:**
```sql
SELECT COUNT(*) FROM rls_shadow_violations;
-- 0 rows on a fresh deploy.
```

**Verify app role:**
```sql
SET ROLE factorylm_app;
SELECT current_role;
-- Must return 'factorylm_app' without error.
RESET ROLE;
```

**Smoke test (run from app):** Log in as Mike, navigate to Assets. Confirm assets load. Navigate to another tenant's assets directly (if test tenant exists) — confirm 0 rows returned.

**Start Stage 1 monitoring** (run this query hourly for 48 hours):
```sql
SELECT table_name, tenant_id, COUNT(*) violations
FROM rls_shadow_violations
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY 1, 2 ORDER BY 3 DESC;
```

If any violations appear: **do not proceed to Step 8 until root-caused.**

---

### Step 8 — SSO (#579)

> Run only after Step 7 has 0 shadow violations for 48 hours.

```bash
psql "$DATABASE_URL" -f mira-hub/db/migrations/2026-04-24-009-sso.sql
```

**Verify:**
```sql
SELECT COUNT(*) FROM sso_configurations;
SELECT COUNT(*) FROM tenant_sso_bindings;
```

---

### Step 9 — PWA sync (#575)

```bash
psql "$DATABASE_URL" -f mira-hub/db/migrations/2026-04-24-010-pwa-sync.sql
```

**Verify:**
```sql
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'work_orders' AND column_name = 'sync_state';
-- sync_state column must exist.
```

---

### Steps 10–12 — P2 batch migrations

> Run after #578 soak is complete and before Stage 2 begins.

```bash
# Apply all P2 batch migrations in filename sort order:
for f in $(ls mira-hub/db/migrations/*-p2-*.sql | sort); do
  echo "Applying $f..."
  psql "$DATABASE_URL" -f "$f"
done
```

---

## RLS cutover: shadow → strict

After 48 hours of zero shadow violations, begin Stage 2 (table-by-table strict enforcement).

Apply in this order, with a 15-minute soak between each:

```sql
-- 1. cmms_equipment (lowest user count, verify first)
DROP POLICY IF EXISTS rls_shadow_cmms_equipment ON cmms_equipment;

-- After 15 min: check violations table and Grafana 4xx rate.

-- 2. work_orders
DROP POLICY IF EXISTS rls_shadow_work_orders ON work_orders;

-- 3. knowledge_entries
DROP POLICY IF EXISTS rls_shadow_knowledge_entries ON knowledge_entries;

-- 4. hub_uploads
DROP POLICY IF EXISTS rls_shadow_hub_uploads ON hub_uploads;

-- 5. pms
DROP POLICY IF EXISTS rls_shadow_pms ON pms;

-- 6. pm_schedules
DROP POLICY IF EXISTS rls_shadow_pm_schedules ON pm_schedules;

-- 7. webhook_endpoints
DROP POLICY IF EXISTS rls_shadow_webhook_endpoints ON webhook_endpoints;

-- 8. tenant_llm_keys
DROP POLICY IF EXISTS rls_shadow_tenant_llm_keys ON tenant_llm_keys;

-- 9. hub_tenants + hub_users (last — highest blast radius)
DROP POLICY IF EXISTS rls_shadow_hub_tenants ON hub_tenants;
DROP POLICY IF EXISTS rls_shadow_hub_users ON hub_users;
```

**Rollback any table:** Re-add the permissive shadow policy. No data is changed.

```sql
-- Example rollback for work_orders:
CREATE POLICY rls_shadow_work_orders ON work_orders
  FOR ALL TO factorylm_app USING (true)  -- permissive — logs but allows
  WITH CHECK (true);
```

---

## Post-deploy soak metrics (24 hours)

Watch these after every step that touches RLS or schema:

| Metric | Where | Threshold |
|--------|-------|-----------|
| API 4xx rate | Grafana → Hub API → 4xx/min | < 0.1% of requests |
| API p95 latency | Grafana → Hub API → p95 | < 500ms (typical is ~80ms) |
| DB connection errors | Grafana → NeonDB → connection_refused | 0 |
| RLS shadow violations | `SELECT COUNT(*) FROM rls_shadow_violations WHERE created_at > NOW() - INTERVAL '1 hour'` | 0 after 48h |
| Stripe webhook errors | Grafana → Stripe webhook handler → 4xx/5xx | 0 |

After 24 clean hours, post to Discord #alpha-status: "Cowork Q2 deploy complete — RLS Stage 1 soak running."

---

## Rollback plan

### Before #578 (Steps 1–6, 9)

All migrations are additive (`ADD COLUMN IF NOT EXISTS`, new tables). Rolling back means writing a new forward migration that drops what was added. No data is at risk.

### #578 RLS rollback (Step 7, Stage 2)

- **Stage 1 (shadow mode):** Re-run `008-tenants-rls.sql` is idempotent. To fully revert: drop all RLS policies with `ALTER TABLE t DISABLE ROW LEVEL SECURITY`.
- **Stage 2 (strict, per table):** Re-add the shadow policy for affected table (see above). RLS remains enabled but permissive.

### Full PITR rollback

If a migration corrupts data and cannot be forward-fixed:

1. Note the pre-deploy UTC timestamp recorded in the pre-deploy checklist.
2. NeonDB console → Project → Branches → select `pre-cowork-deploy-YYYY-MM-DD` branch.
3. Restore to that branch's state (NeonDB "Restore" button or `neon branch restore` CLI).
4. Promote the restored branch to the primary connection string.
5. Expected downtime: 15–30 minutes.
6. After restore: file a postmortem in `docs/postmortems/`.
