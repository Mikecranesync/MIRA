/**
 * Provision Mike's personal CMMS — bypasses Stripe, seeds directly.
 *
 * Run with Doppler:
 *   doppler run --project factorylm --config prd -- bun run mira-web/scripts/provision-mike.ts
 *
 * Env overrides for local dev (BRAVO direct):
 *   ATLAS_API_URL=http://100.86.236.11:8088
 *   MIRA_MCP_URL=http://100.86.236.11:8001
 */

import { neon } from "@neondatabase/serverless";
import { SignJWT } from "jose";

const ATLAS_URL = process.env.ATLAS_API_URL || "http://100.86.236.11:8088";
const TENANT_ID = process.env.MIRA_TENANT_ID || "";
const EMAIL = process.env.PLG_ATLAS_ADMIN_USER || "mike@cranesync.com";
const ATLAS_PASSWORD_DIRECT = process.env.PLG_ATLAS_ADMIN_PASSWORD || "";
const COMPANY = "FactoryLM";
const FIRST_NAME = "Mike";

function log(msg: string) {
  console.log(`[provision] ${msg}`);
}

async function atlasSignin(email: string, password: string) {
  const resp = await fetch(`${ATLAS_URL}/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Atlas signin failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  const accessToken = data.accessToken || data.token || "";

  // Signin only returns accessToken — fetch user profile for companyId/userId
  let companyId = data.companyId || 0;
  let userId = data.userId || 0;

  if (!companyId || !userId) {
    // Try user ID 2 (Mike's known admin ID) then walk 1-5
    for (const tryId of [2, 1, 3, 4, 5]) {
      try {
        const userResp = await fetch(`${ATLAS_URL}/users/${tryId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!userResp.ok) continue;
        const userData = await userResp.json();
        if (userData.email === email) {
          userId = userData.id;
          companyId = userData.companyId || 0;
          break;
        }
      } catch { /* try next */ }
    }
  }

  return { accessToken, companyId, userId };
}

async function upsertTenant(tenantId: string, email: string, company: string, firstName: string) {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error("NEON_DATABASE_URL not set");
  const sql = neon(url);

  await sql`
    INSERT INTO plg_tenants (id, email, company, first_name, tier, created_at)
    VALUES (${tenantId}, ${email}, ${company}, ${firstName}, 'active', NOW())
    ON CONFLICT (id) DO UPDATE SET
      tier = 'active',
      email = ${email},
      company = ${company},
      first_name = ${firstName}
  `;
}

async function updateTenantAtlas(tenantId: string, companyId: number, userId: number) {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error("NEON_DATABASE_URL not set");
  const sql = neon(url);

  await sql`
    UPDATE plg_tenants
    SET atlas_company_id = ${companyId},
        atlas_user_id = ${userId},
        atlas_provisioning_status = 'ok'
    WHERE id = ${tenantId}
  `;
}

async function mintJWT(tenantId: string, email: string, companyId: number, userId: number): Promise<string> {
  const secret = process.env.PLG_JWT_SECRET;
  if (!secret) throw new Error("PLG_JWT_SECRET not set");

  return new SignJWT({
    email,
    tier: "active",
    atlasCompanyId: companyId,
    atlasUserId: userId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(tenantId)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(new TextEncoder().encode(secret));
}

async function main() {
  if (!TENANT_ID) throw new Error("MIRA_TENANT_ID not set");

  log(`Tenant: ${TENANT_ID}`);
  log(`Email: ${EMAIL}`);
  log(`Atlas API: ${ATLAS_URL}`);
  log(`MCP URL: ${process.env.MIRA_MCP_URL || "http://100.86.236.11:8001"}`);
  console.log("");

  // Step 1: Upsert tenant in NeonDB
  log("Upserting tenant in NeonDB...");
  await upsertTenant(TENANT_ID, EMAIL, COMPANY, FIRST_NAME);
  log("Tenant upserted: tier=active");

  // Step 2: Atlas admin signin (existing company)
  log("Signing into Atlas admin account...");
  if (!ATLAS_PASSWORD_DIRECT) throw new Error("PLG_ATLAS_ADMIN_PASSWORD not set");
  const atlas = await atlasSignin(EMAIL, ATLAS_PASSWORD_DIRECT);
  log(`Atlas: companyId=${atlas.companyId} userId=${atlas.userId}`);

  // Step 3: Update NeonDB with Atlas IDs
  log("Updating NeonDB with Atlas IDs...");
  await updateTenantAtlas(TENANT_ID, atlas.companyId, atlas.userId);
  log("NeonDB updated: atlas_provisioning_status=ok");

  // Step 4: Seed demo data
  log("Seeding demo data (6 assets, 54 WOs, knowledge pipeline)...");
  console.log("");

  // Override ATLAS_API_URL for the seed imports (they read from env)
  process.env.ATLAS_API_URL = ATLAS_URL;
  process.env.MIRA_MCP_URL = process.env.MIRA_MCP_URL || "http://100.86.236.11:8001";

  const { seedDemoData } = await import("../src/seed/demo-data.js");
  await seedDemoData(atlas.accessToken);

  console.log("");

  // Step 5: Mint JWT
  log("Minting JWT...");
  const jwt = await mintJWT(TENANT_ID, EMAIL, atlas.companyId, atlas.userId);

  console.log("");
  console.log("=".repeat(70));
  console.log("PROVISIONING COMPLETE");
  console.log("=".repeat(70));
  console.log("");
  console.log(`Tenant ID:    ${TENANT_ID}`);
  console.log(`Email:        ${EMAIL}`);
  console.log(`Atlas Co:     ${atlas.companyId}`);
  console.log(`Atlas User:   ${atlas.userId}`);
  console.log("");
  console.log("JWT (30-day, save this):");
  console.log(jwt);
  console.log("");
  console.log("Login URL:");
  console.log(`https://factorylm.com/activated?token=${jwt}`);
  console.log("");
  console.log("Atlas Frontend (direct):");
  console.log(`http://100.86.236.11:3100/#accessToken=${atlas.accessToken}&companyId=${atlas.companyId}&userId=${atlas.userId}`);
  console.log("");
  console.log("=".repeat(70));
}

main().catch((err) => {
  console.error("[provision] FATAL:", err);
  process.exit(1);
});
