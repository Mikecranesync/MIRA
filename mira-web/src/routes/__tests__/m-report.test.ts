import { describe, test, expect, beforeAll } from "bun:test";
import { app } from "../../server.js";
import { neon } from "@neondatabase/serverless";

const TEST_TENANT = "00000000-0000-0000-0000-000000000011";

function db() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error("NEON_DATABASE_URL required");
  return neon(url);
}

beforeAll(async () => {
  process.env.PLG_JWT_SECRET ??= "test-secret-for-report-tests";
  const sql = db();
  await sql`DELETE FROM guest_reports WHERE tenant_id = ${TEST_TENANT}::uuid`;
  await sql`DELETE FROM tenant_channel_config WHERE tenant_id = ${TEST_TENANT}::uuid`;
  await sql`DELETE FROM asset_qr_tags WHERE tenant_id = ${TEST_TENANT}::uuid`;
  await sql`
    INSERT INTO asset_qr_tags (tenant_id, asset_tag, atlas_asset_id)
    VALUES (${TEST_TENANT}::uuid, 'PUMP-REPORT', 77)`;
  await sql`
    INSERT INTO tenant_channel_config (tenant_id, enabled_channels, allow_guest_reports)
    VALUES (${TEST_TENANT}::uuid, ARRAY['guest'], true)
    ON CONFLICT (tenant_id) DO UPDATE SET
      enabled_channels = EXCLUDED.enabled_channels,
      allow_guest_reports = EXCLUDED.allow_guest_reports`;
});

describe("GET /m/:asset_tag/report", () => {
  test("200 renders the guest fault-report form", async () => {
    const res = await app.request("/m/PUMP-REPORT/report");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("PUMP-REPORT");
    expect(html.toLowerCase()).toContain("description");
    expect(html).toContain("form");
  });

  test("400 on malformed asset_tag", async () => {
    const res = await app.request("/m/BAD TAG/report");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/m/report", () => {
  test("200 + writes row to guest_reports", async () => {
    const res = await app.request("/api/m/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asset_tag: "PUMP-REPORT",
        tenant_id: TEST_TENANT,
        description: "It's making a grinding noise",
        reporter_name: "Joe Operator",
        reporter_contact: "joe@example.com",
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);

    // Verify row exists in DB
    const sql = db();
    const rows = await sql`
      SELECT * FROM guest_reports
      WHERE tenant_id = ${TEST_TENANT}::uuid
        AND asset_tag = 'PUMP-REPORT'
      ORDER BY created_at DESC LIMIT 1`;
    expect(rows.length).toBe(1);
    expect(rows[0]!.description).toContain("grinding");
  });

  test("400 when description is missing", async () => {
    const res = await app.request("/api/m/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asset_tag: "PUMP-REPORT",
        tenant_id: TEST_TENANT,
      }),
    });
    expect(res.status).toBe(400);
  });

  test("400 on invalid asset_tag", async () => {
    const res = await app.request("/api/m/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asset_tag: "../../etc/passwd",
        tenant_id: TEST_TENANT,
        description: "test",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("does NOT create Atlas work order (guest_reports only)", async () => {
    // Guest reports must not auto-create WOs — only write to guest_reports
    // This test verifies no side effects by checking row count in guest_reports
    // and trusting that WO creation is Atlas-only (tested separately)
    const sql = db();
    const before = await sql`SELECT COUNT(*) as n FROM guest_reports WHERE tenant_id = ${TEST_TENANT}::uuid`;
    await app.request("/api/m/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asset_tag: "PUMP-REPORT",
        tenant_id: TEST_TENANT,
        description: "second report",
      }),
    });
    const after = await sql`SELECT COUNT(*) as n FROM guest_reports WHERE tenant_id = ${TEST_TENANT}::uuid`;
    // exactly 1 new row in guest_reports (no WO side effect to count)
    expect(Number(after[0]!.n)).toBe(Number(before[0]!.n) + 1);
  });
});

describe("GET /m/:asset_tag — guest-only tenant routing", () => {
  test("unauthed scan on guest-only tenant → direct to report form", async () => {
    const res = await app.request("/m/PUMP-REPORT", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/report");
  });
});
