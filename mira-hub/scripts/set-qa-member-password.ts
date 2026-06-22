#!/usr/bin/env bun
/**
 * Set a password on an EXISTING tenant member, so a headless QA agent (Hermes)
 * can log in via the NextAuth password path for secret-shopper testing.
 *
 * Why this exists: the Stardust Racers UNS data lives in a real tenant
 * (e88bd0e8-…), whose members are Google-SSO-only (no password). A headless
 * agent can't do SSO, so it needs ONE member with a password. This grants that
 * — narrowly, to an account that ALREADY belongs to the target tenant.
 *
 * Safety design (read before running against prod):
 *   - It NEVER creates a user and NEVER changes tenant membership. It only sets
 *     a password_hash on a member that already exists IN the given tenant.
 *   - If the email isn't found in that tenant, it refuses (no cross-tenant, no
 *     accidental new account).
 *   - The password is taken from QA_PASSWORD (no default) — pick a STRONG one;
 *     this is a real login on prod, not a throwaway like SynthTest2026!.
 *   - Prod writes are the operator's authorized action: run it yourself via
 *     Doppler. Do not run it from an automated/code session.
 *
 * Usage (operator runs against the target env — staging first if unsure):
 *   QA_PASSWORD='<strong-password>' \
 *   doppler run --project factorylm --config prd -- \
 *     bun run mira-hub/scripts/set-qa-member-password.ts
 *
 * Optional overrides (defaults target rico@ in the Stardust tenant):
 *   QA_EMAIL=rico@factorylm.com
 *   QA_TENANT_ID=e88bd0e8-8a84-4e30-9803-c0dc6efb07fe
 *
 * Revoke later (operator): clear the hash to send the account back to SSO-only —
 *   UPDATE hub_users SET password_hash = NULL
 *    WHERE email = '<QA_EMAIL>' AND tenant_id = '<QA_TENANT_ID>';
 */

import { Pool } from "pg";
import bcrypt from "bcryptjs";

const QA_EMAIL = process.env.QA_EMAIL ?? "rico@factorylm.com";
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
    console.error(
      "Error: QA_PASSWORD env is required and must be >= 12 chars (this is a real prod login).",
    );
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  try {
    // 1. The member must ALREADY exist in the target tenant. No create, no move.
    const found = await client.query(
      `SELECT id, email, name, role, status, (password_hash IS NOT NULL) AS had_password
         FROM hub_users
        WHERE email = $1 AND tenant_id = $2`,
      [QA_EMAIL, QA_TENANT_ID],
    );
    if (found.rowCount === 0) {
      console.error(
        `Refusing: ${QA_EMAIL} is not a member of tenant ${QA_TENANT_ID}. ` +
          `This script only sets a password on an existing member — it will not ` +
          `create an account or change tenant membership.`,
      );
      process.exit(2);
    }
    const u = found.rows[0];
    console.log(
      `[qa-password] target: ${u.email} (${u.name ?? "—"}) role=${u.role} ` +
        `status=${u.status} tenant=${QA_TENANT_ID} had_password=${u.had_password}`,
    );

    // 2. Set the password (bcrypt 12, same cost as the rest of the app).
    const passwordHash = await bcrypt.hash(QA_PASSWORD, 12);
    await client.query(
      `UPDATE hub_users SET password_hash = $1 WHERE id = $2`,
      [passwordHash, u.id],
    );
    console.log(
      `[qa-password] ✅ password set. ${u.email} can now sign in via the ` +
        `"Sign in with password" path and will land in the Stardust tenant.`,
    );
    console.log(
      `[qa-password] (password itself NOT printed — share it with the QA agent out of band.)`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("[qa-password] failed:", e);
  process.exit(1);
});
