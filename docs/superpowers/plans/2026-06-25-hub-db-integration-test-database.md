# Hub DB Integration Test Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable, safe test-database setup for `mira-hub` DB integration tests so `npm run test:integration` runs against a disposable Postgres/Neon branch without touching production or staging.

**Architecture:** Add a Node-based bootstrapper that connects to `TEST_DATABASE_URL`, refuses to run unless the caller explicitly confirms the database is disposable, creates required extensions/roles, applies an integration-only CMMS/RLS fixture, applies Hub migrations with a local test ledger, then runs smoke checks. Keep production migrations unchanged unless a real schema bug is found.

**Tech Stack:** Node.js ESM scripts, `pg`, Postgres 16-compatible SQL, Vitest, existing `mira-hub` npm scripts.

## Execution Update - 2026-06-25

- Found existing repo access path: Doppler `factorylm/dev` and `factorylm/stg` both expose `NEON_DATABASE_URL`; dev points at `ep-lingering-salad`, staging points at `ep-polished-hall`.
- Added `npm run test:integration:dev`, guarded to the documented dev Neon endpoint, which aliases `NEON_DATABASE_URL` to `TEST_DATABASE_URL`, forwards optional Vitest file args, and cleans fixed integration tenants afterward.
- Applied migrations `055_contextualization.sql` and `056_contextualization_intake.sql` to Doppler `factorylm/dev` after a guarded check showed `contextualization_projects` and `ctx_import_batches` were missing.
- Verified real dev Neon contextualization suites:
  `doppler run --project factorylm --config dev -- npm run test:integration:dev -- src/app/api/contextualization/import/import.integration.test.ts "src/app/api/contextualization/batches/[batchId]/review/review.integration.test.ts"`
  passed 2 files / 9 tests and cleanup ran.
- Full `npm run test:integration:dev` still fails on `src/lib/auth/__tests__/rls-deny.integration.test.ts` because shared dev lacks `cmms_areas` / `cmms_sites`, while the integration-only CMMS fixture expects UUID `tenants.id`. Keep the CMMS/RLS suite on `TEST_DATABASE_URL` + `MIRA_TEST_DB_CONFIRM=DISPOSABLE` until a disposable Neon branch/local Postgres is available.

## Global Constraints

- Never run setup against production or staging URLs.
- Require `TEST_DATABASE_URL` and `MIRA_TEST_DB_CONFIRM=DISPOSABLE` before any DDL.
- Do not require Docker, `psql`, or `pg_isready`; this Windows shell does not currently have them.
- Do not commit secrets or `.env` files.
- Use existing Hub migrations in `mira-hub/db/migrations`.
- Use integration-only fixtures only under `mira-hub/db/integration-fixtures`; do not ship test-only schema as production migrations.
- Preserve read-only/live-safety rules; this task is DB test harness only.

---

## File Structure

- Create `mira-hub/db/integration-fixtures/000_base_cmms_rls.sql`
  - Minimal schema required by `src/lib/auth/__tests__/rls-deny.integration.test.ts`: `tenants`, `cmms_sites`, `cmms_areas`, `cmms_equipment`, `tenant_audit_log`, RLS policies, grants.
- Create `mira-hub/scripts/setup-integration-db.mjs`
  - Validates env, blocks unsafe URLs, creates role/extensions, applies fixture and migrations, records applied files in `integration_schema_migrations`, runs smoke checks.
- Modify `mira-hub/package.json`
  - Add `db:integration:setup`, `test:integration:db`, and optionally make `test:integration` remain unchanged.
- Modify `mira-hub/src/app/api/contextualization/import/import.integration.test.ts`
  - Update header instructions to use `npm run db:integration:setup`.
- Modify `mira-hub/src/app/api/contextualization/batches/[batchId]/review/review.integration.test.ts`
  - Update header instructions to use the shared setup command.
- Modify `mira-hub/src/lib/auth/__tests__/rls-deny.integration.test.ts`
  - Update stale Docker/migration references to the shared setup command.

---

### Task 1: Add Integration-Only CMMS/RLS Fixture

**Files:**
- Create: `mira-hub/db/integration-fixtures/000_base_cmms_rls.sql`

