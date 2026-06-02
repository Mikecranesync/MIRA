// Vitest coverage for POST /api/namespace/node.
//
// Run: cd mira-hub && npx vitest run src/app/api/namespace/node
//
// The POST route already existed (create-node); this file covers the
// previously-untested paths. Mocks follow the exact same pattern as
// [id]/__tests__/route.test.ts — mock sessionOr401 + withTenantContext,
// drive the fake pg client via SQL-substring matching.
//
// Spec: docs/specs/maintenance-namespace-builder-spec.md §"Namespace tree"
// Task: W3-B self-serve UNS-entry guided flow

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));

import { POST } from "./route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

const PARENT_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const NEW_NODE_UUID = "11111111-2222-3333-4444-555555555555";
const TENANT_ID = "tenant-0000-1111-2222-333333333333";

const goodSession = {
  userId: "u_admin",
  tenantId: TENANT_ID,
  email: "admin@factory.test",
  status: "trial",
  trialExpiresAt: null,
};

function makeReq(body: unknown): Request {
  return new Request("https://hub.test/api/namespace/node", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A pg mock that simulates: parent lookup → INSERT kg_entities → INSERT namespace_versions */
function makePgMock({
  parentUnsPath = "enterprise.lake_wales",
  insertId = NEW_NODE_UUID,
  parentMissing = false,
}: {
  parentUnsPath?: string;
  insertId?: string;
  parentMissing?: boolean;
} = {}) {
  return vi.fn(async (sql: string, _params?: unknown[]) => {
    // parent lookup
    if (sql.includes("FROM kg_entities") && sql.includes("WHERE id")) {
      return { rows: parentMissing ? [] : [{ id: PARENT_UUID, uns_path: parentUnsPath }] };
    }
    // INSERT kg_entities
    if (sql.includes("INSERT INTO kg_entities")) {
      return { rows: [{ id: insertId }] };
    }
    // INSERT namespace_versions
    if (sql.includes("INSERT INTO namespace_versions")) {
      return { rows: [] };
    }
    return { rows: [] };
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
});

describe("POST /api/namespace/node", () => {
  it("returns 503 when NEON_DATABASE_URL is unset", async () => {
    delete process.env.NEON_DATABASE_URL;
    const res = await POST(makeReq({ name: "Site A", kind: "site" }));
    expect(res.status).toBe(503);
  });

  it("propagates a 401 from the session helper", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await POST(makeReq({ name: "Site A", kind: "site" }));
    expect(res.status).toBe(401);
  });

  it("returns 422 when name is missing", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    const res = await POST(makeReq({ kind: "site" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/name/i);
  });

  it("returns 422 when name is blank", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    const res = await POST(makeReq({ name: "   ", kind: "site" }));
    expect(res.status).toBe(422);
  });

  it("returns 422 when kind is invalid", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
      return await fn({ query: vi.fn() } as never);
    });
    const res = await POST(makeReq({ name: "Pump 01", kind: "machine" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/invalid kind/i);
  });

  it("returns 422 for a reserved-label slug", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    // "enterprise" slugifies to "enterprise" which is in RESERVED_LABELS
    const res = await POST(makeReq({ name: "enterprise", kind: "site" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/reserved/i);
  });

  it("creates a root-level site node with uns_path = slug (no parent)", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);

    let capturedSql = "";
    let capturedParams: unknown[] = [];

    vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
      const client = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          if (sql.includes("INSERT INTO kg_entities")) {
            capturedSql = sql;
            capturedParams = params ?? [];
            return { rows: [{ id: NEW_NODE_UUID }] };
          }
          if (sql.includes("INSERT INTO namespace_versions")) {
            return { rows: [] };
          }
          return { rows: [] };
        }),
      };
      return await fn(client as never);
    });

    const res = await POST(makeReq({ name: "Lake Wales Plant", kind: "site" }));
    expect(res.status).toBe(201);
    const body = await res.json();

    // Returned node shape
    expect(body.ok).toBe(true);
    expect(body.node).toMatchObject({
      id: NEW_NODE_UUID,
      name: "Lake Wales Plant",
      kind: "site",
      unsPath: "lake_wales_plant",
    });

    // The SQL was called and the uns_path is the slug (no parent prefix)
    expect(capturedSql).toMatch(/INSERT INTO kg_entities/);
    // params[2] is the uns_path value
    expect(capturedParams[2]).toBe("lake_wales_plant");
  });

  it("creates a child node with uns_path = parent.uns_path + '.' + slug", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);

    let insertedUnsPath = "";

    vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
      const queryMock = makePgMock({ parentUnsPath: "enterprise.lake_wales" });
      const captureQuery = vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("INSERT INTO kg_entities")) {
          insertedUnsPath = (params ?? [])[2] as string;
        }
        return queryMock(sql);
      });
      return await fn({ query: captureQuery } as never);
    });

    const res = await POST(makeReq({ parentId: PARENT_UUID, name: "Line 1", kind: "line" }));
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.node.unsPath).toBe("enterprise.lake_wales.line_1");
    expect(insertedUnsPath).toBe("enterprise.lake_wales.line_1");
  });

  it("tenant comes from the session, not from the request body", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);

    let capturedTenantId = "";

    vi.mocked(withTenantContext).mockImplementation(async (tenantId, fn) => {
      capturedTenantId = tenantId;
      const client = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes("INSERT INTO kg_entities")) return { rows: [{ id: NEW_NODE_UUID }] };
          if (sql.includes("INSERT INTO namespace_versions")) return { rows: [] };
          return { rows: [] };
        }),
      };
      return await fn(client as never);
    });

    // Attacker supplies a different tenantId in the body — must be ignored
    const res = await POST(
      makeReq({ name: "Rogue Site", kind: "site", tenantId: "attacker-tenant-id" }),
    );
    expect(res.status).toBe(201);
    expect(capturedTenantId).toBe(TENANT_ID);
    expect(capturedTenantId).not.toBe("attacker-tenant-id");
  });

  it("returns 404 when parentId references a node not in the tenant", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
      const client = { query: makePgMock({ parentMissing: true }) };
      return await fn(client as never);
    });

    const res = await POST(makeReq({ parentId: PARENT_UUID, name: "Line 1", kind: "line" }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/parentId not found/i);
  });

  it("valid entity types are accepted (site, area, line, asset, component)", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);

    for (const kind of ["site", "area", "line", "asset", "component"]) {
      vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
        const client = {
          query: vi.fn(async (sql: string) => {
            if (sql.includes("INSERT INTO kg_entities")) return { rows: [{ id: NEW_NODE_UUID }] };
            if (sql.includes("INSERT INTO namespace_versions")) return { rows: [] };
            return { rows: [] };
          }),
        };
        return await fn(client as never);
      });

      const res = await POST(makeReq({ name: `Test ${kind}`, kind }));
      expect(res.status, `kind=${kind} should return 201`).toBe(201);
    }
  });

  it("defaults kind to 'area' when kind is not provided", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);

    let capturedKind = "";

    vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
      const client = {
        query: vi.fn(async (sql: string, params: unknown[]) => {
          if (sql.includes("INSERT INTO kg_entities")) {
            capturedKind = params[0] as string; // entity_type is $1
            return { rows: [{ id: NEW_NODE_UUID }] };
          }
          if (sql.includes("INSERT INTO namespace_versions")) return { rows: [] };
          return { rows: [] };
        }),
      };
      return await fn(client as never);
    });

    const res = await POST(makeReq({ name: "Packaging" })); // no kind
    expect(res.status).toBe(201);
    expect(capturedKind).toBe("area");
  });
});
