// Vitest coverage for GET /api/namespace/node/[id].
//
// Run: cd mira-hub && npx vitest run src/app/api/namespace/node
//
// Mocks the session helper + tenant-context wrapper so each test drives a
// single response path. Asserts response status + body shape; the SQL the
// route runs is exercised inline via a fake pg client.
//
// Spec: docs/specs/maintenance-namespace-builder-spec.md §"Namespace tree"
// Issue: #1347

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));

import { GET } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

const VALID_UUID = "11111111-2222-3333-4444-555555555555";
const TENANT_ID = "tenant-aaaa-bbbb";

const goodSession = {
  userId: "u_1",
  tenantId: TENANT_ID,
  email: "x@y",
  status: "trial",
  trialExpiresAt: null,
};

const makeReq = () =>
  new Request(`https://hub.test/api/namespace/node/${VALID_UUID}`, { method: "GET" });

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
});

describe("GET /api/namespace/node/[id]", () => {
  it("returns 503 when NEON_DATABASE_URL is unset", async () => {
    delete process.env.NEON_DATABASE_URL;
    const res = await GET(makeReq(), makeParams(VALID_UUID));
    expect(res.status).toBe(503);
  });

  it("propagates a 401 from the session helper", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await GET(makeReq(), makeParams(VALID_UUID));
    expect(res.status).toBe(401);
  });

  it("returns 404 with synthetic:true marker for synthesized parent ids", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    const res = await GET(makeReq(), makeParams("synthetic:enterprise.knowledge_base"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.synthetic).toBe(true);
  });

  it("returns 400 on a malformed id", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    const res = await GET(makeReq(), makeParams("not-a-uuid"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the entity is not found in the tenant", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
      const client = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes("FROM kg_entities") && sql.includes("WHERE id")) {
            return { rows: [] };
          }
          return { rows: [] };
        }),
      };
      return await fn(client as never);
    });
    const res = await GET(makeReq(), makeParams(VALID_UUID));
    expect(res.status).toBe(404);
  });

  it("returns full node detail with verified + proposed relationships and counts", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);

    const entityRow = {
      id: VALID_UUID,
      entity_type: "asset",
      name: "Pump-01",
      uns_path: "enterprise.lake_wales.line_a.pump_01",
      properties: { make: "Grundfos" },
      created_at: "2026-05-01T00:00:00Z",
      updated_at: "2026-05-15T00:00:00Z",
    };
    const verifiedRow = {
      id: "rel-verified-1",
      relationship_type: "HAS_COMPONENT",
      target_id: "comp-uuid",
      target_name: "Motor MTR-01",
      target_uns_path: "enterprise.lake_wales.line_a.pump_01.motor",
      confidence: 1.0,
      properties: {},
    };
    const proposedRow = {
      id: "prop-1",
      relationship_type: "WIRED_TO",
      target_entity_id: "vfd-uuid",
      target_name: "PowerFlex 525",
      target_uns_path: "enterprise.lake_wales.line_a.vfd_01",
      confidence: 0.62,
      created_by: "llm",
      status: "proposed",
    };

    vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
      const client = {
        query: vi.fn(async (sql: string) => {
          // Counts CTE references relationship_proposals + kg_entities inside
          // subqueries — match it before the simpler patterns below.
          if (sql.includes("WITH parent")) {
            return {
              rows: [{ children: "3", proposals_pending: "1", proposals_verified: "2" }],
            };
          }
          if (sql.includes("FROM kg_entities") && sql.includes("WHERE id")) {
            return { rows: [entityRow] };
          }
          if (sql.includes("FROM kg_relationships r")) {
            return { rows: [verifiedRow] };
          }
          if (sql.includes("FROM relationship_proposals p")) {
            return { rows: [proposedRow] };
          }
          return { rows: [] };
        }),
      };
      return await fn(client as never);
    });

    const res = await GET(makeReq(), makeParams(VALID_UUID));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.node).toMatchObject({
      id: VALID_UUID,
      name: "Pump-01",
      kind: "asset",
      unsPath: "enterprise.lake_wales.line_a.pump_01",
    });
    expect(body.node.properties).toMatchObject({ make: "Grundfos" });

    expect(body.relationships.verified).toHaveLength(1);
    expect(body.relationships.verified[0]).toMatchObject({
      id: "rel-verified-1",
      type: "HAS_COMPONENT",
      targetId: "comp-uuid",
      targetName: "Motor MTR-01",
      confidence: 1.0,
    });

    expect(body.relationships.proposed).toHaveLength(1);
    expect(body.relationships.proposed[0]).toMatchObject({
      id: "prop-1",
      type: "WIRED_TO",
      targetId: "vfd-uuid",
      confidence: 0.62,
      status: "proposed",
    });

    expect(body.counts).toEqual({
      children: 3,
      proposalsPending: 1,
      proposalsVerified: 2,
    });
  });

  it("returns empty arrays when no relationships exist (entity present, no edges)", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
      const client = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes("WITH parent")) {
            return {
              rows: [{ children: "0", proposals_pending: "0", proposals_verified: "0" }],
            };
          }
          if (sql.includes("FROM kg_entities") && sql.includes("WHERE id")) {
            return {
              rows: [
                {
                  id: VALID_UUID,
                  entity_type: "site",
                  name: "Lake Wales",
                  uns_path: "enterprise.lake_wales",
                  properties: {},
                  created_at: "2026-05-01T00:00:00Z",
                  updated_at: "2026-05-01T00:00:00Z",
                },
              ],
            };
          }
          return { rows: [] };
        }),
      };
      return await fn(client as never);
    });

    const res = await GET(makeReq(), makeParams(VALID_UUID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.relationships.verified).toEqual([]);
    expect(body.relationships.proposed).toEqual([]);
    expect(body.counts.children).toBe(0);
  });
});
