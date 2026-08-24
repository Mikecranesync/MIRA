/**
 * POST /api/assets — a created asset must come out WHOLE.
 *
 * Run: npx vitest run src/app/api/assets
 *
 * This is the wiring test the original bug slipped through. Creating an asset
 * wrote `cmms_equipment` and nothing else, so `/api/assets/by-tag/{tag}`
 * resolved a scanned sticker but `/api/assets/{id}/notebook` then 404'd with
 * "That asset isn't in this account". CV-101 was the only machine that worked,
 * because its kg_entities bridge row had been seeded by hand — and an
 * acceptance test that only exercised CV-101 could never see it.
 *
 * Two properties are asserted, and both matter:
 *   1. the bridge is minted at all, keyed to the new asset's id and tag;
 *   2. it is minted on the SAME client as the insert, i.e. inside the same
 *      transaction — so a create either yields a whole machine or nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionMock = vi.hoisted(() => ({
  sessionOr401: vi.fn(async () => ({ tenantId: "11111111-1111-4111-8111-111111111111", userId: "u1" })),
}));
vi.mock("@/lib/session", () => sessionMock);

vi.mock("@/lib/capabilities", () => ({ requireCapability: vi.fn(() => null) }));
vi.mock("@/lib/agents/asset-intelligence", () => ({ enrichAsset: vi.fn(async () => undefined) }));

const ASSET_ID = "ee715d08-4ea6-4b7a-b99b-958a33c39ea8";
const ROW = {
  id: ASSET_ID,
  equipment_number: "CV-207",
  manufacturer: "Allen-Bradley",
  model_number: "2080-LC20-20QBB",
  description: "Discharge Conveyor",
};

// One client per transaction, so the test can prove the bridge ran on it.
const client = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [] as unknown[] })) }));
const tenantMock = vi.hoisted(() => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/tenant-context", () => tenantMock);

const bridgeMock = vi.hoisted(() => ({
  mintAssetBridgeNode: vi.fn(),
  backfillAssetUnsPath: vi.fn(async () => undefined),
}));
vi.mock("@/lib/knowledge-graph/asset-bridge", () => bridgeMock);

import { POST } from "../route";

function req(body: unknown) {
  return new Request("http://test/api/assets", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  client.query.mockResolvedValue({ rows: [ROW] });
  tenantMock.withTenantContext.mockImplementation(
    async (_tenantId: string, fn: (c: unknown) => Promise<unknown>) => fn(client),
  );
  bridgeMock.mintAssetBridgeNode.mockResolvedValue({
    ok: true,
    created: true,
    nodeId: "22222222-2222-4222-8222-222222222222",
    unsPath: "enterprise.main_site.cv_207",
  });
});

describe("creating an asset", () => {
  it("bridges it into the knowledge graph, in the create's own transaction", async () => {
    const res = await POST(req({ manufacturer: "Allen-Bradley", tag: "CV-207", name: "Discharge Conveyor" }));
    expect(res.status).toBe(201);

    expect(bridgeMock.mintAssetBridgeNode).toHaveBeenCalledTimes(1);
    const [usedClient, tenantId, input] = bridgeMock.mintAssetBridgeNode.mock.calls[0];
    expect(usedClient).toBe(client); // same transaction as the INSERT
    expect(tenantId).toBe("11111111-1111-4111-8111-111111111111");
    expect(input).toMatchObject({ assetId: ASSET_ID, tag: "CV-207", description: "Discharge Conveyor" });
  });

  it("backfills the asset row's own uns_path to match the bridge", async () => {
    await POST(req({ manufacturer: "Allen-Bradley", tag: "CV-207" }));

    expect(bridgeMock.backfillAssetUnsPath).toHaveBeenCalledWith(
      client,
      "11111111-1111-4111-8111-111111111111",
      ASSET_ID,
      "enterprise.main_site.cv_207",
    );
  });

  it("still returns the asset when no path could be resolved, and says so", async () => {
    // The asset is usable in the register either way; the notebook is what
    // will refuse it, so this must be loud rather than silent.
    bridgeMock.mintAssetBridgeNode.mockResolvedValue({ ok: false, reason: "no_uns_path" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await POST(req({ manufacturer: "Allen-Bradley", tag: "CV-207" }));

    expect(res.status).toBe(201);
    expect(bridgeMock.backfillAssetUnsPath).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no_uns_path"));
    warn.mockRestore();
  });
});
