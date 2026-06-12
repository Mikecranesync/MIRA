# mira-hub DB Migrations

Rules for authoring / reviewing `mira-hub/db/migrations/*.sql`. These encode the
schema gotchas that have shipped real prod bugs. Migrations are applied to
**staging** automatically by `migration-verify.yml` on any PR touching this
directory, and to **prod** only via the gated `apply-migrations.yml` dispatch.

## 1. `tenant_id` type MUST match the table's tenancy family

MIRA runs **two non-interchangeable `tenant_id` spaces**. Pick the one that
matches what the new table is keyed to — copying the wrong pattern is a bug.

| Family | `tenant_id` type | Tenants look like | Canonical example | Keyed to |
|---|---|---|---|---|
| **CMMS / equipment** | **`TEXT`** | slugs incl. `'mike'` (the demo tenant) AND uuid-strings | `008_tenant_cmms_config.sql` | `cmms_equipment.id`, `tenants.tenant_id` |
| **kg / Hub / knowledge** | **`UUID`** | uuid only | `kg_entities`, `knowledge_entries` (see `knowledge-entries-tenant-scoping.md`) | kg entity / hub proposal ids |

**Decision rule:** if the new table's foreign-ish key is `cmms_equipment.id`
(an `equipment_id`) — or it otherwise lives in the CMMS/equipment world — its
`tenant_id` is **`TEXT`**. Only the kg/Hub/knowledge family is `UUID`.

> **Shipped bug (2026-06-10):** migrations `046/047` (asset-agent validation)
> keyed on `cmms_equipment.id` but declared `tenant_id UUID`. The Hub validation
> route binds the session's TEXT tenant `'mike'` into the UUID column →
> `invalid input syntax for type uuid: "mike"` → UI **"Insert failed"**. The
> read path (GET) worked because a brand-new asset matched zero rows, so the RLS
> `::UUID` cast never fired — only the first INSERT threw. Fixed by `048`.
> Full write-up: `docs/tech-debt/2026-06-10-train-approve-insert-failed-diagnosis.md`.

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

## 6. Verify with REAL tenant data before claiming done

Reproduce the **route's actual write path** (not just `CREATE TABLE`) on an
ephemeral `postgres:16` under `SET ROLE factorylm_app` + the tenant settings —
**using a real slug tenant (`'mike'`), not a synthetic UUID.** A clean-room
seeded with a UUID tenant will PASS and **mask** any TEXT-vs-UUID defect; the
2026-06-10 bug hid exactly this way. Confirm both: the slug-tenant write
succeeds AND a uuid-string tenant still works. Read-only schema inspection of
staging is the sanctioned check (`db-inspect.yml`, or psql against
`factorylm/stg`). Never psql prod.

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
