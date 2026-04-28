import pool from "@/lib/db";
import { ensureDataSchema } from "@/lib/data-schema";

export type UserStatus = "pending" | "trial" | "approved" | "expired" | "admin";

export interface HubUser {
  id: string;
  email: string;
  passwordHash: string | null;
  googleSub: string | null;
  tenantId: string;
  name: string | null;
  role: string;
  status: UserStatus;
  trialExpiresAt: Date | null;
  plan: string | null;
  preferences: Record<string, unknown>;
}

let schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hub_tenants (
        id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name          TEXT NOT NULL,
        owner_user_id TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hub_users (
        id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        email          TEXT NOT NULL,
        email_lower    TEXT GENERATED ALWAYS AS (LOWER(email)) STORED,
        password_hash  TEXT,
        google_sub     TEXT,
        tenant_id      TEXT NOT NULL REFERENCES hub_tenants(id),
        name           TEXT,
        role             TEXT NOT NULL DEFAULT 'owner',
        status           TEXT NOT NULL DEFAULT 'trial',
        trial_expires_at TIMESTAMPTZ,
        plan             TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_users_email_lower
        ON hub_users (email_lower)
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_users_google_sub
        ON hub_users (google_sub) WHERE google_sub IS NOT NULL
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_hub_users_tenant
        ON hub_users (tenant_id)
    `);
    // Idempotent migrations: add new columns to existing tables
    await pool.query(`ALTER TABLE hub_users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'trial'`);
    await pool.query(`ALTER TABLE hub_users ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE hub_users ADD COLUMN IF NOT EXISTS plan TEXT`);
    await pool.query(`ALTER TABLE hub_users ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'`);
    // hub_tenants — add slug + settings for Phase 2 multi-tenancy
    await pool.query(`ALTER TABLE hub_tenants ADD COLUMN IF NOT EXISTS slug TEXT`);
    await pool.query(`ALTER TABLE hub_tenants ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_tenants_slug ON hub_tenants (slug) WHERE slug IS NOT NULL`);
    // Promote admin (configurable via ADMIN_EMAIL env, fallback to mike@factorylm.com)
    const adminEmail = process.env.ADMIN_EMAIL ?? "mike@factorylm.com";
    await pool.query(
      `UPDATE hub_users SET status = 'admin' WHERE email_lower = LOWER($1) AND status != 'admin'`,
      [adminEmail],
    );
    await pool.query(`
      UPDATE hub_users SET trial_expires_at = created_at + INTERVAL '7 days'
      WHERE status = 'trial' AND trial_expires_at IS NULL
    `);
    // Phase 2: idempotent migrations for pipeline-managed tables
    await ensureDataSchema();
  })();
  return schemaReady;
}

function rowToUser(r: Record<string, unknown>): HubUser {
  return {
    id: String(r.id),
    email: String(r.email),
    passwordHash: (r.password_hash as string) ?? null,
    googleSub: (r.google_sub as string) ?? null,
    tenantId: String(r.tenant_id),
    name: (r.name as string) ?? null,
    role: String(r.role ?? "owner"),
    status: (r.status as UserStatus) ?? "trial",
    trialExpiresAt: r.trial_expires_at ? new Date(r.trial_expires_at as string) : null,
    plan: (r.plan as string) ?? null,
    preferences: (r.preferences as Record<string, unknown>) ?? {},
  };
}

const USER_COLS = "id, email, password_hash, google_sub, tenant_id, name, role, status, trial_expires_at, plan, preferences";

export async function findUserByEmail(email: string): Promise<HubUser | null> {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT ${USER_COLS} FROM hub_users WHERE email_lower = LOWER($1) LIMIT 1`,
    [email],
  );
  return rows[0] ? rowToUser(rows[0]) : null;
}

export async function findUserById(id: string): Promise<HubUser | null> {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT ${USER_COLS} FROM hub_users WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] ? rowToUser(rows[0]) : null;
}

export async function listAllUsers(): Promise<HubUser[]> {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT ${USER_COLS}, created_at FROM hub_users ORDER BY created_at DESC`,
  );
  return rows.map(rowToUser);
}

export async function updateUserStatus(id: string, status: UserStatus): Promise<void> {
  await ensureSchema();
  await pool.query(
    `UPDATE hub_users SET status = $1, updated_at = NOW() WHERE id = $2`,
    [status, id],
  );
}

