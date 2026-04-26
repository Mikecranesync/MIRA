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
  inbox_slug: string | null;
  created_at: string;
}

// 8-char [a-z0-9] slug, e.g. "k7m3xp9q". Used in kb+<slug>@inbox.factorylm.com.
export function generateInboxSlug(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

async function generateUniqueInboxSlug(): Promise<string> {
  const db = sql();
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateInboxSlug();
    const rows = await db`SELECT 1 FROM plg_tenants WHERE inbox_slug = ${candidate} LIMIT 1`;
    if (rows.length === 0) return candidate;
  }
  throw new Error("Failed to generate unique inbox_slug after 5 attempts");
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
           provisioning_last_error, inbox_slug, created_at
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
           provisioning_last_error, inbox_slug, created_at
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
           provisioning_last_error, inbox_slug, created_at
    FROM plg_tenants WHERE stripe_customer_id = ${stripeCustomerId} LIMIT 1`;
  return (rows[0] as Tenant) || null;
}

export async function findTenantByInboxSlug(
  slug: string
): Promise<Tenant | null> {
  const db = sql();
  const rows = await db`
    SELECT id, email, company, tier, first_name,
           stripe_customer_id, stripe_subscription_id,
           atlas_password, atlas_company_id, atlas_user_id,
           atlas_provisioning_status,
           activation_email_status, demo_seed_status,
           provisioning_attempts, provisioning_last_attempt_at,
           provisioning_last_error, inbox_slug, created_at
    FROM plg_tenants WHERE inbox_slug = ${slug} LIMIT 1`;
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
  const inboxSlug = await generateUniqueInboxSlug();
  await db`
    INSERT INTO plg_tenants (id, email, company, first_name, tier,
                             atlas_password, atlas_company_id, atlas_user_id,
                             inbox_slug, created_at)
    VALUES (${tenant.id}, ${tenant.email}, ${tenant.company},
            ${tenant.firstName}, ${tenant.tier},
            ${tenant.atlasPassword}, ${tenant.atlasCompanyId},
            ${tenant.atlasUserId},
            ${inboxSlug}, NOW())`;
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

// MFA persistence helpers (Tier 1 #9). The TOTP secret is stored encrypted
// (lib/mfa.ts → encryptSecret); recovery codes are stored as SHA-256 hashes.
export interface MfaState {
  enabled: boolean;
  secretEnc: string | null;
  recoveryCodesHashed: string[];
  enrolledAt: string | null;
}

export async function getMfaState(tenantId: string): Promise<MfaState> {
  const db = sql();
  const rows = await db`
    SELECT mfa_enabled, mfa_secret_enc, mfa_recovery_codes_hashed, mfa_enrolled_at
      FROM plg_tenants WHERE id = ${tenantId} LIMIT 1`;
  const r = rows[0] as
    | {
        mfa_enabled: boolean;
        mfa_secret_enc: string | null;
        mfa_recovery_codes_hashed: string[] | null;
        mfa_enrolled_at: string | null;
      }
    | undefined;
  return {
    enabled: r?.mfa_enabled ?? false,
    secretEnc: r?.mfa_secret_enc ?? null,
    recoveryCodesHashed: r?.mfa_recovery_codes_hashed ?? [],
    enrolledAt: r?.mfa_enrolled_at ?? null,
  };
}

/** Stage a pending enrollment — secret stored, but not yet enabled. */
export async function stageMfaEnrollment(
  tenantId: string,
  secretEnc: string,
  recoveryCodesHashed: string[],
): Promise<void> {
  const db = sql();
  await db`
    UPDATE plg_tenants
       SET mfa_secret_enc = ${secretEnc},
           mfa_recovery_codes_hashed = ${recoveryCodesHashed},
           mfa_enabled = FALSE,
           mfa_enrolled_at = NULL
     WHERE id = ${tenantId}`;
}

export async function activateMfa(tenantId: string): Promise<void> {
  const db = sql();
  await db`
    UPDATE plg_tenants
       SET mfa_enabled = TRUE,
           mfa_enrolled_at = NOW()
     WHERE id = ${tenantId}`;
}

export async function clearMfa(tenantId: string): Promise<void> {
  const db = sql();
  await db`
    UPDATE plg_tenants
       SET mfa_enabled = FALSE,
           mfa_secret_enc = NULL,
           mfa_recovery_codes_hashed = NULL,
           mfa_enrolled_at = NULL
     WHERE id = ${tenantId}`;
}

export async function consumeRecoveryCodeAt(
  tenantId: string,
  index: number,
  remaining: string[],
): Promise<void> {
  const db = sql();
  // Replace the array with the remaining list (caller has already removed
  // the consumed entry). Atomic single-row update.
  void index; // index is informational; remaining[] is authoritative
  await db`
    UPDATE plg_tenants
       SET mfa_recovery_codes_hashed = ${remaining}
     WHERE id = ${tenantId}`;
}

// Account deletion (Tier 1 #8) — soft delete with 30-day grace window.
export interface DeletionState {
  deletedAt: string | null;
  purgeAfter: string | null;
}

const DELETION_GRACE_DAYS = 30;

export async function getDeletionState(
  tenantId: string,
): Promise<DeletionState> {
  const db = sql();
  const rows = await db`
    SELECT deleted_at, purge_after FROM plg_tenants WHERE id = ${tenantId} LIMIT 1`;
  const r = rows[0] as
    | { deleted_at: string | null; purge_after: string | null }
    | undefined;
  return {
    deletedAt: r?.deleted_at ?? null,
    purgeAfter: r?.purge_after ?? null,
  };
}

export async function markTenantDeleted(tenantId: string): Promise<void> {
  const db = sql();
  await db`
    UPDATE plg_tenants
       SET deleted_at = NOW(),
           purge_after = NOW() + (${DELETION_GRACE_DAYS} || ' days')::INTERVAL,
           tier = 'churned'
     WHERE id = ${tenantId}
       AND deleted_at IS NULL`;
}

/** Tenants past their purge_after — eligible for hard delete by the worker. */
export async function listTenantsAwaitingPurge(): Promise<
  Array<{ id: string; email: string; deleted_at: string }>
> {
  const db = sql();
  const rows = await db`
    SELECT id, email, deleted_at
      FROM plg_tenants
     WHERE purge_after IS NOT NULL
       AND purge_after < NOW()
     ORDER BY purge_after ASC
     LIMIT 100`;
  return rows as Array<{ id: string; email: string; deleted_at: string }>;
}

/**
 * Hard-delete tenant data after grace window. Removes audit + query rows
 * (where the tenant_id FK lives) and finally the tenant row itself.
 * Knowledge entries / Atlas / MinIO / Langfuse purges are coordinated by
 * lib/account-deletion.ts; this function just covers NeonDB plg_*.
 */
export async function hardDeleteTenant(tenantId: string): Promise<void> {
  const db = sql();
  await db`DELETE FROM plg_query_log WHERE tenant_id = ${tenantId}`;
  await db`DELETE FROM audit_events WHERE tenant_id = ${tenantId}`;
  await db`DELETE FROM plg_tenants WHERE id = ${tenantId}`;
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

  // Magic email inbox (Unit 3): each tenant gets a stable slug for kb+<slug>@inbox.factorylm.com.
  await db`ALTER TABLE plg_tenants ADD COLUMN IF NOT EXISTS inbox_slug TEXT`;
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_plg_tenants_inbox_slug
      ON plg_tenants (inbox_slug)
      WHERE inbox_slug IS NOT NULL`;
  // Backfill: any existing tenant without a slug gets one. Procedural to honor uniqueness.
  const nullSlugRows = await db`SELECT id FROM plg_tenants WHERE inbox_slug IS NULL`;
  for (const row of nullSlugRows) {
    const slug = await generateUniqueInboxSlug();
    await db`UPDATE plg_tenants SET inbox_slug = ${slug} WHERE id = ${row.id}`;
  }

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

  // MFA columns (Tier 1 #9). Free on Starter tier. The TOTP secret is
  // encrypted at app layer with PLG_JWT_SECRET-derived key (see lib/mfa.ts);
  // the column stores the AES-256-GCM ciphertext + nonce. Recovery codes
  // are SHA-256 hashed at rest, single-use.
  await db`ALTER TABLE plg_tenants ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE`;
  await db`ALTER TABLE plg_tenants ADD COLUMN IF NOT EXISTS mfa_secret_enc TEXT`;
  await db`ALTER TABLE plg_tenants ADD COLUMN IF NOT EXISTS mfa_recovery_codes_hashed TEXT[]`;
  await db`ALTER TABLE plg_tenants ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMPTZ`;

  // Account deletion (Tier 1 #8). Soft delete with a 30-day grace window
  // before the hard purge runs. CCPA / "right to be forgotten" answer.
  await db`ALTER TABLE plg_tenants ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
  await db`ALTER TABLE plg_tenants ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ`;
  await db`
    CREATE INDEX IF NOT EXISTS idx_plg_tenants_purge_after
      ON plg_tenants (purge_after)
      WHERE purge_after IS NOT NULL`;

  // Audit log (Tier 1 #7) — append-only event trail for security questionnaire
  // answers + future SOC 2 audit. Don't UPDATE/DELETE rows from app code.
  await db`
    CREATE TABLE IF NOT EXISTS audit_events (
      id         BIGSERIAL PRIMARY KEY,
      tenant_id  TEXT NOT NULL REFERENCES plg_tenants(id),
      actor_id   TEXT NOT NULL,
      actor_type TEXT NOT NULL DEFAULT 'tenant',
      action     TEXT NOT NULL,
      resource   TEXT,
      metadata   JSONB,
      ip         TEXT,
      user_agent TEXT,
      ts         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await db`
    CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_ts
      ON audit_events (tenant_id, ts DESC)`;
  await db`
    CREATE INDEX IF NOT EXISTS idx_audit_events_action_ts
      ON audit_events (action, ts DESC)`;

  // Magic-link tokens (#SO-070)
  await db`
    CREATE TABLE IF NOT EXISTS plg_magic_link_tokens (
      token_hash  TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL REFERENCES plg_tenants(id) ON DELETE CASCADE,
      email       TEXT NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await db`CREATE INDEX IF NOT EXISTS idx_plg_mlt_email ON plg_magic_link_tokens (email)`;
  await db`CREATE INDEX IF NOT EXISTS idx_plg_mlt_expires ON plg_magic_link_tokens (expires_at)`;

  // Audit trail (#SO-070; reusable for other auth events)
  await db`
    CREATE TABLE IF NOT EXISTS plg_audit_log (
      id         SERIAL PRIMARY KEY,
      tenant_id  TEXT,
      email      TEXT,
      action     TEXT NOT NULL,
      ip         TEXT,
      user_agent TEXT,
      meta_json  TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await db`CREATE INDEX IF NOT EXISTS idx_plg_audit_email_time ON plg_audit_log (email, created_at)`;
}
