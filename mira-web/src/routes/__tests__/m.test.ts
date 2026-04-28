// mira-web/src/routes/__tests__/m.test.ts
import { describe, test, expect, beforeAll } from "bun:test";
import { app } from "../../server.js";
import { signToken } from "../../lib/auth.js";
import { neon } from "@neondatabase/serverless";

const TEST_TENANT = "00000000-0000-0000-0000-000000000003";

function db() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error("NEON_DATABASE_URL required");
  return neon(url);
}

beforeAll(async () => {
  // PLG_JWT_SECRET lives in Doppler prd only. Inject a deterministic test
  // secret when absent so the suite runs under --config dev (which has
  // NEON_DATABASE_URL but not PLG_JWT_SECRET) and in ad-hoc local runs.
  process.env.PLG_JWT_SECRET ??= "test-secret-for-m-route-integration-tests";
  const sql = db();
  await sql`DELETE FROM qr_scan_events WHERE tenant_id = ${TEST_TENANT}::uuid`;
  await sql`DELETE FROM asset_qr_tags WHERE tenant_id = ${TEST_TENANT}::uuid`;
  await sql`INSERT INTO asset_qr_tags (tenant_id, asset_tag, atlas_asset_id) VALUES (${TEST_TENANT}::uuid, 'VFD-07', 42)`;
});

async function jwt(): Promise<string> {
  return await signToken({
    tenantId: TEST_TENANT,
    email: "test@example.com",
    tier: "active",
    atlasCompanyId: 1,
    atlasUserId: 100,
    atlasRole: "USER",
  });
}

describe("GET /m/:asset_tag", () => {
  test("redirects unauthed scan to chooser or report (not 401)", async () => {
    const res = await app.request("/m/VFD-07", { redirect: "manual" });
    // Unauthed scans route to chooser/report based on channel config
    expect(res.status).toBe(302);
  });

  test("302 with pending-scan cookie on valid scan", async () => {
    const token = await jwt();
    const res = await app.request("/m/VFD-07", {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/c/new");
    expect(res.headers.get("Set-Cookie")).toContain("mira_pending_scan=");
  });

  test("400 on malformed asset_tag", async () => {
    const token = await jwt();
    const res = await app.request("/m/%2F%2Fetc%2Fpasswd", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
  });

  // §12.6 oracle-prevention: both unknown tags get the SAME status (302 to
  // auto-register). An attacker cannot distinguish cross-tenant from nonexistent
  // via the scan response — both redirect identically.
  test("302 redirect to register for cross-tenant and nonexistent (oracle-safe)", async () => {
    const token = await jwt();
    const r1 = await app.request("/m/FAKE-NOEXIST", {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "manual",
    });
    const r2 = await app.request("/m/VFD-SOMEOTHERTENANT", {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "manual",
    });
    expect(r1.status).toBe(302);
    expect(r2.status).toBe(302);
    expect(r1.headers.get("Location")).toBe("/m/FAKE-NOEXIST/register");
    expect(r2.headers.get("Location")).toBe("/m/VFD-SOMEOTHERTENANT/register");
  });
});
