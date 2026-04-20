// mira-web/src/routes/admin/__tests__/qr-print.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { neon } from "@neondatabase/serverless";
import { app } from "../../../server.js";
import { signToken } from "../../../lib/auth.js";

// TEST_TENANT for DB-hitting POST test — distinct from ...0001 used by other suites
const TEST_TENANT = "00000000-0000-0000-0000-000000000004";

beforeAll(() => {
  // PLG_JWT_SECRET may not be in local dev env. Inject a deterministic test
  // secret matching the pattern in require-admin.test.ts and m.test.ts.
  process.env.PLG_JWT_SECRET ??= "test-secret-for-qr-print-tests";
});

function db() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) return null;
  return neon(url);
}

async function cleanupDb() {
  const sql = db();
  if (!sql) return;
  await sql`DELETE FROM asset_qr_tags WHERE tenant_id = ${TEST_TENANT}::uuid`;
}

afterAll(cleanupDb);

async function adminToken(): Promise<string> {
  return await signToken({
    tenantId: TEST_TENANT,
    email: "admin@example.com",
    tier: "active",
    atlasCompanyId: 1,
    atlasUserId: 1,
    atlasRole: "ADMIN",
  });
}

async function userToken(): Promise<string> {
  return await signToken({
    tenantId: TEST_TENANT,
    email: "u@example.com",
    tier: "active",
    atlasCompanyId: 1,
    atlasUserId: 2,
    atlasRole: "USER",
  });
}

describe("GET /admin/qr-print", () => {
  test("403 for USER", async () => {
    const res = await app.request("/admin/qr-print", {
      headers: { Authorization: `Bearer ${await userToken()}` },
    });
    expect(res.status).toBe(403);
  });

  test("200 HTML for ADMIN", async () => {
    const res = await app.request("/admin/qr-print", {
      headers: { Authorization: `Bearer ${await adminToken()}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Generate sticker sheet");
  });
});

describe("POST /api/admin/qr-print-batch", () => {
  test("403 for USER", async () => {
    const res = await app.request("/api/admin/qr-print-batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await userToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tags: [{ asset_tag: "VFD-07", atlas_asset_id: 42 }] }),
    });
    expect(res.status).toBe(403);
  });

  test("400 on empty tags", async () => {
    const res = await app.request("/api/admin/qr-print-batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await adminToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tags: [] }),
    });
    expect(res.status).toBe(400);
  });

  test("200 PDF for valid ADMIN request", async () => {
    const res = await app.request("/api/admin/qr-print-batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await adminToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tags: [
          { asset_tag: "VFD-07", atlas_asset_id: 42 },
          { asset_tag: "PUMP-22", atlas_asset_id: 43 },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(500);
  });
});
