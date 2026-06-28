// Vitest coverage for GET /api/assets/[id]/agent-status.
// Mocks the session + tenant-context so each test drives one code path.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));

import { GET } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

const ID = "11111111-2222-3333-4444-555555555555";
const TENANT = "tenant-aaaa";
const session = { userId: "u_1", tenantId: TENANT, email: "x@y" };

// A mock pg client whose query() answers by matching SQL fragments.
function mockClient(handlers: Array<[RegExp, { rows: unknown[] }]>) {
  return {
    query: vi.fn(async (sql: string) => {
      for (const [re, res] of handlers) if (re.test(sql)) return res;
      return { rows: [] };
    }),
  };
}

function wireClient(client: { query: ReturnType<typeof vi.fn> }) {
  vi.mocked(withTenantContext).mockImplementation(
    ((_t: string, fn: (c: unknown) => unknown) => fn(client)) as never,
  );
}

const params = Promise.resolve({ id: ID });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  vi.mocked(sessionOr401).mockResolvedValue(session as never);
});

describe("GET agent-status", () => {
  it("503 when DB not configured", async () => {
    delete process.env.NEON_DATABASE_URL;
    const res = await GET(new Request("http://t"), { params });
    expect(res.status).toBe(503);
  });

  it("401 passthrough when unauthenticated", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
    );
    const res = await GET(new Request("http://t"), { params });
    expect(res.status).toBe(401);
  });

  it("404 when the asset does not exist", async () => {
    wireClient(mockClient([[/FROM cmms_equipment/, { rows: [] }]]));
    const res = await GET(new Request("http://t"), { params });
    expect(res.status).toBe(404);
  });

  it("defaults to draft / exists=false when no status row", async () => {
    wireClient(
      mockClient([
        [/FROM cmms_equipment/, { rows: [{ manufacturer: "Allen-Bradley", model_number: "525" }] }],
        [/FROM asset_agent_status/, { rows: [] }],
        [/COUNT\(DISTINCT source_url\)/, { rows: [{ n: 3 }] }],
        [/FROM asset_validation_qa/, { rows: [{ total: 0, good: 0, good_cited: 0, min_ground: null }] }],
      ]),
    );
    const res = await GET(new Request("http://t"), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe("draft");
    expect(body.exists).toBe(false);
    expect(body.docCount).toBe(3);
    expect(body.readyToApprove).toBe(false);
  });

  it("reports readyToApprove when validating + §5 met", async () => {
    wireClient(
      mockClient([
        [/FROM cmms_equipment/, { rows: [{ manufacturer: "AB", model_number: "" }] }],
        [/FROM asset_agent_status/, { rows: [{ state: "validating" }] }],
        [/COUNT\(DISTINCT source_url\)/, { rows: [{ n: 1 }] }],
        [
          /FROM asset_validation_qa/,
          { rows: [{ total: 6, good: 5, good_cited: 5, min_ground: 4 }] },
        ],
      ]),
    );
    const res = await GET(new Request("http://t"), { params });
    const body = await res.json();
    expect(body.state).toBe("validating");
    expect(body.citationCoverage).toBe(5);
    expect(body.readyToApprove).toBe(true);
  });
});
