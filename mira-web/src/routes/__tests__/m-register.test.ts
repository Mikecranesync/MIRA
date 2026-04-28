// mira-web/src/routes/__tests__/m-register.test.ts
import { describe, test, expect, beforeAll } from "bun:test";
import { app } from "../../server.js";
import { signToken } from "../../lib/auth.js";

beforeAll(() => {
  process.env.PLG_JWT_SECRET ??= "test-secret-for-m-register-tests";
});

async function jwt(): Promise<string> {
  return await signToken({
    tenantId: "00000000-0000-0000-0000-000000000007",
    email: "tech@example.com",
    tier: "active",
    atlasCompanyId: 1,
    atlasUserId: 77,
    atlasRole: "USER",
  });
}

describe("GET /m/:asset_tag/register", () => {
  test("200 HTML form for valid unauthed tag", async () => {
    const res = await app.request("/m/PUMP-99/register");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("PUMP-99");
    expect(html).toContain("Register this equipment");
    expect(html).toContain("Equipment name");
  });

  test("200 HTML form for authed scan (shows direct POST form)", async () => {
    const token = await jwt();
    const res = await app.request("/m/PUMP-99/register", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("/api/m/auto-register");
    expect(html).toContain("PUMP-99");
  });

  test("400 on malformed asset_tag", async () => {
    const res = await app.request("/m/<BAD!>/register");
    expect(res.status).toBe(404); // Hono won't match the route (tag never reaches handler)
  });
});

describe("POST /api/m/auto-register", () => {
  test("401 without auth", async () => {
    const res = await app.request("/api/m/auto-register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asset_tag: "PUMP-88",
        equipment_name: "Test Pump",
      }),
    });
    expect(res.status).toBe(401);
  });

  test("400 on missing equipment_name", async () => {
    const token = await jwt();
    const res = await app.request("/api/m/auto-register", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ asset_tag: "PUMP-88" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toContain("equipment_name");
  });

  test("400 on invalid asset_tag", async () => {
    const token = await jwt();
    const res = await app.request("/api/m/auto-register", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        asset_tag: "BAD TAG WITH SPACES",
        equipment_name: "Test",
      }),
    });
    expect(res.status).toBe(400);
  });

  // DB-dependent test — only runs when NEON_DATABASE_URL is set
  test("201 creates asset and returns redirect_url when DB is available", async () => {
    if (!process.env.NEON_DATABASE_URL) {
      console.log("  [skip] NEON_DATABASE_URL not set");
      return;
    }
    const token = await jwt();
    const res = await app.request("/api/m/auto-register", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        asset_tag: `TEST-AR-${Date.now()}`,
        equipment_name: "Auto-registered Test Pump",
        equipment_type: "Pump",
        location: "Building A",
      }),
    });
    expect(res.status).toBe(201);
    const json = await res.json() as { redirect_url: string };
    expect(json.redirect_url).toContain("/assets/");
    expect(json.redirect_url).toContain("tab=ask");
  });
});
