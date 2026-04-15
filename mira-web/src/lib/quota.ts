/**
 * Tenant & quota management — NeonDB operations.
 *
 * Uses @neondatabase/serverless tagged template syntax:
 *   const sql = neon(url);
 *   const rows = await sql`SELECT * FROM t WHERE id = ${id}`;
 *
 * Tenant tiers: pending → active → churned
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
  first_name: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  atlas_password: string;
  atlas_company_id: number;
  atlas_user_id: number;
  atlas_provisioning_status: string;
  activation_email_status: string;    // 'pending' | 'sent' | 'failed'
  demo_seed_status: string;           // 'pending' | 'ok' | 'failed'
  provisioning_attempts: number;
  provisioning_last_attempt_at: string | null;
  provisioning_last_error: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Tenant lookups
// ---------------------------------------------------------------------------

export async function findTenantByEmail(
  email: string
): Promise<Tenant | null> {
  const db = sql();
  const rows = await db`
    SELECT id, email, company, tier, first_name,
           stripe_customer_id, stripe_subscription_id,
           atlas_password, atlas_company_id, atlas_user_id,
           atlas_provisioning_status,
           activation_email_status, demo_seed_status,
           provisioning_attempts, provisioning_last_attempt_at,
           provisioning_last_error, created_at
    FROM plg_tenants WHERE email = ${email} LIMIT 1`;
  return (rows[0] as Tenant) || null;
}

export async function findTenantById(
  tenantId: string
): Promise<Tenant | null> {
  const db = sql();
  const rows = await db`
    SELECT id, email, company, tier, first_name,
           stripe_customer_id, stripe_subscription_id,
           atlas_password, atlas_company_id, atlas_user_id,
           atlas_provisioning_status,
           activation_email_status, demo_seed_status,
           provisioning_attempts, provisioning_last_attempt_at,
           provisioning_last_error, created_at
    FROM plg_tenants WHERE id = ${tenantId} LIMIT 1`;
  return (rows[0] as Tenant) || null;
}

export async function findTenantByStripeCustomerId(
  stripeCustomerId: string
): Promise<Tenant | null> {
  const db = sql();
  const rows = await db`
    SELECT id, email, company, tier, first_name,
           stripe_customer_id, stripe_subscription_id,
           atlas_password, atlas_company_id, atlas_user_id,
           atlas_provisioning_status,
           activation_email_status, demo_seed_status,
           provisioning_attempts, provisioning_last_attempt_at,
           provisioning_last_error, created_at
    FROM plg_tenants WHERE stripe_customer_id = ${stripeCustomerId} LIMIT 1`;
  return (rows[0] as Tenant) || null;
}

// ---------------------------------------------------------------------------
// Tenant mutations
// ---------------------------------------------------------------------------

export async function createTenant(tenant: {
  id: string;
  email: string;
  company: string;
  firstName: string;
  tier: string;
  atlasPassword: string;
  atlasCompanyId: number;
  atlasUserId: number;
}): Promise<void> {
  const db = sql();
  await db`
    INSERT INTO plg_tenants (id, email, company, first_name, tier,
                             atlas_password, atlas_company_id, atlas_user_id,
                             created_at)
    VALUES (${tenant.id}, ${tenant.email}, ${tenant.company},
            ${tenant.firstName}, ${tenant.tier},
            ${tenant.atlasPassword}, ${tenant.atlasCompanyId},
            ${tenant.atlasUserId}, NOW())`;
}

export async function updateTenantTier(
  tenantId: string,
  tier: string
): Promise<void> {
  const db = sql();
  await db`UPDATE plg_tenants SET tier = ${tier} WHERE id = ${tenantId}`;
}

export async function updateTenantStripe(
  tenantId: string,
  stripeCustomerId: string,
  stripeSubscriptionId: string
): Promise<void> {
  const db = sql();
  await db`
    UPDATE plg_tenants
    SET stripe_customer_id = ${stripeCustomerId},
        stripe_subscription_id = ${stripeSubscriptionId}
    WHERE id = ${tenantId}`;
}

export async function updateTenantAtlas(
  tenantId: string,
  companyId: number,
  userId: number,
  status: "ok" | "failed"
): Promise<void> {
  const db = sql();
  await db`
    UPDATE plg_tenants
    SET atlas_company_id = ${companyId},
        atlas_user_id = ${userId},
        atlas_provisioning_status = ${status}
    WHERE id = ${tenantId}`;
}

export async function updateTenantCmmsConfig(
  tenantId: string,
  cmmsTier: string,
  cmmsProvider: string | null,
  cmmsConfigJson: string | null,
): Promise<void> {
  const db = sql();
  await db`
    UPDATE plg_tenants
    SET cmms_tier = ${cmmsTier},
        cmms_provider = ${cmmsProvider},
        cmms_config_json = ${cmmsConfigJson}
    WHERE id = ${tenantId}`;
}

export async function getTenantCmmsTier(tenantId: string): Promise<string> {
  const db = sql();
  const rows = await db`
    SELECT cmms_tier FROM plg_tenants WHERE id = ${tenantId} LIMIT 1`;
  return (rows[0]?.cmms_tier as string) || "base";
}

export async function updateTenantEmailStatus(
  tenantId: string,
  status: "pending" | "sent" | "failed",
): Promise<void> {
  const db = sql();
  await db`UPDATE plg_tenants SET activation_email_status = ${status} WHERE id = ${tenantId}`;
}

export async function updateTenantSeedStatus(
  tenantId: string,
  status: "pending" | "ok" | "failed",
): Promise<void> {
  const db = sql();
  await db`UPDATE plg_tenants SET demo_seed_status = ${status} WHERE id = ${tenantId}`;
}

export async function recordProvisioningAttempt(
  tenantId: string,
  error: string | null,
): Promise<void> {
  const db = sql();
  await db`
    UPDATE plg_tenants
       SET provisioning_attempts = provisioning_attempts + 1,
           provisioning_last_attempt_at = NOW(),
           provisioning_last_error = ${error}
     WHERE id = ${tenantId}`;
}

// ---------------------------------------------------------------------------
// Query quota
// ---------------------------------------------------------------------------

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
  tenantId: string,
  tier: string
): Promise<boolean> {
  if (tier === "active") return true;
  const used = await getQueriesUsedToday(tenantId);
  return used < FREE_DAILY_QUERIES;
}

export async function getQuota(
  tenantId: string,
  tier: string
): Promise<{ queriesUsedToday: number; dailyLimit: number; remaining: number }> {
  if (tier === "active") {
    const used = await getQueriesUsedToday(tenantId);
    return { queriesUsedToday: used, dailyLimit: -1, remaining: -1 };
  }
  const used = await getQueriesUsedToday(tenantId);
  return {
    queriesUsedToday: used,
    dailyLimit: FREE_DAILY_QUERIES,
    remaining: Math.max(0, FREE_DAILY_QUERIES - used),
  };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export async function ensureSchema(): Promise<void> {
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS plg_tenants (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      company       TEXT NOT NULL,
      first_name    TEXT NOT NULL DEFAULT '',
      tier          TEXT NOT NULL DEFAULT 'pending',
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      atlas_password TEXT NOT NULL DEFAULT '',
      atlas_company_id INTEGER NOT NULL DEFAULT 0,
      atlas_user_id INTEGER NOT NULL DEFAULT 0,
      atlas_provisioning_status TEXT NOT NULL DEFAULT 'pending',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

  // Additive migration for existing tables
  await db`ALTER TABLE plg_tenants ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT ''`;
  await db`ALTER TABLE plg_tenants ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`;
  await db`ALTER TABLE plg_tenants ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`;
  await db`ALTER TABLE plg_tenants ADD COLUMN IF NOT EXISTS atlas_provisioning_status TEXT NOT NULL DEFAULT 'pending'`;
  await db`ALTER TABLE plg_tenants ADD COLUMN IF NOT EXISTS cmms_tier TEXT NOT NULL DEFAULT 'base'`;
  await db`ALTER TABLE plg_tenants ADD COLUMN IF NOT EXISTS cmms_provider TEXT`;
  await db`ALTER TABLE plg_tenants ADD COLUMN IF NOT EXISTS cmms_config_json TEXT`;

  // Activation tracking (issue #296)
  await db`ALTER TABLE plg_tenants ADD COLUMN IF NOT EXISTS activation_email_status TEXT NOT NULL DEFAULT 'pending'`;
  await db`ALTER TABLE plg_tenants ADD COLUMN IF NOT EXISTS demo_seed_status TEXT NOT NULL DEFAULT 'pending'`;
  await db`ALTER TABLE plg_tenants ADD COLUMN IF NOT EXISTS provisioning_attempts INTEGER NOT NULL DEFAULT 0`;
  await db`ALTER TABLE plg_tenants ADD COLUMN IF NOT EXISTS provisioning_last_attempt_at TIMESTAMPTZ`;
  await db`ALTER TABLE plg_tenants ADD COLUMN IF NOT EXISTS provisioning_last_error TEXT`;

  // Backfill: existing active tenants with atlas='ok' had email+seed succeed historically.
  // Mark them 'sent'/'ok' so /api/me doesn't show a false "unfinished setup" banner.
  await db`
    UPDATE plg_tenants
       SET activation_email_status = 'sent', demo_seed_status = 'ok'
     WHERE tier = 'active'
       AND atlas_provisioning_status = 'ok'
       AND activation_email_status = 'pending'`;

  // Index for admin-health stuck-tenant detection
  await db`
    CREATE INDEX IF NOT EXISTS idx_plg_tenants_activation_stuck
      ON plg_tenants (tier, atlas_provisioning_status, activation_email_status)
      WHERE tier = 'active'`;

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
