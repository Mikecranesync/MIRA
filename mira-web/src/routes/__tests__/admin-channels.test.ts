import { describe, test, expect, beforeAll } from "bun:test";
import { app } from "../../server.js";
import { signToken } from "../../lib/auth.js";
import { neon } from "@neondatabase/serverless";

const TEST_TENANT = "00000000-0000-0000-0000-000000000012";

function db() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error("NEON_DATABASE_URL required");
  return neon(url);
}

beforeAll(async () => {
  process.env.PLG_JWT_SECRET ??= "test-secret-for-channels-tests";
  const sql = db();
  await sql`DELETE FROM tenant_channel_config WHERE tenant_id = ${TEST_TENANT}::uuid`;
});

async function adminJwt(): Promise<string> {
  return signToken({
    tenantId: TEST_TENANT,
    email: "admin@example.com",
    tier: "active",
    atlasCompanyId: 2,
    atlasUserId: 200,
    atlasRole: "ADMIN",
  });
}

async function userJwt(): Promise<string> {
  return signToken({
    tenantId: TEST_TENANT,
    email: "user@example.com",
    tier: "active",
    atlasCompanyId: 2,
    atlasUserId: 201,
    atlasRole: "USER",
  });
}

describe("GET /admin/channels", () => {
  test("401 without auth", async () => {
    const res = await app.request("/admin/channels");
    expect(res.status).toBe(401);
  });

  test("403 for non-admin user", async () => {
    const token = await userJwt();
    const res = await app.request("/admin/channels", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  test("200 renders channel settings page for admin", async () => {
    const token = await adminJwt();
    const res = await app.request("/admin/channels", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toContain("channel");
  });
});

describe("POST /api/admin/channels", () => {
  test("401 without auth", async () => {
    const res = await app.request("/api/admin/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled_channels: ["openwebui"] }),
    });
    expect(res.status).toBe(401);
  });

  test("400 when enabled_channels is empty", async () => {
    const token = await adminJwt();
    const res = await app.request("/api/admin/channels", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled_channels: [] }),
    });
    expect(res.status).toBe(400);
  });

  test("400 when unknown channel name passed", async () => {
    const token = await adminJwt();
    const res = await app.request("/api/admin/channels", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled_channels: ["bogus-channel"] }),
    });
    expect(res.status).toBe(400);
  });

  test("200 + upserts tenant_channel_config", async () => {
    const token = await adminJwt();
    const res = await app.request("/api/admin/channels", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        enabled_channels: ["telegram", "guest"],
        telegram_bot_username: "MiraBot",
      }),
    });
    expect(res.status).toBe(200);

    const sql = db();
    const rows = await sql`
      SELECT enabled_channels, telegram_bot_username
      FROM tenant_channel_config
      WHERE tenant_id = ${TEST_TENANT}::uuid`;
    expect(rows.length).toBe(1);
    expect(rows[0]!.enabled_channels).toEqual(["telegram", "guest"]);
    expect(rows[0]!.telegram_bot_username).toBe("MiraBot");
  });
});
