# mira-hub DB Migrations

Rules for authoring / reviewing `mira-hub/db/migrations/*.sql`. These encode the
schema gotchas that have shipped real prod bugs. Migrations are applied to
**staging** automatically by `migration-verify.yml` on any PR touching this
directory, and to **prod** only via the gated `apply-migrations.yml` dispatch.

## 1. `tenant_id` type — know which space, and know it's mid-migration

MIRA has **two `tenant_id` spaces**, and tenancy is **actively migrating toward
UUID-only** — so don't blindly copy either pattern; understand which tenants can
actually reach the table.

| Family | `tenant_id` type today | Tenants | Canonical | Keyed to |
|---|---|---|---|---|
| **CMMS / equipment** | **`TEXT`** | uuid-strings + **legacy** slugs (`'mike'`) | `008_tenant_cmms_config.sql` | `cmms_equipment.id`, `tenants.tenant_id` |
| **kg / Hub / knowledge** | **`UUID`** | uuid only | `kg_entities`, `knowledge_entries` | kg entity / hub proposal ids |

**Direction of travel:** `mira-hub/src/lib/session.ts requireSession()` has
**401'd any non-UUID session `tid` since 2026-05-19** (commit `369513cb`) —
slug tenants like `'mike'` are deprecated and **cannot authenticate**. So:

- **Only UUID tenants reach the Hub API.** A new equipment-keyed table will, in
  practice, only ever receive UUID `tenant_id` values from authed routes — even
  though `cmms_equipment.tenant_id` is `TEXT` and still holds legacy slug rows.
- **Match the column you JOIN/compare against** so the SQL type-checks
  (`cmms_equipment.tenant_id` is `TEXT` today → comparisons/inserts sourced from
  it want `TEXT`; a `UUID` column forces a cast that throws on any slug value).
- **But don't enshrine `TEXT` as the goal.** The cleaner end-state is migrating
  legacy `cmms_equipment` slug rows to `UUID`, not loosening new tables to `TEXT`.
  If you add an equipment-keyed table, **state the choice and the tension in the
  migration header** rather than silently copying a neighbor.

> **Worked example — migrations `046/047` (asset-agent validation):** declared
> `tenant_id UUID` while keying on `cmms_equipment.id`. A clean-room/staging
> repro with a slug tenant fails (`invalid input syntax for type uuid: "mike"`);
> `048` switched them to `TEXT`. **Caveat:** `048` did NOT fix the originally
> reported prod "Insert failed" — that session was a *UUID* tenant, for which the
> insert succeeds on either schema. See the ⚠️ CORRECTION at the top of
> `docs/tech-debt/2026-06-10-train-approve-insert-failed-diagnosis.md`. The point
> of this rule is the type-matching discipline, **not** that `TEXT` is the fix.

## 2. RLS policy must compare `tenant_id` in its OWN type — no cross-cast

- **TEXT family:** `USING (tenant_id = current_setting('app.tenant_id', true) OR tenant_id = current_setting('app.current_tenant_id', true))` — **no `::UUID`**. A `::UUID` cast throws on slug tenants (`'mike'::UUID` is a hard error).
- **UUID family:** cast the setting: `current_setting('app.tenant_id', true)::UUID`.
- Set both `app.tenant_id` and `app.current_tenant_id` (the Hub's `withTenantContext` writes both; older policies read the latter).
- A policy with only `USING` (no `WITH CHECK`) applies `USING` as the INSERT `WITH CHECK` too — so a wrong cast breaks writes even when reads pass.

## 3. New table → GRANT to `factorylm_app`

Hub routes run under `SET LOCAL ROLE factorylm_app`. A new table with RLS but no
grant returns `permission denied for table …` before RLS even runs (the exact
class `023_grant_app_namespace_tables.sql` was created to fix). Every new Hub
table needs, in its own migration: `GRANT SELECT, INSERT, UPDATE ON <t> TO factorylm_app;`
(read-only catalogs: `GRANT SELECT`).

## 4. `ALTER COLUMN … TYPE` ordering

A type change is blocked by dependents. Drop, alter, recreate — in this order:
1. `DROP POLICY IF EXISTS` (a policy referencing the column blocks the ALTER).
2. `DROP INDEX IF EXISTS` for any **GiST** index on the column (the opclass is
   type-specific — a `(uuid, ltree)` GiST can't survive a change to `(text, ltree)`).
   Plain btree indexes / UNIQUE constraints auto-rebuild, but dropping is safest.
3. `ALTER TABLE … ALTER COLUMN … TYPE … USING …`.
4. Recreate the indexes, then the policy.

## 5. Idempotency

`apply-migrations.yml` may re-run. Use `CREATE TABLE/INDEX IF NOT EXISTS`,
`DROP POLICY IF EXISTS` before `CREATE POLICY`, and `ADD COLUMN IF NOT EXISTS`.
Wrap in `BEGIN; … COMMIT;` (single transaction — partial application must not
be possible).

## 6. Read the real error and reproduce with a REACHABLE tenant

The 2026-06-10 investigation got the cause wrong by skipping this. Two rules:

- **Read the actual error first (systematic-debugging step 1).** Don't assert a
  cause from static analysis. The genuine prod error (`console.error` in the
  route) is the ground truth; everything else is a hypothesis. Note prod
  container logs rotate fast (mira-hub retains ~minutes after a redeploy) — grab
  the error promptly or have it reproduced live.
- **Reproduce with a tenant that can actually reach the code.** Only **UUID**
  tenants authenticate (rule 1). A repro with a slug tenant (`'mike'`) exercises a
  path that is **unreachable in production** — it can both *manufacture* a failure
  that real users never hit and *mask* the real one. Reproduce the route's write
  path on ephemeral `postgres:16` under `SET ROLE factorylm_app` with the **same
  kind of tenant that actually hits the route** (UUID for authed surfaces), and
  confirm the behavior matches the real error you read.

Read-only schema inspection of staging is the sanctioned check (`db-inspect.yml`,
or psql against `factorylm/stg`). Never psql prod.

## When this applies
- Any new or altered file under `mira-hub/db/migrations/`.
- Any new Hub table/column that is tenant-scoped or RLS-protected.
- Any review of a migration PR.

## Cross-references
- `.claude/rules/knowledge-entries-tenant-scoping.md` — the UUID-family read-filter (`is_private` + system tenant).
- `mira-hub/db/migrations/008_tenant_cmms_config.sql` — canonical TEXT-tenant + RLS pattern.
- `mira-hub/db/migrations/023_grant_app_namespace_tables.sql` — the grant-to-`factorylm_app` bug class.
- `mira-hub/db/migrations/048_asset_agent_tenant_text.sql` — the TEXT fix + ALTER ordering worked example.
- `docs/tech-debt/2026-06-10-train-approve-insert-failed-diagnosis.md` — full diagnosis.
