import pool from "@/lib/db";

export interface HubUser {
  id: string;
  email: string;
  passwordHash: string | null;
  googleSub: string | null;
  tenantId: string;
  name: string | null;
  role: string;
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
        role           TEXT NOT NULL DEFAULT 'owner',
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  };
}

export async function findUserByEmail(email: string): Promise<HubUser | null> {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT id, email, password_hash, google_sub, tenant_id, name, role
       FROM hub_users WHERE email_lower = LOWER($1) LIMIT 1`,
    [email],
  );
  return rows[0] ? rowToUser(rows[0]) : null;
}

export async function findUserById(id: string): Promise<HubUser | null> {
  await ensureSchema();
  const { rows } = await pool.query(
    `SELECT id, email, password_hash, google_sub, tenant_id, name, role
       FROM hub_users WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] ? rowToUser(rows[0]) : null;
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
      `INSERT INTO hub_users (email, password_hash, google_sub, tenant_id, name)
       VALUES ($1, $2, $3, $4, $5)
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