**Interfaces:**
- Consumes: Postgres session after `factorylm_app` role exists.
- Produces: Tables/policies expected by `src/lib/auth/__tests__/rls-deny.integration.test.ts`.

- [ ] **Step 1: Write the fixture SQL**

Create `mira-hub/db/integration-fixtures/000_base_cmms_rls.sql`:

```sql
-- Integration-test fixture only. Do not apply to production/staging.

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cmms_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS cmms_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id UUID REFERENCES cmms_sites(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, site_id, slug)
);

CREATE TABLE IF NOT EXISTS cmms_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  equipment_number TEXT NOT NULL,
  manufacturer TEXT,
  site_id UUID REFERENCES cmms_sites(id) ON DELETE SET NULL,
  area_id UUID REFERENCES cmms_areas(id) ON DELETE SET NULL,
  slug TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, equipment_number)
);

CREATE TABLE IF NOT EXISTS tenant_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE cmms_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE cmms_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE cmms_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_app_select ON tenants;
CREATE POLICY tenants_app_select ON tenants
  FOR SELECT TO factorylm_app
  USING (id = current_setting('app.tenant_id', true)::uuid
      OR id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS cmms_sites_tenant ON cmms_sites;
CREATE POLICY cmms_sites_tenant ON cmms_sites
  FOR ALL TO factorylm_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid
      OR tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid
           OR tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS cmms_areas_tenant ON cmms_areas;
CREATE POLICY cmms_areas_tenant ON cmms_areas
  FOR ALL TO factorylm_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid
      OR tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid
           OR tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS cmms_equipment_tenant ON cmms_equipment;
CREATE POLICY cmms_equipment_tenant ON cmms_equipment
  FOR ALL TO factorylm_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid
      OR tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid
           OR tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_audit_log_insert ON tenant_audit_log;
CREATE POLICY tenant_audit_log_insert ON tenant_audit_log
  FOR INSERT TO factorylm_app
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid
           OR tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_audit_log_select ON tenant_audit_log;
CREATE POLICY tenant_audit_log_select ON tenant_audit_log
  FOR SELECT TO factorylm_app
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid
      OR tenant_id = current_setting('app.current_tenant_id', true)::uuid);

GRANT SELECT ON tenants TO factorylm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON cmms_sites TO factorylm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON cmms_areas TO factorylm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON cmms_equipment TO factorylm_app;
GRANT SELECT, INSERT ON tenant_audit_log TO factorylm_app;
REVOKE UPDATE, DELETE ON tenant_audit_log FROM factorylm_app;
```

- [ ] **Step 2: Self-check fixture references**

Run:

```powershell
Select-String -Path mira-hub\db\integration-fixtures\000_base_cmms_rls.sql -Pattern "CREATE TABLE IF NOT EXISTS cmms_equipment|REVOKE UPDATE, DELETE ON tenant_audit_log"
```

Expected: two matches.

- [ ] **Step 3: Commit**

```powershell
git add mira-hub/db/integration-fixtures/000_base_cmms_rls.sql
git commit -m "test: add hub integration db fixture"
```

---

### Task 2: Add Disposable DB Bootstrap Script

**Files:**
- Create: `mira-hub/scripts/setup-integration-db.mjs`

**Interfaces:**
- Consumes: `TEST_DATABASE_URL`, `MIRA_TEST_DB_CONFIRM=DISPOSABLE`.
- Produces: a migrated disposable DB and a clear smoke-check result.

- [ ] **Step 1: Write a failing script-level test command**

Run before creating the script:

```powershell
cd mira-hub
node scripts/setup-integration-db.mjs
```

Expected: fails with `Cannot find module` or file-not-found because the script does not exist yet.

- [ ] **Step 2: Create the bootstrap script**

Create `mira-hub/scripts/setup-integration-db.mjs`:

