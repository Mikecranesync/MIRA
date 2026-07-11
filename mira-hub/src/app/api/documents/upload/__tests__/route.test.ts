// Vitest coverage for POST /api/documents/upload — the per-tenant customer
// document door that registers an upload in knowledge_entries (is_private=true).
//
// Run: cd mira-hub && npx vitest run src/app/api/documents/upload
//
// The regression this guards: knowledge_entries.id is a UUID PRIMARY KEY with NO
// server default. Every other writer (node-knowledge-ingest.ts, the seeder)
// supplies id explicitly; this route used to omit it, so every upload 500'd with
// a NOT NULL violation on id ("Insert failed"). Found live on staging by the
// document-upload-retrieval dogfood check. The core assertion below is that the
// INSERT supplies id — without it the door is dead for every tenant.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/demo-auth", () => ({
  sessionOrDemo: vi.fn(),
}));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(),
}));
vi.mock("@/lib/manufacturerNormalize", () => ({
  normalizeManufacturer: vi.fn((m: string) => ({ canonical: m || "" })),
}));

import { POST } from "../route";
import { sessionOrDemo } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";

const TENANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const goodSession = {
  userId: "u_1",
  tenantId: TENANT_ID,
  email: "x@y",
  status: "trial",
  trialExpiresAt: null,
  isDemo: false,
};

const mockSession = vi.mocked(sessionOrDemo);
const mockWithTenant = vi.mocked(withTenantContext);

// Captures the SQL + params the route runs inside withTenantContext, and returns
// a synthetic inserted id — so we can assert the INSERT column list.
let capturedSql = "";
let capturedParams: unknown[] = [];

function req(body: unknown): Request {
  return new Request("http://t/api/documents/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgresql://test";
  capturedSql = "";
  capturedParams = [];
  mockSession.mockResolvedValue(goodSession as never);
  // withTenantContext(tenantId, fn) → fn(client); client.query captures + returns an id.
  mockWithTenant.mockImplementation((async (_tid: string, fn: (c: unknown) => unknown) => {
    const client = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        capturedSql = sql;
        capturedParams = params;
        return { rows: [{ id: "11111111-2222-3333-4444-555555555555" }] };
      }),
    };
    return fn(client);
  }) as never);
});

describe("POST /api/documents/upload", () => {
  it("registers a valid upload (201) and the INSERT supplies id (regression: knowledge_entries.id has no default)", async () => {
    const res = await POST(req({ filename: "manual.pdf", excerpt: "belt tension spec" }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.document_id).toBe("11111111-2222-3333-4444-555555555555");
    expect(json.status).toBe("registered");

    // The core guard: the INSERT must include the id column and generate one.
    // Without this the route 500s ("Insert failed") for every tenant.
    expect(capturedSql).toMatch(/INSERT INTO knowledge_entries/i);
    expect(capturedSql).toMatch(/\(\s*id\s*,/i); // id is the first inserted column
    expect(capturedSql.toLowerCase()).toContain("gen_random_uuid()");
    // source_type is ALSO NOT NULL with no default on the live schema — omitting it
    // 500'd every upload after the id fix landed (the second cause). Guard its
    // presence + the per-tenant-upload value. (query() is mocked, so this asserts
    // the column list, not the DB constraint; the live guard is the dogfood check.)
    expect(capturedSql.toLowerCase()).toContain("source_type");
    expect(capturedSql.toLowerCase()).toContain("'customer_upload'");
    // And it stays a private per-tenant upload (the #1833 hybrid-corpus law).
    expect(capturedSql.toLowerCase()).toContain("is_private");
    expect(capturedSql).toMatch(/true/);
    // Tenant scoping: tenant_id is the caller's, passed as the first bound param.
    expect(capturedParams[0]).toBe(TENANT_ID);
  });

  it("rejects a payload with no filename (400)", async () => {
    const res = await POST(req({ excerpt: "x" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("filename_required");
  });

  it("rejects a payload with neither source_url nor excerpt (400)", async () => {
    const res = await POST(req({ filename: "manual.pdf" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("source_url_or_excerpt_required");
  });

  it("propagates an auth failure from sessionOrDemo", async () => {
    mockSession.mockResolvedValue(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }) as never,
    );
    const res = await POST(req({ filename: "manual.pdf", excerpt: "x" }));
    expect(res.status).toBe(401);
  });
});
