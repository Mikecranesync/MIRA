// Vitest coverage for POST /api/proposals/[id]/decide.
//
// Run: cd mira-hub && npx vitest run src/app/api/proposals
//
// Mocks the session helper and the tenant-context wrapper so each test
// can drive a single code path through the route. Asserts observable
// state (response status, response body, SQL the route produced, args
// passed to the UPDATE) rather than implementation detail.
//
// Spec: docs/specs/maintenance-namespace-builder-spec.md §"Proposal queue"
// ADR : docs/adr/0013-uns-namespace-builder-schema-canonicalization.md

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(),
}));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(),
}));

import { POST } from "../route";
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

const baseProposal = {
  id: VALID_UUID,
  tenant_id: TENANT_ID,
  source_entity_id: "src-uuid",
  source_entity_type: "asset",
  target_entity_id: "tgt-uuid",
  target_entity_type: "component",
  relationship_type: "HAS_COMPONENT",
  confidence: 0.7,
  status: "proposed",
  created_by: "llm:groq",
  reasoning: "manual page 42",
};

const makeReq = (body: unknown) =>
  new Request(`https://hub.test/api/proposals/${VALID_UUID}/decide`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
});

describe("POST /api/proposals/[id]/decide", () => {
  it("returns 503 when NEON_DATABASE_URL is unset", async () => {
    delete process.env.NEON_DATABASE_URL;
    const res = await POST(makeReq({ decision: "verify" }), makeParams(VALID_UUID));
    expect(res.status).toBe(503);
  });

  it("propagates a 401 NextResponse from the session helper", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await POST(makeReq({ decision: "verify" }), makeParams(VALID_UUID));
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid UUID in the path", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    const res = await POST(makeReq({ decision: "verify" }), makeParams("not-a-uuid"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is missing decision", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    const res = await POST(makeReq({}), makeParams(VALID_UUID));
    expect(res.status).toBe(400);
  });

  it("returns 400 when decision is not 'verify' or 'reject'", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    const res = await POST(makeReq({ decision: "other" }), makeParams(VALID_UUID));
    expect(res.status).toBe(400);
  });

  it("returns 404 when proposal is not found (covers cross-tenant via RLS too)", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
      const client = { query: vi.fn(async () => ({ rows: [] })) };
      return await fn(client as never);
    });
    const res = await POST(makeReq({ decision: "verify" }), makeParams(VALID_UUID));
    expect(res.status).toBe(404);
  });

  it("security: NULL-tenant proposal is not decidable by an authenticated tenant (#1894)", async () => {
    // A proposal with tenant_id IS NULL must NOT be reachable by any tenant.
    // The query now uses `tenant_id = $2::uuid` (no IS NULL escape hatch).
    // Simulate DB returning 0 rows — as it will for NULL-tenant rows once the fix is live.
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    let querySql = "";
    vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
      const client = {
        query: vi.fn(async (sql: string) => {
          querySql = sql;
          return { rows: [] }; // no rows returned = NULL-tenant proposal correctly excluded
        }),
      };
      return await fn(client as never);
    });
    const res = await POST(makeReq({ decision: "verify" }), makeParams(VALID_UUID));
    expect(res.status).toBe(404);
    // Confirm the query does NOT contain the IS NULL escape hatch.
    expect(querySql).not.toContain("IS NULL");
    expect(querySql).toContain("tenant_id =");
  });

  it("returns 409 when proposal is already in a terminal state", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
      const client = {
        query: vi.fn(async () => ({ rows: [{ ...baseProposal, status: "verified" }] })),
      };
      return await fn(client as never);
    });
    const res = await POST(makeReq({ decision: "verify" }), makeParams(VALID_UUID));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("verified");
  });

  it("verify on a brand-new edge → INSERTs kg_relationships with approval_state='verified'", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    let updateProposalArgs: unknown[] = [];
    let insertSql = "";
    let insertArgs: unknown[] = [];
    let insertCalls = 0;
    let updateKgCalls = 0;

    vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
      const client = {
        query: vi.fn(async (sql: string, args: unknown[]) => {
          if (sql.includes("FROM relationship_proposals")) {
            return { rows: [baseProposal] };
          }
          if (sql.includes("UPDATE relationship_proposals")) {
            updateProposalArgs = args;
            return { rows: [] };
          }
          if (sql.includes("FROM kg_relationships")) {
            return { rows: [] }; // no existing edge
          }
          if (sql.includes("INSERT INTO kg_relationships")) {
            insertSql = sql;
            insertArgs = args;
            insertCalls++;
            return { rows: [] };
          }
          if (sql.includes("UPDATE kg_relationships")) {
            updateKgCalls++;
            return { rows: [] };
          }
          return { rows: [] };
        }),
      };
      return await fn(client as never);
    });

    const res = await POST(makeReq({ decision: "verify" }), makeParams(VALID_UUID));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      id: VALID_UUID,
      decision: "verify",
      status: "verified",
    });

    expect(updateProposalArgs[0]).toBe("verified");
    expect(String(updateProposalArgs[1])).toContain("human:u_1");

    expect(insertCalls).toBe(1);
    expect(updateKgCalls).toBe(0);
    expect(insertSql).toContain("INSERT INTO kg_relationships");
    expect(insertSql).toContain("'verified'");
    // Provenance: the verified edge records which proposal verified it (#1723).
    expect(insertSql).toContain("relationship_proposal_id");
    expect(insertArgs).toContain(VALID_UUID);
  });

  it("verify when kg_relationships row already exists → UPDATE not INSERT, confidence GREATEST", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    let insertCalls = 0;
    let updateKgCalls = 0;
    let updateKgConfidence: unknown = null;
    let updateKgSql = "";

    vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
      const client = {
        query: vi.fn(async (sql: string, args: unknown[]) => {
          if (sql.includes("FROM relationship_proposals")) {
            return { rows: [baseProposal] };
          }
          if (sql.includes("UPDATE relationship_proposals")) return { rows: [] };
          if (sql.includes("FROM kg_relationships")) {
            return { rows: [{ id: "existing-kg-id" }] };
          }
          if (sql.includes("INSERT INTO kg_relationships")) {
            insertCalls++;
            return { rows: [] };
          }
          if (sql.includes("UPDATE kg_relationships")) {
            updateKgCalls++;
            updateKgConfidence = args[0];
            updateKgSql = sql;
            return { rows: [] };
          }
          return { rows: [] };
        }),
      };
      return await fn(client as never);
    });

    const res = await POST(makeReq({ decision: "verify" }), makeParams(VALID_UUID));
    expect(res.status).toBe(200);

    expect(insertCalls).toBe(0);
    expect(updateKgCalls).toBe(1);
    expect(updateKgConfidence).toBe(baseProposal.confidence);
    expect(updateKgSql).toContain("approval_state = 'verified'");
    expect(updateKgSql).toContain("GREATEST(confidence");
    // Provenance: link the existing edge to the verifying proposal, keep first (#1723).
    expect(updateKgSql).toContain("relationship_proposal_id = COALESCE");
  });

  it("verify HAS_DOCUMENT marks the approved uploaded document chunks verified", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    const uploadId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const proposal = {
      ...baseProposal,
      relationship_type: "HAS_DOCUMENT",
      target_entity_id: uploadId,
      target_entity_type: "manual",
    };
    let verifiedUpdateSql = "";
    let verifiedUpdateArgs: unknown[] = [];

    vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
      const client = {
        query: vi.fn(async (sql: string, args: unknown[] = []) => {
          if (sql.includes("FROM relationship_proposals")) {
            return { rows: [proposal] };
          }
          if (sql.includes("UPDATE relationship_proposals")) return { rows: [] };
          if (sql.includes("FROM kg_entities")) {
            return { rows: [{ entity_id: uploadId }] };
          }
          if (sql.includes("UPDATE knowledge_entries")) {
            verifiedUpdateSql = sql;
            verifiedUpdateArgs = args;
            return { rows: [] };
          }
          if (sql.includes("FROM kg_relationships")) return { rows: [] };
          if (sql.includes("INSERT INTO kg_relationships")) return { rows: [] };
          return { rows: [] };
        }),
      };
      return await fn(client as never);
    });

    const res = await POST(makeReq({ decision: "verify" }), makeParams(VALID_UUID));
    expect(res.status).toBe(200);
    expect(verifiedUpdateSql).toContain("UPDATE knowledge_entries");
    expect(verifiedUpdateSql).toContain("verified = true");
    expect(verifiedUpdateSql).toContain("doc_id = $2::uuid");
    expect(verifiedUpdateArgs).toEqual([TENANT_ID, uploadId]);
  });

  it("reject → flips status to 'rejected' with no kg_relationships write", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    let updateProposalArgs: unknown[] = [];
    let kgWrites = 0;

    vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
      const client = {
        query: vi.fn(async (sql: string, args: unknown[]) => {
          if (sql.includes("FROM relationship_proposals")) {
            return { rows: [baseProposal] };
          }
          if (sql.includes("UPDATE relationship_proposals")) {
            updateProposalArgs = args;
            return { rows: [] };
          }
          if (sql.includes("kg_relationships")) {
            kgWrites++;
            return { rows: [] };
          }
          return { rows: [] };
        }),
      };
      return await fn(client as never);
    });

    const res = await POST(makeReq({ decision: "reject" }), makeParams(VALID_UUID));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      decision: "reject",
      status: "rejected",
    });

    expect(updateProposalArgs[0]).toBe("rejected");
    expect(String(updateProposalArgs[1])).toContain("human:u_1");
    expect(kgWrites).toBe(0);
  });
});
