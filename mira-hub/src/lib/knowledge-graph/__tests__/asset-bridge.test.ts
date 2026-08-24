/**
 * Asset → KG bridge (scan→notebook generalization).
 *
 * Run: npx vitest run src/lib/knowledge-graph/__tests__/asset-bridge.test.ts
 *
 * The behaviour that matters is that a machine created through the ordinary
 * asset door comes out WHOLE — a cmms_equipment row AND a kg_entities node the
 * notebook route will accept. That route accepts a node only when it is
 * entity_type='equipment', approval_state='verified', carries a non-null
 * uns_path, and matches on `id` or `entity_id`. All four are asserted here,
 * because dropping any one of them reproduces the original bug in a way that
 * stays invisible until someone scans a sticker on a machine that isn't
 * CV-101.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";

import { DEFAULT_SITE_NAME, backfillAssetUnsPath, mintAssetBridgeNode } from "../asset-bridge";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ASSET = "ee715d08-4ea6-4b7a-b99b-958a33c39ea8";
const NODE = "22222222-2222-4222-8222-222222222222";

// SQL discriminators. Handlers match in declaration order, so the
// parent-path SELECT (which also mentions 'site') is always listed before the
// site INSERT.
const PARENT_PATH = "entity_type IN ('site'";
const SITE_INSERT = "VALUES ($1::uuid, 'site'";
const EQ_INSERT = "VALUES ($1::uuid, 'equipment'";
const EXISTING = "SELECT id::text AS id FROM kg_entities";

type Call = { sql: string; params: unknown[] };
type Handler = [string, (params: unknown[]) => { rows: unknown[] }];

/**
 * A PoolClient stand-in that dispatches on the SQL it is handed. Anything not
 * matched returns no rows — the "tenant has nothing yet" shape.
 */
function fakeClient(handlers: Handler[] = []) {
  const calls: Call[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      for (const [needle, fn] of handlers) {
        if (sql.includes(needle)) return fn(params);
      }
      return { rows: [] };
    }),
  };
  return { client: client as unknown as PoolClient, calls };
}

const findCall = (calls: Call[], needle: string) => calls.find((c) => c.sql.includes(needle));
const okNode: Handler = [EQ_INSERT, () => ({ rows: [{ id: NODE }] })];

beforeEach(() => vi.clearAllMocks());

describe("mintAssetBridgeNode", () => {
  it("mints a verified equipment node keyed to the cmms asset id", async () => {
    const { client, calls } = fakeClient([okNode]);

    const res = await mintAssetBridgeNode(client, TENANT, {
      assetId: ASSET,
      tag: "CV-207",
      description: "Discharge Conveyor",
      manufacturer: "Allen-Bradley",
      model: "2080-LC20-20QBB",
    });

    expect(res).toEqual({
      ok: true,
      created: true,
      nodeId: NODE,
      unsPath: "enterprise.main_site.cv_207",
    });

    const insert = findCall(calls, EQ_INSERT);
    expect(insert).toBeDefined();
    // The four things the notebook route checks.
    expect(insert!.sql).toContain("'equipment'");
    expect(insert!.sql).toContain("'verified'");
    expect(insert!.params[1]).toBe(ASSET); // entity_id — the match key
    expect(insert!.params[4]).toBe("enterprise.main_site.cv_207"); // non-null uns_path

    // properties.asset_tag is the alias key readers actually use.
    expect(JSON.parse(String(insert!.params[3]))).toMatchObject({
      asset_tag: "CV-207",
      manufacturer: "Allen-Bradley",
      model_number: "2080-LC20-20QBB",
    });
  });

  it("nests under the tenant's existing hierarchy instead of minting a site", async () => {
    const { client, calls } = fakeClient([
      [PARENT_PATH, () => ({ rows: [{ uns_path: "enterprise.acme.bottling_1" }] })],
      okNode,
    ]);

    const res = await mintAssetBridgeNode(client, TENANT, { assetId: ASSET, tag: "CV-207" });

    expect(res).toMatchObject({ ok: true, unsPath: "enterprise.acme.bottling_1.cv_207" });
    expect(findCall(calls, SITE_INSERT)).toBeUndefined();
  });

  it("mints a renameable root site for a tenant that never ran the wizard", async () => {
    const { client, calls } = fakeClient([okNode]);

    await mintAssetBridgeNode(client, TENANT, { assetId: ASSET, tag: "CV-207" });

    const site = findCall(calls, SITE_INSERT);
    expect(site).toBeDefined();
    expect(site!.params).toContain(DEFAULT_SITE_NAME);
    expect(site!.params).toContain("enterprise.main_site");
    // Reconciles rather than duplicating if the wizard runs later.
    expect(site!.sql).toContain("ON CONFLICT (tenant_id, entity_type, name)");
  });

  it("is idempotent — an already-bridged asset is not minted twice", async () => {
    const { client, calls } = fakeClient([[EXISTING, () => ({ rows: [{ id: NODE }] })]]);

    const res = await mintAssetBridgeNode(client, TENANT, { assetId: ASSET, tag: "CV-207" });

    expect(res).toMatchObject({ ok: true, created: false, nodeId: NODE });
    expect(findCall(calls, EQ_INSERT)).toBeUndefined();
  });

  it("disambiguates with the tag when the natural key is already taken", async () => {
    // (tenant_id, entity_type, name) is UNIQUE, and notebooks' own backing
    // nodes are entity_type='equipment' too — so a second "Discharge Conveyor"
    // is an ordinary event that must not fail the asset create.
    let attempt = 0;
    const { client, calls } = fakeClient([
      [
        EQ_INSERT,
        () => {
          attempt += 1;
          if (attempt === 1) throw Object.assign(new Error("duplicate key"), { code: "23505" });
          return { rows: [{ id: NODE }] };
        },
      ],
    ]);

    const res = await mintAssetBridgeNode(client, TENANT, {
      assetId: ASSET,
      tag: "CV-207",
      description: "Discharge Conveyor",
    });

    expect(res).toMatchObject({ ok: true, created: true, nodeId: NODE });
    const inserts = calls.filter((c) => c.sql.includes(EQ_INSERT));
    expect(inserts).toHaveLength(2);
    expect(inserts[0].params[2]).toBe("Discharge Conveyor");
    expect(inserts[1].params[2]).toBe("Discharge Conveyor (CV-207)");
  });

  it("rethrows a non-collision insert failure rather than swallowing it", async () => {
    const { client } = fakeClient([
      [
        EQ_INSERT,
        () => {
          throw Object.assign(new Error("permission denied for table kg_entities"), {
            code: "42501",
          });
        },
      ],
    ]);

    await expect(
      mintAssetBridgeNode(client, TENANT, { assetId: ASSET, tag: "CV-207" }),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("backfillAssetUnsPath", () => {
  it("fills only a NULL path, never overwriting one already chosen", async () => {
    const { client, calls } = fakeClient();
    await backfillAssetUnsPath(client, TENANT, ASSET, "enterprise.main_site.cv_207");

    const update = findCall(calls, "UPDATE cmms_equipment");
    expect(update).toBeDefined();
    expect(update!.sql).toContain("uns_path IS NULL");
    expect(update!.params).toEqual([TENANT, ASSET, "enterprise.main_site.cv_207"]);
  });
});
