/**
 * Tenant & quota management — NeonDB operations.
 *
 * Uses @neondatabase/serverless tagged template syntax:
 *   const sql = neon(url);
 *   const rows = await sql`SELECT * FROM t WHERE id = ${id}`;
 */

import { neon } from "@neondatabase/serverless";

function sql() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error("NEON_DATABASE_URL not set");
  return neon(url);
}

const FREE_DAILY_QUERIES = parseInt(
  process.env.PLG_DAILY_FREE_QUERIES || "5",
  10
);

export interface Tenant {
  id: string;
  email: string;
  company: string;
  tier: string;
  atlas_password: string;
  atlas_company_id: number;
  atlas_user_id: number;
  created_at: string;
}

export async function findTenantByEmail(
  email: string
): Promise<Tenant | null> {
  const db = sql();
  const rows = await db`
    SELECT id, email, company, tier, atlas_password,
           atlas_company_id, atlas_user_id, created_at
    FROM plg_tenants WHERE email = ${email} LIMIT 1`;
  return (rows[0] as Tenant) || null;
}

export async function createTenant(tenant: {
  id: string;
  email: string;
  company: string;
  tier: string;
  atlasPassword: string;
  atlasCompanyId: number;
  atlasUserId: number;
}): Promise<void> {
  const db = sql();
  await db`
    INSERT INTO plg_tenants (id, email, company, tier, atlas_password,
                             atlas_company_id, atlas_user_id, created_at)
    VALUES (${tenant.id}, ${tenant.email}, ${tenant.company}, ${tenant.tier},
            ${tenant.atlasPassword}, ${tenant.atlasCompanyId},
            ${tenant.atlasUserId}, NOW())`;
}

export async function getQueriesUsedToday(
  tenantId: string
): Promise<number> {
  const db = sql();
  const rows = await db`
    SELECT COUNT(*) as count FROM plg_query_log
    WHERE tenant_id = ${tenantId} AND created_at >= CURRENT_DATE`;
  return parseInt(String(rows[0]?.count || "0"), 10);
}

export async function logQuery(
  tenantId: string,
  query: string
): Promise<{ used: number; limit: number; remaining: number }> {
  const db = sql();
  const truncated = query.substring(0, 500);
  await db`
    INSERT INTO plg_query_log (tenant_id, query, created_at)
    VALUES (${tenantId}, ${truncated}, NOW())`;
  const used = await getQueriesUsedToday(tenantId);
  return {
    used,
    limit: FREE_DAILY_QUERIES,
    remaining: Math.max(0, FREE_DAILY_QUERIES - used),
  };
}

export async function hasQuotaRemaining(
  tenantId: string
): Promise<boolean> {
  const used = await getQueriesUsedToday(tenantId);
  return used < FREE_DAILY_QUERIES;
}

export async function getQuota(
  tenantId: string
): Promise<{ queriesUsedToday: number; dailyLimit: number; remaining: number }> {
  const used = await getQueriesUsedToday(tenantId);
  return {
    queriesUsedToday: used,
    dailyLimit: FREE_DAILY_QUERIES,
    remaining: Math.max(0, FREE_DAILY_QUERIES - used),
  };
}

export async function ensureSchema(): Promise<void> {
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS plg_tenants (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      company       TEXT NOT NULL,
      tier          TEXT NOT NULL DEFAULT 'free',
      atlas_password TEXT NOT NULL DEFAULT '',
      atlas_company_id INTEGER NOT NULL DEFAULT 0,
      atlas_user_id INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await db`
    CREATE TABLE IF NOT EXISTS plg_query_log (
      id         SERIAL PRIMARY KEY,
      tenant_id  TEXT NOT NULL REFERENCES plg_tenants(id),
      query      TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await db`
    CREATE INDEX IF NOT EXISTS idx_plg_query_log_tenant_date
    ON plg_query_log (tenant_id, created_at)`;
}
