// The hybrid-corpus law on the Library routes (#1761 class).
//
// Run: cd mira-hub && npx vitest run src/app/api/library
//
// Before this test the three routes filtered `tenant_id = $1` under
// `withTenantContext`, so a customer's Library showed only their own uploads —
// never the 83K-row shared OEM corpus. The fix is NOT "drop the tenant filter":
// the corpus is hybrid, so the only correct predicate is
// `(is_private = false OR tenant_id = $caller)` on the raw owner pool.
//
// Two sides are asserted on every knowledge_entries query each route emits:
//   1. OEM stays visible   — the predicate contains `is_private = false`
//   2. no cross-tenant read — the predicate ORs it with `tenant_id = $1`, the
//      caller's tenant is the bound parameter, and there is NO broadened form
//      (a bare `is_private = false`, or no tenant term at all).
// Plus: the raw pool is used (RLS under withTenantContext would hide OEM rows),
// and the pure-tenant KG join keeps explicit tenant predicates.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn() } }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(() => {
    throw new Error("withTenantContext must not be used for hybrid knowledge_entries reads");
  }),
}));

import { GET as treeGET } from "../tree/route";
import { GET as chunksGET } from "../chunks/route";
import { GET as documentsGET } from "../documents/route";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";

const TENANT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const session = { userId: "u1", tenantId: TENANT, email: "t@x", status: "active", trialExpiresAt: null, role: "owner" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const queryMock = (pool as any).query as ReturnType<typeof vi.fn>;

const HYBRID = /\(\s*(?:ke\.)?is_private\s*=\s*false\s+OR\s+(?:ke\.)?tenant_id\s*=\s*\$1\s*\)/;

function knowledgeEntriesCalls(): Array<{ sql: string; params: unknown[] }> {
  return queryMock.mock.calls
    .filter((c) => /knowledge_entries/.test(c[0] as string))
    .map((c) => ({ sql: c[0] as string, params: (c[1] as unknown[]) ?? [] }));
}

function assertHybrid({ sql, params }: { sql: string; params: unknown[] }) {
  expect(sql, sql).toMatch(HYBRID); // side 1: OEM visible, side 2: OR'd with caller tenant
  expect(params[0]).toBe(TENANT); // the tenant term is bound to the CALLER
  // No broadened / bare forms — the #1761 fix must not become an #1833 leak.
  const where = sql.slice(sql.search(/WHERE/i));
  expect(where.replace(HYBRID, "")).not.toMatch(/\bis_private\s*=\s*false/);
  expect(where).not.toMatch(/(?<![\w.])tenant_id\s*=\s*\$1(?!\s*\))/); // no standalone tenant-only term
}

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [] });
  vi.mocked(sessionOr401).mockResolvedValue(session as never);
  process.env.NEON_DATABASE_URL = "postgres://test";
});

describe("GET /api/library/tree", () => {
  it("both knowledge_entries reads are hybrid on the raw pool", async () => {
    const res = await treeGET();
    expect(res.status).toBe(200);
    const calls = knowledgeEntriesCalls();
    expect(calls).toHaveLength(2);
    calls.forEach(assertHybrid);
  });

  it("401 passes through untouched", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(NextResponse.json({}, { status: 401 }) as never);
    expect((await treeGET()).status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/library/documents", () => {
  it.each([
    ["named manufacturer + model", "?manufacturer=Allen-Bradley&model=PowerFlex%20525"],
    ["sentinel manufacturer", "?manufacturer=Unknown%20manufacturer"],
    ["sentinel model", "?manufacturer=Delta&model=Unspecified%20model"],
  ])("%s → hybrid read", async (_label, qs) => {
    const res = await documentsGET(new Request(`https://hub.test/api/library/documents${qs}`));
    expect(res.status).toBe(200);
    const calls = knowledgeEntriesCalls();
    expect(calls).toHaveLength(1);
    assertHybrid(calls[0]);
  });
});

describe("GET /api/library/chunks", () => {
  const docId = Buffer.from("https://oem.example/manual.pdf").toString("base64url");

  it("meta + chunks reads are hybrid; the KG fault join keeps explicit tenant predicates", async () => {
    const res = await chunksGET(new Request(`https://hub.test/api/library/chunks?document_id=${docId}`));
    expect(res.status).toBe(200);
    const calls = knowledgeEntriesCalls();
    expect(calls).toHaveLength(3);
    calls.forEach(assertHybrid);
    const faultJoin = calls.find((c) => /kg_relationships/.test(c.sql))!;
    expect(faultJoin.sql).toMatch(/r\.tenant_id\s*=\s*\$1/);
    expect(faultJoin.sql).toMatch(/fc\.tenant_id\s*=\s*\$1/);
    // and the document itself is pinned to the decoded source_url
    calls.forEach((c) => expect(c.params[1]).toBe("https://oem.example/manual.pdf"));
  });

  it("another tenant's private upload is not readable: the caller's tenant is the only tenant bound", async () => {
    await chunksGET(new Request(`https://hub.test/api/library/chunks?document_id=${docId}`));
    for (const { params } of knowledgeEntriesCalls()) {
      const uuids = params.filter((p) => typeof p === "string" && /^[0-9a-f-]{36}$/.test(p));
      expect(uuids).toEqual([TENANT]);
    }
  });
});
