import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { app } from "../../server.js";
import { neon } from "@neondatabase/serverless";
import { buildChannelPrefCookie } from "../../lib/cookie-session.js";

const TEST_TENANT = "00000000-0000-0000-0000-000000000010";

function db() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error("NEON_DATABASE_URL required");
  return neon(url);
}

beforeAll(async () => {
  process.env.PLG_JWT_SECRET ??= "test-secret-for-chooser-tests";
  const sql = db();
  await sql`DELETE FROM tenant_channel_config WHERE tenant_id = ${TEST_TENANT}::uuid`;
  await sql`DELETE FROM asset_qr_tags WHERE tenant_id = ${TEST_TENANT}::uuid`;
  await sql`
    INSERT INTO asset_qr_tags (tenant_id, asset_tag, atlas_asset_id)
    VALUES (${TEST_TENANT}::uuid, 'VFD-CHOOSER', 99)`;
  await sql`
    INSERT INTO tenant_channel_config (tenant_id, enabled_channels, telegram_bot_username, allow_guest_reports)
    VALUES (${TEST_TENANT}::uuid, ARRAY['telegram','openwebui','guest'], 'MiraTestBot', true)
    ON CONFLICT (tenant_id) DO UPDATE SET
      enabled_channels = EXCLUDED.enabled_channels,
      telegram_bot_username = EXCLUDED.telegram_bot_username`;
});

afterEach(async () => {
  // no cleanup needed between tests
});

describe("GET /m/:asset_tag/choose", () => {
  test("200 with all 3 channel buttons in tenant order", async () => {
    const res = await app.request("/m/VFD-CHOOSER/choose");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("telegram");
    expect(html).toContain("openwebui");
    expect(html).toContain("guest");
    // Telegram appears before openwebui (admin order)
    expect(html.indexOf("telegram")).toBeLessThan(html.indexOf("openwebui"));
    expect(html.indexOf("openwebui")).toBeLessThan(html.indexOf("guest"));
  });

  test("400 on malformed asset_tag", async () => {
    const res = await app.request("/m/%2F%2Fetc/choose");
    expect(res.status).toBe(400);
  });

  test("200 not-found HTML for nonexistent tag", async () => {
    const res = await app.request("/m/NOEXIST-CHOOSER-TAG/choose");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Asset not found");
  });

  test("sets mira_channel_pref cookie when ?set_pref=telegram is passed", async () => {
    const res = await app.request("/m/VFD-CHOOSER/choose?set_pref=telegram", {
      redirect: "manual",
    });
    // Should redirect after setting cookie
    expect([302, 303]).toContain(res.status);
    expect(res.headers.get("Set-Cookie")).toContain("mira_channel_pref=");
  });
});

describe("GET /m/:asset_tag — unauthed chooser routing", () => {
  test("unauthed scan with no channel_pref → redirect to chooser", async () => {
    const res = await app.request("/m/VFD-CHOOSER", { redirect: "manual" });
    // Should redirect to chooser
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain("/choose");
  });

  test("unauthed scan with valid channel_pref cookie → bypass chooser", async () => {
    const cookieHeader = await buildChannelPrefCookie("openwebui");
    const res = await app.request("/m/VFD-CHOOSER", {
      headers: { Cookie: cookieHeader.split(";")[0]!.replace("mira_channel_pref=", "mira_channel_pref=") + "; " + cookieHeader },
      redirect: "manual",
    });
    // Should redirect somewhere other than the chooser
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).not.toContain("/choose");
  });
});
