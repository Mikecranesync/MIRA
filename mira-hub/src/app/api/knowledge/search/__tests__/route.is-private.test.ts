import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * #2044 / A10 regression — /api/knowledge/search MUST NOT return private
 * (per-tenant) knowledge_entries rows to other tenants.
 *
 * Both SQL paths (BM25 + ILIKE fallback) must include `is_private = false`
 * so uploaded customer manuals never appear in another tenant's search results.
 * This test mocks the pool and asserts the filter is present in every query
 * that reaches the DB — removing the filter fails this test loudly.
 *
 * Per `.claude/rules/knowledge-entries-tenant-scoping.md`: the search surface
 * is an aggregate OEM surface; it must only see `is_private = false` rows.
 */

const capturedQueries: string[] = [];
let queryImpl: ((sql: string) => Promise<{ rows: unknown[] }>) | null = null;

vi.mock("@/lib/db", () => ({
  default: {
    query: vi.fn(async (sql: string) => {
      capturedQueries.push(sql);
      if (queryImpl) return queryImpl(sql);
      return { rows: [] };
    }),
  },
}));

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({
    userId: "u-test",
    tenantId: "00000000-0000-0000-0000-000000000001",
    role: "member",
    exp: Date.now() / 1000 + 3600,
  })),
}));

function makeRequest(q: string): Request {
  return new Request(`http://localhost/api/knowledge/search?q=${encodeURIComponent(q)}`);
}

describe("#2044 /api/knowledge/search — is_private = false gate", () => {
  beforeEach(() => {
    capturedQueries.length = 0;
    queryImpl = null;
    process.env.NEON_DATABASE_URL = "postgres://test";
  });

  it("BM25 query always includes is_private = false", async () => {
    const { GET } = await import("../route");
    await GET(makeRequest("PowerFlex 525 fault"));

    const bm25 = capturedQueries.find((q) => q.includes("plainto_tsquery"));
    expect(bm25, "no BM25 query issued").toBeTruthy();
    expect(bm25).toMatch(/is_private\s*=\s*false/);
  });

  it("ILIKE fallback query always includes is_private = false", async () => {
    // BM25 returns no rows (mocked empty), so the ILIKE branch fires.
    const { GET } = await import("../route");
    await GET(makeRequest("GS10"));

    const ilike = capturedQueries.find((q) => q.includes("ILIKE"));
    expect(ilike, "no ILIKE query issued").toBeTruthy();
    expect(ilike).toMatch(/is_private\s*=\s*false/);
  });

  it("returns shared OEM snippets and withholds private snippets at the DB boundary", async () => {
    queryImpl = async (sql: string) => {
      if (!/is_private\s*=\s*false/.test(sql)) {
        return {
          rows: [{
            source_url: "private://tenant-a/manual.pdf",
            title: "Tenant A Secret Manual",
            manufacturer: "tenant-a",
            model_number: "SECRET",
            source_type: "upload",
            snippet: "PRIVATE_SNIPPET_DO_NOT_LEAK",
            rank: 9,
          }],
        };
      }
      if (sql.includes("plainto_tsquery")) {
        return {
          rows: [{
            source_url: "oem://shared/gs10.pdf",
            title: "Shared GS10 Manual",
            manufacturer: "automationdirect",
            model_number: "GS10",
            source_type: "oem_manual",
            snippet: "Shared OEM overcurrent guidance",
            rank: 1,
          }],
        };
      }
      return { rows: [] };
    };

    const { GET } = await import("../route");
    const res = await GET(makeRequest("overcurrent"));
    const body = await res.json();

    expect(JSON.stringify(body)).toContain("Shared OEM overcurrent guidance");
    expect(JSON.stringify(body)).not.toContain("PRIVATE_SNIPPET_DO_NOT_LEAK");
  });
});
