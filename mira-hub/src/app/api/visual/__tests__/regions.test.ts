// Run: npx vitest run src/app/api/visual/__tests__/regions.test.ts
//
// Region create/update — the contract-critical routes: frozen-schema
// validation, the bbox storage mapping (the ONLY rename), origin='user',
// 404-not-403 cross-tenant semantics, and the PATCH column whitelist.

import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: (_tenantId: string, fn: (c: unknown) => unknown) =>
    fn({ query: queryMock }),
}));
vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));

process.env.NEON_DATABASE_URL ||= "postgres://unit-test/none";

import { GET as listRegions, POST as createRegion } from "@/app/api/visual/evidence/[id]/regions/route";
import { PATCH as patchRegion } from "@/app/api/visual/regions/[id]/route";
import { sessionOr401 } from "@/lib/session";

const TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const EVIDENCE = "11111111-2222-3333-4444-555555555555";
const REGION = "99999999-8888-7777-6666-555555555555";
const CTX = {
  userId: "u-1",
  tenantId: TENANT,
  email: "tech@example.com",
  status: "active",
  trialExpiresAt: null,
};

const RECT = {
  type: "rect",
  coordinate_space: "normalized_original",
  x: 0.25,
  y: 0.25,
  width: 0.5,
  height: 0.25,
};

function evidenceParams() {
  return { params: Promise.resolve({ id: EVIDENCE }) };
}

beforeEach(() => {
  queryMock.mockReset();
  vi.mocked(sessionOr401).mockResolvedValue(CTX as never);
});

describe("POST /api/visual/evidence/[id]/regions", () => {
  it("stores the bbox storage shape with origin='user'", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ session_id: "s-1" }] }) // ownership
      .mockResolvedValueOnce({
        rows: [
          {
            region_id: REGION,
            evidence_id: EVIDENCE,
            geometry: { type: "bbox", x: 0.25, y: 0.25, w: 0.5, h: 0.25 },
            label: null,
            origin: "user",
            created_at: "2026-07-21T00:00:00Z",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }); // session updated_at bump
    const res = await createRegion(
      new Request("http://x", { method: "POST", body: JSON.stringify({ geometry: RECT }) }),
      evidenceParams(),
    );
    expect(res.status).toBe(201);

    // Ownership check is tenant-scoped.
    const [ownSql, ownParams] = queryMock.mock.calls[0];
    expect(ownSql).toMatch(/FROM evidence_item/);
    expect(ownSql).toMatch(/tenant_id = \$2/);
    expect(ownParams).toEqual([EVIDENCE, TENANT]);

    // Insert carries the STORAGE shape ({type:'bbox',x,y,w,h} — w/h renamed)
    // and the explicit 'user' origin (column default is 'system').
    const [insSql, insParams] = queryMock.mock.calls[1];
    expect(insSql).toMatch(/INSERT INTO region_of_interest/);
    expect(insSql).toMatch(/'user'/);
    expect(JSON.parse(insParams[2] as string)).toEqual({
      type: "bbox",
      x: 0.25,
      y: 0.25,
      w: 0.5,
      h: 0.25,
    });

    // Response geometry is the CANONICAL v1 shape (rect, width/height).
    const body = await res.json();
    expect(body.region.geometry.type).toBe("rect");
    expect(body.region.geometry.width).toBe(0.5);
    expect(body.region.origin).toBe("user");
  });

  it("rejects out-of-contract geometry with 400", async () => {
    const res = await createRegion(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({
          geometry: { ...RECT, x: 0.9, width: 0.5 }, // overflows x+w > 1
        }),
      }),
      evidenceParams(),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_geometry");
    expect(queryMock).not.toHaveBeenCalled(); // rejected before any DB touch
  });

  it("returns 404 (not 403) for evidence the tenant does not own", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }); // ownership miss
    const res = await createRegion(
      new Request("http://x", { method: "POST", body: JSON.stringify({ geometry: RECT }) }),
      evidenceParams(),
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/visual/evidence/[id]/regions", () => {
  it("returns canonical geometry and isolates malformed stored rows", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ session_id: "s-1" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            region_id: REGION,
            evidence_id: EVIDENCE,
            geometry: { type: "bbox", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
            label: "K17",
            origin: "user",
            created_at: "t",
          },
          {
            region_id: "22222222-3333-4444-5555-666666666666",
            evidence_id: EVIDENCE,
            geometry: { type: "bbox", x: 2.5 }, // malformed — out of range
            label: null,
            origin: "system",
            created_at: "t",
          },
        ],
      });
    const res = await listRegions(new Request("http://x"), evidenceParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.regions).toHaveLength(2);
    expect(body.regions[0].geometry.type).toBe("rect");
    expect(body.regions[0].geometry_error).toBeNull();
    expect(body.regions[1].geometry).toBeNull();
    expect(body.regions[1].geometry_error).toBeTruthy(); // one bad row never poisons the list
  });
});

describe("PATCH /api/visual/regions/[id]", () => {
  function regionParams() {
    return { params: Promise.resolve({ id: REGION }) };
  }

  it("updates only the whitelisted columns (geometry, label)", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ region_id: REGION, evidence_id: EVIDENCE, geometry: {}, label: null, origin: "user", created_at: "t" }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            region_id: REGION,
            evidence_id: EVIDENCE,
            geometry: { type: "bbox", x: 0.25, y: 0.25, w: 0.5, h: 0.25 },
            label: "K17 seal-in",
            origin: "user",
            created_at: "t",
          },
        ],
      });
    const res = await patchRegion(
      new Request("http://x", {
        method: "PATCH",
        body: JSON.stringify({ geometry: RECT, label: "K17 seal-in" }),
      }),
      regionParams(),
    );
    expect(res.status).toBe(200);
    const [updSql, updParams] = queryMock.mock.calls[1];
    expect(updSql).toMatch(/UPDATE region_of_interest SET geometry = \$1, label = \$2/);
    expect(updSql).toMatch(/tenant_id = \$4/);
    // Column whitelist: nothing beyond geometry/label in the SET clause
    // (RETURNING legitimately lists other columns).
    const setClause = (updSql as string).split("WHERE")[0];
    expect(setClause).not.toMatch(/origin|evidence_id|created_at/);
    expect(updParams[3]).toBe(TENANT);
  });

  it("404s cross-tenant region ids", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const res = await patchRegion(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ label: "x" }) }),
      regionParams(),
    );
    expect(res.status).toBe(404);
  });

  it("400s an empty patch", async () => {
    const res = await patchRegion(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({}) }),
      regionParams(),
    );
    expect(res.status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
