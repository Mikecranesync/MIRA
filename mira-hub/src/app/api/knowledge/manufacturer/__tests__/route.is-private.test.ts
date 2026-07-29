import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * P0 regression — /api/knowledge/manufacturer MUST NOT surface private
 * (per-tenant) knowledge_entries metadata (source_url, title, model_number)
 * to other tenants browsing the library.
 *
 * The per-manufacturer rollup GROUPs knowledge_entries BY source_url; without
 * an `is_private = false` predicate, every authed tenant could enumerate other
 * tenants' uploaded manuals. Both branches of the manufacturer filter (a named
 * manufacturer and the "Uncategorized" NULL/empty branch) must include the
 * predicate — removing it fails this test loudly.
 *
 * Per `.claude/rules/knowledge-entries-tenant-scoping.md`: this is an
 * aggregate OEM surface; it must only see `is_private = false` rows and must
 * NOT filter by tenant_id (that would hide the shared OEM corpus — #1761).
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

function makeRequest(name: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/knowledge/manufacturer?name=${encodeURIComponent(name)}`,
  );
}

describe("/api/knowledge/manufacturer — is_private = false gate", () => {
  beforeEach(() => {
    capturedQueries.length = 0;
    queryImpl = null;
    process.env.NEON_DATABASE_URL = "postgres://test";
  });

  it("named-manufacturer branch always includes is_private = false", async () => {
    const { GET } = await import("../route");
    await GET(makeRequest("Siemens"));

    const rollup = capturedQueries.find((q) => q.includes("knowledge_entries"));
    expect(rollup, "no rollup query issued").toBeTruthy();
    expect(rollup).toMatch(/is_private\s*=\s*false/);
  });

  it("Uncategorized branch always includes is_private = false", async () => {
    const { GET } = await import("../route");
    await GET(makeRequest("Uncategorized"));

    const rollup = capturedQueries.find((q) => q.includes("knowledge_entries"));
    expect(rollup, "no rollup query issued").toBeTruthy();
    expect(rollup).toMatch(/manufacturer IS NULL/);
    expect(rollup).toMatch(/is_private\s*=\s*false/);
  });

  it("returns shared OEM docs and withholds private upload metadata at the DB boundary", async () => {
    queryImpl = async (sql: string) => {
      if (!/is_private\s*=\s*false/.test(sql)) {
        return {
          rows: [{
            source_url: "private://tenant-a/secret-manual.pdf",
            model_number: "SECRET-MODEL",
            source_type: "upload",
            equipment_type: null,
            chunk_count: "9",
            last_indexed: "2026-01-01T00:00:00Z",
            title: "Tenant A Secret Manual",
          }],
        };
      }
      return {
        rows: [{
          source_url: "oem://shared/gs10.pdf",
          model_number: "GS10",
          source_type: "oem_manual",
          equipment_type: "VFD",
          chunk_count: "42",
          last_indexed: "2026-01-01T00:00:00Z",
          title: "Shared GS10 Manual",
        }],
      };
    };

    const { GET } = await import("../route");
    const res = await GET(makeRequest("AutomationDirect"));
    const body = await res.json();

    expect(JSON.stringify(body)).toContain("Shared GS10 Manual");
    expect(JSON.stringify(body)).not.toContain("Tenant A Secret Manual");
    expect(JSON.stringify(body)).not.toContain("SECRET-MODEL");
  });
});
