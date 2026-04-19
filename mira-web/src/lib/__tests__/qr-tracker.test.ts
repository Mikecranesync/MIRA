// mira-web/src/lib/__tests__/qr-tracker.test.ts
import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { neon } from "@neondatabase/serverless";
import { resolveAssetForScan, recordScan, ASSET_TAG_RE } from "../qr-tracker.js";

const TEST_TENANT = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-000000000002";

function db() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error("NEON_DATABASE_URL required");
  return neon(url);
}

async function cleanup() {
  const sql = db();
  await sql`DELETE FROM qr_scan_events WHERE tenant_id = ANY(ARRAY[${TEST_TENANT}::uuid, ${OTHER_TENANT}::uuid])`;
  await sql`DELETE FROM asset_qr_tags WHERE tenant_id = ANY(ARRAY[${TEST_TENANT}::uuid, ${OTHER_TENANT}::uuid])`;
}

beforeAll(async () => {
  if (!process.env.NEON_DATABASE_URL) throw new Error("NEON_DATABASE_URL required");
  await cleanup();
});

afterEach(cleanup);

describe("ASSET_TAG_RE", () => {
  test("accepts valid tags", () => {
    for (const ok of ["VFD-07", "PUMP_22.NORTH", "CP-14-A", "a"]) {
      expect(ASSET_TAG_RE.test(ok)).toBe(true);
    }
  });
  test("rejects invalid tags", () => {
    for (const bad of ["", " ", "VFD 07", "../../etc/passwd", "x".repeat(65)]) {
      expect(ASSET_TAG_RE.test(bad)).toBe(false);
    }
  });
});

describe("resolveAssetForScan", () => {
  test("returns the atlas_asset_id when tag exists for tenant", async () => {
    const sql = db();
    await sql`INSERT INTO asset_qr_tags (tenant_id, asset_tag, atlas_asset_id) VALUES (${TEST_TENANT}::uuid, 'VFD-07', 42)`;
    const r = await resolveAssetForScan(TEST_TENANT, "VFD-07");
    expect(r).toEqual({ found: true, atlas_asset_id: 42 });
  });

  test("case-insensitive lookup", async () => {
    const sql = db();
    await sql`INSERT INTO asset_qr_tags (tenant_id, asset_tag, atlas_asset_id) VALUES (${TEST_TENANT}::uuid, 'VFD-07', 42)`;
    const r = await resolveAssetForScan(TEST_TENANT, "vfd-07");
    expect(r.found).toBe(true);
  });

  test("returns not-found for tag in another tenant (no distinguishing output)", async () => {
    const sql = db();
    await sql`INSERT INTO asset_qr_tags (tenant_id, asset_tag, atlas_asset_id) VALUES (${OTHER_TENANT}::uuid, 'VFD-07', 42)`;
    const r = await resolveAssetForScan(TEST_TENANT, "VFD-07");
    expect(r).toEqual({ found: false });
  });

  test("returns not-found for tag that doesn't exist anywhere", async () => {
    const r = await resolveAssetForScan(TEST_TENANT, "FAKE-NOEXIST-999");
    expect(r).toEqual({ found: false });
  });
});

describe("recordScan", () => {
  test("UPSERTs asset_qr_tags + inserts qr_scan_events on found", async () => {
    const sql = db();
    await sql`INSERT INTO asset_qr_tags (tenant_id, asset_tag, atlas_asset_id) VALUES (${TEST_TENANT}::uuid, 'VFD-07', 42)`;
    const scanId = await recordScan({
      tenant_id: TEST_TENANT,
      asset_tag: "VFD-07",
      atlas_user_id: 100,
      user_agent: "ua",
      found: true,
    });
    expect(scanId).toMatch(/^[0-9a-f-]{36}$/);

    const tags = await sql`
      SELECT scan_count, first_scan, last_scan FROM asset_qr_tags
      WHERE tenant_id = ${TEST_TENANT}::uuid AND asset_tag = 'VFD-07'`;
    expect(tags[0].scan_count).toBe(1);

    const events = await sql`
      SELECT COUNT(*)::int AS n FROM qr_scan_events
      WHERE tenant_id = ${TEST_TENANT}::uuid AND asset_tag = 'VFD-07'`;
    expect(events[0].n).toBe(1);
  });

  test("only inserts qr_scan_events when found=false (no tag row)", async () => {
    const sql = db();
    await recordScan({
      tenant_id: TEST_TENANT,
      asset_tag: "FAKE",
      atlas_user_id: null,
      user_agent: "ua",
      found: false,
    });
    const tags = await sql`
      SELECT COUNT(*)::int AS n FROM asset_qr_tags
      WHERE tenant_id = ${TEST_TENANT}::uuid`;
    expect(tags[0].n).toBe(0);

    const events = await sql`
      SELECT COUNT(*)::int AS n FROM qr_scan_events
      WHERE tenant_id = ${TEST_TENANT}::uuid`;
    expect(events[0].n).toBe(1);
  });
});
