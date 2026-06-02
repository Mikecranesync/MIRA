/**
 * Route-level tests for POST /api/tags/import.
 *
 * Mocks @/lib/session (session cookie decode) and @/lib/tenant-context
 * (DB transaction + RLS setup) so the test runs without a live NeonDB.
 *
 * Run: cd mira-hub && npx vitest run src/app/api/tags/import/__tests__/route.test.ts
 *
 * Coverage targets per task spec:
 *   1. A 3-row CSV produces 3 tag_mapping ai_suggestions rows.
 *   2. A row with explicit suggested_uns is honoured (explicit, confidence 0.8).
 *   3. A malformed row (missing tag_path) is skipped, not a crash.
 *   4. tenant_id comes from session, NOT from request body.
 *   5. Returns 401 when session is missing.
 *   6. Returns 422 when CSV has no valid rows.
 *   7. Returns 503 when NEON_DATABASE_URL is absent.
 *   8. Returns 400 for invalid site_path query param.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// ── mocks must be declared BEFORE importing the module under test ──────────

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(),
}));

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(),
}));

// mock db at module level so `new Pool()` never runs
vi.mock("@/lib/db", () => ({
  default: {},
}));

import { POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const USER_ID   = "11111111-2222-3333-4444-555555555555";

const goodSession = {
  userId: USER_ID,
  tenantId: TENANT_ID,
  email: "tech@acme.com",
  status: "active",
  trialExpiresAt: null,
};

const THREE_ROW_CSV = [
  "tag_path,description,data_type,units,suggested_uns",
  "Line5/B16/PE2,Photo eye 2,BOOL,,enterprise.plant.line5.b16.pe2",
  "Line5/B16/Speed,Motor speed,REAL,rpm,",
  "Line5/B16/Fault,Fault code,INT,,",
].join("\n");

const MALFORMED_ROW_CSV = [
  "tag_path,description",
  ",Missing tag path - should be skipped",
  "Line5/Good,Valid row",
].join("\n");

// Fake UUIDs returned by the mock DB
function makeUuid(n: number): string {
  return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
}

/** Build a NextRequest with a text/csv body. */
function makeCsvRequest(
  csv: string,
  queryParams: Record<string, string> = {},
): NextRequest {
  const url = new URL("http://localhost/api/tags/import");
  for (const [k, v] of Object.entries(queryParams)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "text/csv" },
    body: csv,
  });
}

// ---------------------------------------------------------------------------
// Shared setup / teardown
// ---------------------------------------------------------------------------

const originalNeonUrl = process.env.NEON_DATABASE_URL;

beforeEach(() => {
  process.env.NEON_DATABASE_URL = "postgres://fake/testdb";
  vi.resetAllMocks();
});

afterEach(() => {
  if (originalNeonUrl !== undefined) {
    process.env.NEON_DATABASE_URL = originalNeonUrl;
  } else {
    delete process.env.NEON_DATABASE_URL;
  }
});

