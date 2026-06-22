#!/usr/bin/env bun
/**
 * Provision a DEDICATED QA login (e.g. Hermes) in an existing tenant, so a
 * headless agent can sign in via the NextAuth password path.
 *
 * Unlike set-qa-member-password.ts (which only passwords an EXISTING member),
 * this CREATES a dedicated QA account in the target tenant — idempotently — and
 * sets its password. Use it when you want an attributable, revocable QA identity
 * rather than borrowing a real persona.
 *
 * Safety:
 *   - Verifies the target tenant exists before inserting (FK would fail anyway).
 *   - Idempotent: ON CONFLICT (email_lower) DO UPDATE — re-running rotates the
 *     password and re-pins the tenant/role/status, never duplicates.
 *   - status='active' (passes the middleware gate; not 'trial', which expires).
 *   - Prod writes are an operator-authorized action.
 *
 * Usage:
 *   QA_PASSWORD='<strong>' \
 *   doppler run --project factorylm --config prd -- \
 *     bun run mira-hub/scripts/provision-qa-user.ts
 *
 * Optional overrides:
 *   QA_EMAIL=hermes-qa@factorylm.com
 *   QA_NAME='Hermes QA'
 *   QA_ROLE=technician
 *   QA_TENANT_ID=e88bd0e8-8a84-4e30-9803-c0dc6efb07fe   # Stardust Racers tenant
 *
 * Revoke later: DELETE FROM hub_users WHERE email_lower = LOWER('<QA_EMAIL>');
 */

import { Pool } from "pg";
import bcrypt from "bcryptjs";

const QA_EMAIL = process.env.QA_EMAIL ?? "hermes-qa@factorylm.com";
const QA_NAME = process.env.QA_NAME ?? "Hermes QA";
const QA_ROLE = process.env.QA_ROLE ?? "technician";
const QA_TENANT_ID =
  process.env.QA_TENANT_ID ?? "e88bd0e8-8a84-4e30-9803-c0dc6efb07fe";
const QA_PASSWORD = process.env.QA_PASSWORD;

async function main() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) {
    console.error("Error: NEON_DATABASE_URL is required");
    process.exit(1);
  }
  if (!QA_PASSWORD || QA_PASSWORD.length < 12) {
    console.error("Error: QA_PASSWORD env is required (>= 12 chars).");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  try {
    const tenant = await client.query(
      `SELECT id, name FROM hub_tenants WHERE id = $1`,
      [QA_TENANT_ID],
    );
    if (tenant.rowCount === 0) {
      console.error(`Refusing: tenant ${QA_TENANT_ID} does not exist.`);
      process.exit(2);
    }
    console.log(`[qa-user] tenant: ${tenant.rows[0].name} (${QA_TENANT_ID})`);

    const passwordHash = await bcrypt.hash(QA_PASSWORD, 12);
    const { rows } = await client.query(
      `INSERT INTO hub_users (email, password_hash, tenant_id, name, role, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       ON CONFLICT (email_lower) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         tenant_id     = EXCLUDED.tenant_id,
         name          = EXCLUDED.name,
         role          = EXCLUDED.role,
         status        = 'active',
         updated_at    = now()
       RETURNING id, email, role, status, tenant_id`,
      [QA_EMAIL, passwordHash, QA_TENANT_ID, QA_NAME, QA_ROLE],
    );
    const u = rows[0];
    console.log(
      `[qa-user] ✅ ${u.email} (id=${u.id}) role=${u.role} status=${u.status} ` +
        `tenant=${u.tenant_id}`,
    );
    console.log(
      `[qa-user] Sign in at app.factorylm.com/login via "Sign in with password".`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("[qa-user] failed:", e);
  process.exit(1);
});
