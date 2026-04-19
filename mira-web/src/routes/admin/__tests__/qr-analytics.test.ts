// mira-web/src/routes/admin/__tests__/qr-analytics.test.ts
import { describe, test, expect, beforeAll } from "bun:test";
import { app } from "../../../server.js";
import { signToken } from "../../../lib/auth.js";

beforeAll(() => {
  process.env.PLG_JWT_SECRET ??= "test-secret-for-qr-analytics-tests";
});

async function adminToken(): Promise<string> {
  return await signToken({
    tenantId: "00000000-0000-0000-0000-000000000001",
    email: "admin@example.com",
    tier: "active",
    atlasCompanyId: 1,
    atlasUserId: 1,
    atlasRole: "ADMIN",
  });
}

describe("GET /admin/qr-analytics", () => {
  test("200 HTML with asset_tag table header", async () => {
    const res = await app.request("/admin/qr-analytics", {
      headers: { Authorization: `Bearer ${await adminToken()}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Asset tag");
    expect(html).toContain("Scan count");
    expect(html).toContain("Last scan");
  });
});
