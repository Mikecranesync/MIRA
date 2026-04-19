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
  });
}

describe("GET /m/:asset_tag", () => {
  test("401 without auth", async () => {
    const res = await app.request("/m/VFD-07");
    expect(res.status).toBe(401);
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

  test("200 identical HTML for cross-tenant and nonexistent", async () => {
    const token = await jwt();
    const r1 = await app.request("/m/FAKE-NOEXIST", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const r2 = await app.request("/m/VFD-SOMEOTHERTENANT", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(await r1.text()).toBe(await r2.text());
  });
});
