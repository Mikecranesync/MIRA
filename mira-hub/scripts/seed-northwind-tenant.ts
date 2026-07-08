#!/usr/bin/env bun
/**
 * Northwind Beverage demo tenant + login seeder.
 *
 * Creates the dedicated bottling-line demo tenant and ONE demo owner user so the
 * FactoryLM Hub promo can be recorded against a neutral, generic plant (no
 * Stardust Racers / Lake Wales / garage conveyor). Run this BEFORE
 * tools/seeds/northwind-bottling-hub.sql (which populates that tenant's plant).
 *
 * Idempotent: deterministic UUIDs + ON CONFLICT. Uses the same `bcryptjs` the
 * Hub login verifies with (avoids the $2a/$2b prefix mismatch that biting SQL
 * crypt() would risk — see .claude/rules/debugging-conventions.md).
 *
 * Usage (staging first, then prod with approval):
 *   doppler run -p factorylm -c stg -- bun run scripts/seed-northwind-tenant.ts
 *   doppler run -p factorylm -c prd -- bun run scripts/seed-northwind-tenant.ts   # YOU run/approve
 *
 * Required env:
 *   NEON_DATABASE_URL          — target Neon branch
 *   NORTHWIND_DEMO_PASSWORD    — login password (else falls back to the synthetic default)
 */
import { Client } from "pg";
import bcrypt from "bcryptjs";

const TENANT_ID = "00000000-0000-0000-0000-0000000000b1"; // bottling demo tenant
const USER_ID = "00000000-0000-0000-0000-0000000000b2";
const EMAIL = process.env.NORTHWIND_DEMO_EMAIL ?? "demo@northwind.test";
const PASSWORD =
  process.env.NORTHWIND_DEMO_PASSWORD ??
  process.env.SYNTHETIC_CARLOS_PASSWORD ??
  "SynthTest2026!";

async function main() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) { console.error("NEON_DATABASE_URL required"); process.exit(1); }
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO hub_tenants (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [TENANT_ID, "Northwind Beverage Co."],
    );
    const hash = await bcrypt.hash(PASSWORD, 12);
    await client.query(
      `INSERT INTO hub_users (id, email, password_hash, tenant_id, name, role, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         tenant_id     = EXCLUDED.tenant_id,
         role          = EXCLUDED.role,
         status        = EXCLUDED.status`,
      [USER_ID, EMAIL, hash, TENANT_ID, "Demo Owner", "owner", "approved"],
    );
    await client.query("COMMIT");
    console.log(`[seed] tenant ${TENANT_ID} (Northwind Beverage Co.) ready`);
    console.log(`[seed] login: ${EMAIL}  (password from NORTHWIND_DEMO_PASSWORD)`);
    console.log(`[seed] next: psql -v tenant_id=${TENANT_ID} -f tools/seeds/northwind-bottling-hub.sql`);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[seed] FAILED:", e);
    process.exit(1);
  } finally {
    await client.end();
  }
}
main();