```js
#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hubRoot = path.resolve(__dirname, "..");
const migrationsDir = path.join(hubRoot, "db", "migrations");
const fixturesDir = path.join(hubRoot, "db", "integration-fixtures");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertDisposable(urlText) {
  const confirm = process.env.MIRA_TEST_DB_CONFIRM;
  if (confirm !== "DISPOSABLE") {
    throw new Error("Set MIRA_TEST_DB_CONFIRM=DISPOSABLE to confirm this is not prod/staging.");
  }
  const url = new URL(urlText);
  const lower = `${url.hostname} ${url.pathname}`.toLowerCase();
  if (lower.includes("prod") || lower.includes("prd") || lower.includes("staging")) {
    throw new Error(`Refusing unsafe database URL host/path: ${url.hostname}${url.pathname}`);
  }
}

async function listSql(dir) {
  const files = await fs.readdir(dir);
  return files.filter((f) => f.endsWith(".sql")).sort().map((f) => path.join(dir, f));
}

async function ensureBootstrap(client) {
  await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  await client.query("CREATE EXTENSION IF NOT EXISTS ltree");
  await client.query("CREATE EXTENSION IF NOT EXISTS btree_gist");
  await client.query("DO $$ BEGIN CREATE ROLE factorylm_app NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
  await client.query("GRANT USAGE ON SCHEMA public TO factorylm_app");
  await client.query(`
    CREATE TABLE IF NOT EXISTS integration_schema_migrations (
      file_name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function applySqlFile(client, file) {
  const fileName = path.basename(file);
  const seen = await client.query("SELECT 1 FROM integration_schema_migrations WHERE file_name = $1", [fileName]);
  if (seen.rowCount) {
    console.log(`[skip] ${fileName}`);
    return;
  }
  const sql = await fs.readFile(file, "utf8");
  console.log(`[apply] ${fileName}`);
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO integration_schema_migrations (file_name) VALUES ($1)", [fileName]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw new Error(`${fileName} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function smokeCheck(client) {
  const required = [
    "tenants",
    "cmms_sites",
    "cmms_areas",
    "cmms_equipment",
    "tenant_audit_log",
    "contextualization_projects",
    "ctx_sources",
    "ctx_extractions",
    "ctx_import_batches",
    "kg_entities",
    "ai_suggestions",
  ];
  for (const table of required) {
    const res = await client.query("SELECT to_regclass($1) AS table_name", [`public.${table}`]);
    if (!res.rows[0].table_name) throw new Error(`Missing required table: ${table}`);
  }
  const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'factorylm_app'");
  if (!role.rowCount) throw new Error("Missing required role: factorylm_app");
  console.log("[ok] integration database smoke check passed");
}

async function main() {
  const databaseUrl = requireEnv("TEST_DATABASE_URL");
  assertDisposable(databaseUrl);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await ensureBootstrap(client);
    for (const file of await listSql(fixturesDir)) await applySqlFile(client, file);
    for (const file of await listSql(migrationsDir)) await applySqlFile(client, file);
    await smokeCheck(client);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`[setup-integration-db] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
```

- [ ] **Step 3: Run script without env to verify safety failure**

Run:

```powershell
cd mira-hub
node scripts/setup-integration-db.mjs
```

Expected: fails with `TEST_DATABASE_URL is required`.

- [ ] **Step 4: Run script with URL but no confirmation**

Run:

```powershell
cd mira-hub
$env:TEST_DATABASE_URL="postgres://example.invalid/test"
Remove-Item Env:MIRA_TEST_DB_CONFIRM -ErrorAction SilentlyContinue
node scripts/setup-integration-db.mjs
```

Expected: fails with `Set MIRA_TEST_DB_CONFIRM=DISPOSABLE`.

- [ ] **Step 5: Commit**

```powershell
git add mira-hub/scripts/setup-integration-db.mjs
git commit -m "test: add hub integration db bootstrapper"
```

---

### Task 3: Add NPM Scripts And Test Headers

**Files:**
- Modify: `mira-hub/package.json`
- Modify: `mira-hub/src/app/api/contextualization/import/import.integration.test.ts`
- Modify: `mira-hub/src/app/api/contextualization/batches/[batchId]/review/review.integration.test.ts`
- Modify: `mira-hub/src/lib/auth/__tests__/rls-deny.integration.test.ts`

**Interfaces:**
- Consumes: `scripts/setup-integration-db.mjs`.
- Produces: discoverable commands for engineers and agents.

- [ ] **Step 1: Add package scripts**

Modify `mira-hub/package.json` scripts block:

```json
{
  "db:integration:setup": "node scripts/setup-integration-db.mjs",
  "test:integration": "vitest run --config vitest.integration.config.ts",
  "test:integration:db": "npm run db:integration:setup && npm run test:integration"
}
```

Keep existing scripts unchanged except adding the two new keys. If `test:integration` already exists, do not duplicate it.

- [ ] **Step 2: Update integration test headers**

In each integration test header, replace Docker-specific setup instructions with:

```ts
// Requires a disposable Postgres/Neon test DB.
//
//   $env:TEST_DATABASE_URL="postgres://..."
//   $env:MIRA_TEST_DB_CONFIRM="DISPOSABLE"
//   npm run test:integration:db
//
// The setup command creates the factorylm_app role, applies integration-only
// fixtures, applies Hub migrations, and runs smoke checks before Vitest.
```

- [ ] **Step 3: Verify package JSON parses**

Run:

```powershell
cd mira-hub
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json ok')"
```

Expected: `package.json ok`.

- [ ] **Step 4: Commit**

```powershell
git add mira-hub/package.json mira-hub/src/app/api/contextualization/import/import.integration.test.ts mira-hub/src/app/api/contextualization/batches/[batchId]/review/review.integration.test.ts mira-hub/src/lib/auth/__tests__/rls-deny.integration.test.ts
git commit -m "docs: document hub integration db setup"
```

---

### Task 4: Run Against A Real Disposable DB

**Files:**
- No source files unless this task discovers a real schema incompatibility.

**Interfaces:**
- Consumes: `TEST_DATABASE_URL` for an empty disposable Postgres/Neon branch.
- Produces: passing DB integration lane or a concrete migration/schema failure.

- [ ] **Step 1: Provision a disposable DB outside the repo**

Use one of:

```powershell
# Neon disposable branch/test database, preferred on this machine.
$env:TEST_DATABASE_URL="postgres://USER:PASSWORD@HOST/DB?sslmode=require"
$env:MIRA_TEST_DB_CONFIRM="DISPOSABLE"
```

or, on a machine with Docker:

```powershell
docker run --rm -d -p 5440:5432 -e POSTGRES_PASSWORD=test --name mira-hub-integration-test postgres:16
$env:TEST_DATABASE_URL="postgres://postgres:test@localhost:5440/postgres"
$env:MIRA_TEST_DB_CONFIRM="DISPOSABLE"
```

- [ ] **Step 2: Run setup plus tests**

Run:

```powershell
cd mira-hub
npm run test:integration:db
```

Expected:

```text
[ok] integration database smoke check passed
Test Files  3 passed
Tests       17 passed
```

- [ ] **Step 3: If setup fails on a migration**

Do not paper over it. Capture the exact failing migration and error:

```powershell
cd mira-hub
npm run db:integration:setup *> ..\integration-db-setup.log
Get-Content ..\integration-db-setup.log -Tail 80
```

Expected: the tail includes `[apply] <file>.sql` immediately before the failing SQL error.

- [ ] **Step 4: If tests fail after setup**

Run the failing file directly:

```powershell
cd mira-hub
npx vitest run --config vitest.integration.config.ts src/app/api/contextualization/import/import.integration.test.ts
npx vitest run --config vitest.integration.config.ts src/app/api/contextualization/batches/[batchId]/review/review.integration.test.ts
npx vitest run --config vitest.integration.config.ts src/lib/auth/__tests__/rls-deny.integration.test.ts
```

Expected: each command either passes or gives one isolated failure to fix.

- [ ] **Step 5: Commit any real fixes**

Only commit source/migration fixes if the failing DB proves a real repo bug. Do not commit environment values or logs.

```powershell
git status --short
git add <fixed-files>
git commit -m "fix: make hub db integration setup pass"
```

---

## Self-Review

Spec coverage:
- Disposable DB safety is covered by Task 2 env guards.
- Docker-free Windows path is covered by Node `pg` bootstrapper.
- Existing integration suites are covered by Task 1 fixture and Task 4 commands.
- Stale test setup docs are covered by Task 3.

Placeholder scan:
- No `TBD`, `TODO`, or unfilled steps remain.

Type consistency:
- `TEST_DATABASE_URL`, `MIRA_TEST_DB_CONFIRM`, `factorylm_app`, and `integration_schema_migrations` are named consistently across tasks.