// ── Magic link tokens ──────────────────────────────────────────────────────────

let magicSchemaReady: Promise<void> | null = null;

function ensureMagicSchema(): Promise<void> {
  if (magicSchemaReady) return magicSchemaReady;
  magicSchemaReady = (async () => {
    await ensureSchema();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hub_magic_tokens (
        token      TEXT PRIMARY KEY,
        email      TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at    TIMESTAMPTZ
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_magic_tokens_email ON hub_magic_tokens (email)
    `);
  })();
  return magicSchemaReady;
}

export async function createMagicToken(email: string): Promise<string> {
  await ensureMagicSchema();
  const { randomUUID } = await import("crypto");
  const token = randomUUID();
  await pool.query(
    `INSERT INTO hub_magic_tokens (token, email, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '15 minutes')
     ON CONFLICT (token) DO NOTHING`,
    [token, email.toLowerCase()],
  );
  return token;
}

export async function validateMagicToken(token: string): Promise<{ email: string } | null> {
  await ensureMagicSchema();
  const { rows } = await pool.query(
    `UPDATE hub_magic_tokens
     SET used_at = NOW()
     WHERE token = $1 AND expires_at > NOW() AND used_at IS NULL
     RETURNING email`,
    [token],
  );
  return rows[0] ? { email: String(rows[0].email) } : null;
}

export interface EnsureUserAndTenantInput {
  email: string;
  googleSub?: string;
  name?: string;
  passwordHash?: string;
}

export async function ensureUserAndTenant(
  input: EnsureUserAndTenantInput,
): Promise<{ id: string; tenantId: string; email: string }> {
  await ensureSchema();

  if (input.googleSub) {
    const { rows } = await pool.query(
      `SELECT id, email, tenant_id FROM hub_users WHERE google_sub = $1 LIMIT 1`,
      [input.googleSub],
    );
    if (rows[0]) {
      return { id: String(rows[0].id), tenantId: String(rows[0].tenant_id), email: String(rows[0].email) };
    }
  }

  const existingByEmail = await findUserByEmail(input.email);
  if (existingByEmail) {
    if (input.googleSub && !existingByEmail.googleSub) {
      await pool.query(
        `UPDATE hub_users SET google_sub = $1, updated_at = NOW() WHERE id = $2`,
        [input.googleSub, existingByEmail.id],
      );
    }
    return { id: existingByEmail.id, tenantId: existingByEmail.tenantId, email: existingByEmail.email };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tenantName = input.name?.trim() || input.email;
    const {
      rows: [tenant],
    } = await client.query(
      `INSERT INTO hub_tenants (name) VALUES ($1) RETURNING id`,
      [tenantName],
    );
    const tenantId = String(tenant.id);
    const {
      rows: [user],
    } = await client.query(
      `INSERT INTO hub_users (email, password_hash, google_sub, tenant_id, name, status, trial_expires_at)
       VALUES ($1, $2, $3, $4, $5, 'trial', NOW() + INTERVAL '7 days')
       RETURNING id, email`,
      [input.email, input.passwordHash ?? null, input.googleSub ?? null, tenantId, input.name ?? null],
    );
    await client.query(
      `UPDATE hub_tenants SET owner_user_id = $1 WHERE id = $2`,
      [String(user.id), tenantId],
    );
    await client.query("COMMIT");
    return { id: String(user.id), tenantId, email: String(user.email) };
  } catch (err) {
    await client.query("ROLLBACK");
    const conflict = await findUserByEmail(input.email);
    if (conflict) return { id: conflict.id, tenantId: conflict.tenantId, email: conflict.email };
    throw err;
  } finally {
    client.release();
  }
}

// ── User preferences ───────────────────────────────────────────────────────────

export async function getUserPreferences(userId: string): Promise<Record<string, unknown>> {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT preferences FROM hub_users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  return (rows[0]?.preferences as Record<string, unknown>) ?? {};
}

export async function setUserPreferences(
  userId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  await ensureSchema();
  const { rows } = await pool.query(
    `UPDATE hub_users
     SET preferences = preferences || $1::jsonb, updated_at = NOW()
     WHERE id = $2
     RETURNING preferences`,
    [JSON.stringify(patch), userId],
  );
  return (rows[0]?.preferences as Record<string, unknown>) ?? {};
}
