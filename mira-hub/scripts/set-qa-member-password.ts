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
 *   QA_CONFIRM=SET_QA_MEMBER_PASSWORD_PROD \
 *   QA_PASSWORD='<strong-password>' \
 *   doppler run --project factorylm --config prd -- \
 *     bun run mira-hub/scripts/set-qa-member-password.ts
 *
 * Optional overrides (defaults target rico@ in the Stardust tenant):
 *   QA_EMAIL=rico@factorylm.com
 *   QA_TENANT_ID=e88bd0e8-8a84-4e30-9803-c0dc6efb07fe
 *
 * Hermes aliases:
 *   HERMES_HUB_EMAIL and HERMES_HUB_PASSWORD are accepted as aliases for
 *   QA_EMAIL and QA_PASSWORD so the same Doppler secrets can feed Hermes.
 *
 * Revoke later (operator): clear the hash to send the account back to SSO-only —
 *   UPDATE hub_users SET password_hash = NULL
 *    WHERE email = '<QA_EMAIL>' AND tenant_id = '<QA_TENANT_ID>';
 */

import { Pool } from "pg";
import bcrypt from "bcryptjs";

const LOCAL_WEAK_PASSWORD = "SynthTest2026!";
const CONFIRM_TOKEN = "SET_QA_MEMBER_PASSWORD_PROD";
const TARGET = (process.env.QA_PASSWORD_TARGET ?? process.env.DOPPLER_CONFIG ?? "dev").toLowerCase();
const IS_PROD = ["prd", "prod", "production"].includes(TARGET);
const FORBIDDEN_PASSWORD_PATTERNS = [/synthtest/i, /^password/i, /factorylm/i];

const QA_EMAIL = process.env.QA_EMAIL ?? process.env.HERMES_HUB_EMAIL ?? "rico@factorylm.com";
const QA_TENANT_ID =
  process.env.QA_TENANT_ID ?? "e88bd0e8-8a84-4e30-9803-c0dc6efb07fe";
const QA_PASSWORD = process.env.QA_PASSWORD ?? process.env.HERMES_HUB_PASSWORD;

function validatePasswordConfig(): string {
  if (!QA_PASSWORD || QA_PASSWORD.length < 16) {
    console.error(
      "Error: QA_PASSWORD or HERMES_HUB_PASSWORD env is required and must be >= 16 chars " +
        "(this is a real prod login).",
    );
    process.exit(1);
  }
  if (QA_PASSWORD === LOCAL_WEAK_PASSWORD || FORBIDDEN_PASSWORD_PATTERNS.some((pattern) => pattern.test(QA_PASSWORD))) {
    console.error("Error: QA password is too weak or matches a forbidden test/brand pattern.");
    process.exit(1);
  }
  if (IS_PROD && process.env.QA_CONFIRM !== CONFIRM_TOKEN) {
    console.error(`Error: production password writes require QA_CONFIRM=${CONFIRM_TOKEN}.`);
    process.exit(1);
  }
  return QA_PASSWORD;
}

async function main() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) {
    console.error("Error: NEON_DATABASE_URL is required");
    process.exit(1);
  }
  const qaPassword = validatePasswordConfig();

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
    if (u.status !== "approved") {
      console.error(`Refusing: target member is not approved (status=${u.status}).`);
      process.exit(2);
    }
    console.log(
      `[qa-password] target: ${u.email} (${u.name ?? "—"}) role=${u.role} ` +
        `status=${u.status} tenant=${QA_TENANT_ID} had_password=${u.had_password}`,
    );

    // 2. Set the password (bcrypt 12, same cost as the rest of the app).
    const passwordHash = await bcrypt.hash(qaPassword, 12);
    const result = await client.query(
      `UPDATE hub_users SET password_hash = $1 WHERE id = $2 AND tenant_id = $3`,
      [passwordHash, u.id, QA_TENANT_ID],
    );
    if (result.rowCount !== 1) {
      throw new Error(`Expected to update exactly one QA member, updated ${result.rowCount ?? 0}.`);
    }
    const verified = await client.query(
      `SELECT password_hash IS NOT NULL AS has_password
         FROM hub_users
        WHERE id = $1 AND tenant_id = $2`,
      [u.id, QA_TENANT_ID],
    );
    if (verified.rowCount !== 1 || verified.rows[0]?.has_password !== true) {
      throw new Error("Password update verification failed for the target QA member.");
    }
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
