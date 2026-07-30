import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * P0 regression — /api/knowledge (manufacturer catalog) MUST NOT count or
 * list private (per-tenant) knowledge_entries rows for other tenants.
 *
 * Both SQL paths (manufacturer rollup + global totals) must include
 * `is_private = false` so uploaded customer manuals never appear in another
 * tenant's library catalog. This test mocks the pool and asserts the filter
 * is present in every query that reaches the DB — removing the filter fails
 * this test loudly.
 *
 * Per `.claude/rules/knowledge-entries-tenant-scoping.md`: the catalog is an
 * aggregate OEM surface; it must only see `is_private = false` rows (and must
 * NOT filter by tenant_id — #1761).
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

describe("/api/knowledge catalog — is_private = false gate", () => {
  beforeEach(() => {
    capturedQueries.length = 0;
    queryImpl = null;
    process.env.NEON_DATABASE_URL = "postgres://test";
  });

  it("manufacturer rollup query always includes is_private = false", async () => {
    const { GET } = await import("../route");
    await GET();

    const rollup = capturedQueries.find((q) => q.includes("GROUP BY"));
    expect(rollup, "no manufacturer rollup query issued").toBeTruthy();
    expect(rollup).toMatch(/is_private\s*=\s*false/);
  });

  it("global totals query always includes is_private = false", async () => {
    const { GET } = await import("../route");
    await GET();

    const totals = capturedQueries.find((q) => q.includes("total_chunks"));
    expect(totals, "no global totals query issued").toBeTruthy();
    expect(totals).toMatch(/is_private\s*=\s*false/);
  });

  it("every query reaching the pool includes is_private = false", async () => {
    const { GET } = await import("../route");
    await GET();

    expect(capturedQueries.length).toBeGreaterThan(0);
    for (const q of capturedQueries) {
      expect(q).toMatch(/is_private\s*=\s*false/);
    }
  });

  it("returns shared OEM rollups and withholds private rows at the DB boundary", async () => {
    queryImpl = async (sql: string) => {
      if (!/is_private\s*=\s*false/.test(sql)) {
        return {
          rows: [{
            manufacturer: "PRIVATE_TENANT_MFR_DO_NOT_LEAK",
            chunk_count: "9",
            doc_count: "1",
            last_indexed: "2026-01-01T00:00:00Z",
          }],
        };
      }
      if (sql.includes("GROUP BY")) {
        return {
          rows: [{
            manufacturer: "Automationdirect",
            chunk_count: "100",
            doc_count: "3",
            last_indexed: "2026-01-01T00:00:00Z",
          }],
        };
      }
      return {
        rows: [{
          total_chunks: "100",
          total_docs: "3",
          last_ingested: "2026-01-01T00:00:00Z",
        }],
      };
    };

    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();

    // normalizeManufacturer canonicalizes "Automationdirect" → "AutomationDirect".
    expect(JSON.stringify(body)).toContain("AutomationDirect");
    expect(JSON.stringify(body)).not.toContain("PRIVATE_TENANT_MFR_DO_NOT_LEAK");
  });
});