/** Set up mocks for a successful happy-path run returning `count` suggestion IDs. */
function setupHappyPath(rowCount: number) {
  vi.mocked(sessionOr401).mockResolvedValue(goodSession);
  vi.mocked(withTenantContext).mockImplementation(async (_tenantId, fn) => {
    // Simulate the DB client with a fake query returning UUIDs
    const fakeClient = {
      query: vi.fn().mockResolvedValue({
        rows: Array.from({ length: rowCount }, (_, i) => ({ id: makeUuid(i + 1) })),
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return fn(fakeClient as any);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/tags/import", () => {
  // ── 1: happy path — 3 rows → 3 suggestion ids ───────────────────────────
  it("returns 201 with 3 suggestion_ids for a 3-row CSV", async () => {
    setupHappyPath(3);
    const req = makeCsvRequest(THREE_ROW_CSV);
    const res = await POST(req);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.imported).toBe(3);
    expect(body.suggestion_ids).toHaveLength(3);
    expect(body.skipped).toHaveLength(0);
  });

  // ── 2: explicit suggested_uns is honoured ────────────────────────────────
  it("passes explicit suggested_uns through to DB insert (confidence 0.8)", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);

    let capturedParams: unknown[] = [];
    vi.mocked(withTenantContext).mockImplementation(async (_tenantId, fn) => {
      const fakeClient = {
        query: vi.fn().mockImplementation((_sql: string, params: unknown[]) => {
          capturedParams = params;
          return Promise.resolve({ rows: [{ id: makeUuid(1) }] });
        }),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return fn(fakeClient as any);
    });

    const singleRowCsv = [
      "tag_path,suggested_uns",
      "Line5/PE2,enterprise.plant.line5.pe2",
    ].join("\n");

    await POST(makeCsvRequest(singleRowCsv));

    // The params array for the INSERT: find the extracted_data JSON param
    const extractedDataParam = capturedParams.find(
      (p) =>
        typeof p === "string" &&
        p.includes('"uns_path_source":"explicit"'),
    );
    expect(extractedDataParam).toBeDefined();

    // Confidence param should be 0.8 (explicit band)
    const confidenceParam = capturedParams.find((p) => p === 0.8);
    expect(confidenceParam).toBeDefined();
  });

  // ── 3: malformed row is skipped, not a crash ─────────────────────────────
  it("skips the row with missing tag_path and imports the valid row", async () => {
    setupHappyPath(1);  // only 1 valid row
    const req = makeCsvRequest(MALFORMED_ROW_CSV);
    const res = await POST(req);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.imported).toBe(1);
    expect(body.skipped).toHaveLength(1);
    expect(body.skipped[0].reason).toBe("missing_tag_path");
  });

  // ── 4: tenant_id comes from session, never from request body ─────────────
  it("uses tenant_id from session even if a different one appears in the query", async () => {
    const ATTACKER_TENANT = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    vi.mocked(sessionOr401).mockResolvedValue(goodSession); // TENANT_ID

    let capturedTenantId: string | null = null;
    vi.mocked(withTenantContext).mockImplementation(async (tenantId, fn) => {
      capturedTenantId = tenantId;
      const fakeClient = {
        query: vi.fn().mockResolvedValue({ rows: [{ id: makeUuid(1) }] }),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return fn(fakeClient as any);
    });

    // Attempt to inject a different tenant via query param — router ignores it
    const url = new URL(
      `http://localhost/api/tags/import?tenant_id=${ATTACKER_TENANT}`,
    );
    const req = new NextRequest(url, {
      method: "POST",
      headers: { "content-type": "text/csv" },
      body: "tag_path\nLine5/Tag1",
    });

    await POST(req);

    // withTenantContext was called with the session tenant, not the attacker's
    expect(capturedTenantId).toBe(TENANT_ID);
    expect(capturedTenantId).not.toBe(ATTACKER_TENANT);
  });

  // ── 5: 401 when no session ───────────────────────────────────────────────
  it("returns 401 when session is missing", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const req = makeCsvRequest(THREE_ROW_CSV);
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(vi.mocked(withTenantContext)).not.toHaveBeenCalled();
  });

  // ── 6: 422 when CSV has no valid rows ────────────────────────────────────
  it("returns 422 when the CSV has no valid data rows", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);

    const emptyDataCsv = "tag_path,description\n"; // header only
    const req = makeCsvRequest(emptyDataCsv);
    const res = await POST(req);

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("no_valid_rows");
    expect(vi.mocked(withTenantContext)).not.toHaveBeenCalled();
  });

  // ── 7: 503 when DB is unconfigured ───────────────────────────────────────
  it("returns 503 when NEON_DATABASE_URL is not set", async () => {
    delete process.env.NEON_DATABASE_URL;

    const req = makeCsvRequest(THREE_ROW_CSV);
    const res = await POST(req);

    expect(res.status).toBe(503);
    expect(vi.mocked(sessionOr401)).not.toHaveBeenCalled();
  });

  // ── 8: 400 for invalid site_path query param ─────────────────────────────
  it("returns 400 when site_path query param has invalid format", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);

    const req = makeCsvRequest(THREE_ROW_CSV, {
      site_path: "INVALID PATH WITH SPACES",
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid site_path/);
  });

  // ── 9: valid site_path is threaded through to heuristic ─────────────────
  it("uses site_path for heuristic UNS inference when provided", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);

    let capturedParams: unknown[] = [];
    vi.mocked(withTenantContext).mockImplementation(async (_tenantId, fn) => {
      const fakeClient = {
        query: vi.fn().mockImplementation((_sql: string, params: unknown[]) => {
          capturedParams = params;
          return Promise.resolve({ rows: [{ id: makeUuid(1) }] });
        }),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return fn(fakeClient as any);
    });

    const csv = "tag_path\nLine5/Motor";
    const req = makeCsvRequest(csv, { site_path: "enterprise.plant" });
    await POST(req);

    // The extracted_data JSON param (the ::jsonb column) must carry the
    // candidate_uns_path with the site prefix AND mark it as heuristic.
    const jsonParam = capturedParams.find(
      (p) =>
        typeof p === "string" &&
        p.includes('"candidate_uns_path"') &&
        p.includes("enterprise.plant"),
    );
    expect(jsonParam).toBeDefined();
    expect(jsonParam as string).toContain('"uns_path_source":"heuristic"');
  });
});
