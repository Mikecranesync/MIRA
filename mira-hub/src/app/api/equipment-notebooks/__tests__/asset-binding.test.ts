/**
 * Notebook ↔ asset binding (migration 081, plan slice I2).
 *
 * Run: npx vitest run src/app/api/equipment-notebooks
 *
 * The rules under test are mostly refusals, because a wrong binding is silent:
 * it does not error, it just makes every later answer be about the wrong
 * machine — or, in the area-binding case, about a whole line of machines.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const sessionMock = vi.hoisted(() => ({
  sessionOr401: vi.fn(async () => ({ tenantId: "11111111-1111-4111-8111-111111111111", userId: "u1" })),
}));
vi.mock("@/lib/session", () => sessionMock);

/** One fake client whose responses are driven per-query by the test. */
const dbMock = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn(dbMock)),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn() } }));

import { PUT, DELETE } from "../[id]/asset/route";

const NB = "22222222-2222-4222-8222-222222222222";
const ASSET_UUID = "ee715d08-4ea6-4b7a-b99b-958a33c39ea8";

function putReq(body: unknown): NextRequest {
  return new NextRequest("http://test/api/equipment-notebooks/nb/asset", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const params = { params: Promise.resolve({ id: NB }) };

/** kg lookup → already-bound check → UPDATE …RETURNING */
function stubQueries(opts: {
  asset?: Record<string, unknown> | null;
  taken?: { id: string } | null;
  updated?: Record<string, unknown> | null;
}) {
  const asset = opts.asset === undefined ? { entity_id: ASSET_UUID, entity_type: "equipment", approval_state: "verified", uns_path: "enterprise.home_garage.conveyor_lab.conveyor_1" } : opts.asset;
  const updated = opts.updated === undefined
    ? {
        id: NB, display_name: "Discharge Conveyor", node_id: "33333333-3333-4333-8333-333333333333",
        created_at: "2026-08-23T00:00:00Z", identity_status: "unknown",
        equipment_entity_id: ASSET_UUID, asset_selected_via: "qr",
        asset_confirmed_by: null, asset_confirmed_at: null,
      }
    : opts.updated;

  dbMock.query
    .mockResolvedValueOnce({ rows: asset ? [asset] : [] })
    .mockResolvedValueOnce({ rows: opts.taken ? [opts.taken] : [] })
    .mockResolvedValueOnce({ rows: updated ? [updated] : [], rowCount: updated ? 1 : 0 });
}

beforeEach(() => {
  // mockReset, not clearAllMocks: clearAllMocks empties `mock.calls` but leaves
  // the mockResolvedValueOnce QUEUE intact, so unconsumed responses from one
  // test are served to the next and every failure points at the wrong cause.
  dbMock.query.mockReset();
  sessionMock.sessionOr401.mockClear();
  process.env.NEON_DATABASE_URL = "postgres://test";
});

describe("PUT /asset", () => {
  it("binds a verified equipment node and returns the notebook with its binding", async () => {
    stubQueries({});
    const res = await PUT(putReq({ assetRef: ASSET_UUID, selectedVia: "qr" }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notebook.asset).toEqual({
      entityId: ASSET_UUID,
      selectedVia: "qr",
      confirmedBy: null,
      confirmedAt: null,
    });
  });

  it("refuses a non-equipment node — binding an area would scope answers to a whole line", async () => {
    stubQueries({ asset: { entity_id: "area-1", entity_type: "area", approval_state: "verified", uns_path: "enterprise.home_garage.conveyor_lab" } });
    const res = await PUT(putReq({ assetRef: "area-1", selectedVia: "asset_picker" }), params);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("asset_not_equipment");
    // Distinct from not-found on purpose: "you picked a location" is actionable,
    // "not found" sends the technician hunting for a permissions problem.
    expect(body.code).not.toBe("asset_not_found");
  });

  it("refuses an unapproved asset — a proposal must not become an identity", async () => {
    stubQueries({ asset: { entity_id: ASSET_UUID, entity_type: "equipment", approval_state: "proposed", uns_path: "enterprise.x" } });
    const res = await PUT(putReq({ assetRef: ASSET_UUID, selectedVia: "asset_picker" }), params);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("asset_not_verified");
  });

  it("refuses a verified asset with no uns_path — this is the notebook's own node", async () => {
    stubQueries({ asset: { entity_id: "node-self", entity_type: "equipment", approval_state: "verified", uns_path: null } });
    const res = await PUT(putReq({ assetRef: "node-self", selectedVia: "asset_picker" }), params);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("asset_not_verified");
  });

  it("404s an asset from another tenant without leaking that it exists", async () => {
    stubQueries({ asset: null });
    const res = await PUT(putReq({ assetRef: ASSET_UUID, selectedVia: "asset_picker" }), params);
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("asset_not_found");
    // The tenant is in the predicate, not applied after the fact.
    expect(dbMock.query.mock.calls[0][1]).toContain("11111111-1111-4111-8111-111111111111");
  });

  it("409s a second notebook on the same asset, and says which one has it", async () => {
    stubQueries({ taken: { id: "99999999-9999-4999-8999-999999999999" } });
    const res = await PUT(putReq({ assetRef: ASSET_UUID, selectedVia: "asset_picker" }), params);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("asset_already_bound");
    expect(body.boundNotebookId).toBe("99999999-9999-4999-8999-999999999999");
  });

  it("a QR scan never sets a confirmation — a sticker is a selection", async () => {
    stubQueries({});
    await PUT(putReq({ assetRef: ASSET_UUID, selectedVia: "qr" }), params);
    const updateArgs = dbMock.query.mock.calls[2][1];
    expect(updateArgs[3]).toBe("qr");
    expect(updateArgs[4]).toBeNull(); // confirmed_by
  });

  it("ignores a body-supplied confirmedBy — confirmation is server-derived", async () => {
    stubQueries({});
    await PUT(
      putReq({ assetRef: ASSET_UUID, selectedVia: "asset_picker", confirmedBy: "someone-else" }),
      params,
    );
    const updateArgs = dbMock.query.mock.calls[2][1];
    expect(updateArgs[4]).toBe("u1"); // the session user, not the body
  });

  it("accepts nfc and rejects an unlisted method", async () => {
    stubQueries({});
    expect((await PUT(putReq({ assetRef: ASSET_UUID, selectedVia: "nfc" }), params)).status).toBe(200);

    dbMock.query.mockReset();
    const bad = await PUT(putReq({ assetRef: ASSET_UUID, selectedVia: "gps" }), params);
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe("invalid_selected_via");
    expect(dbMock.query).not.toHaveBeenCalled();
  });

  it("returns a readable sentence, not a bare token, for the phone to render", async () => {
    stubQueries({ asset: null });
    const body = await (await PUT(putReq({ assetRef: ASSET_UUID, selectedVia: "qr" }), params)).json();
    // mira-mobile surfaces `data.error` verbatim, so an identifier here reaches
    // the technician as the literal string `asset_not_found`.
    expect(body.error).not.toMatch(/_/);
    expect(body.error.length).toBeGreaterThan(10);
  });

  it("rejects a malformed notebook id before touching the database", async () => {
    const res = await PUT(putReq({ assetRef: ASSET_UUID, selectedVia: "qr" }), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
    expect(dbMock.query).not.toHaveBeenCalled();
  });
});

describe("DELETE /asset", () => {
  it("clears the binding", async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await DELETE(new NextRequest("http://test/x", { method: "DELETE" }), params);
    expect(res.status).toBe(200);
    // All four columns move together — a stray confirmation timestamp attached
    // to no asset would read as a confirmed binding.
    const sql = String(dbMock.query.mock.calls[0][0]);
    for (const col of ["equipment_entity_id", "asset_selected_via", "asset_confirmed_by", "asset_confirmed_at"]) {
      expect(sql).toMatch(new RegExp(`${col}\\s*=\\s*NULL`));
    }
  });

  it("404s a notebook that is not this tenant's", async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await DELETE(new NextRequest("http://test/x", { method: "DELETE" }), params);
    expect(res.status).toBe(404);
  });
});
