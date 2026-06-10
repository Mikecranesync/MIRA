// Vitest coverage for GET /api/documents — the tenant-scope law (#1833).
//
// Run: cd mira-hub && npx vitest run src/app/api/documents
//
// Mocks the session helper and the db pool so each test drives one code path
// and asserts the SQL contract the route produces — specifically that it emits
// the canonical hybrid read filter `(is_private = false OR tenant_id = $caller)`
// on knowledge_entries and an explicit `tenant_id = $2` on the cmms_equipment
// lookup. That is the law in `.claude/rules/knowledge-entries-tenant-scoping.md`:
// the shared OEM corpus stays visible, the caller's own uploads stay visible,
// and another tenant's uploads are never returned.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/demo-auth", () => ({
  sessionOrDemo: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  default: { query: vi.fn() },
}));

import { GET } from "../route";
import { sessionOrDemo } from "@/lib/demo-auth";
import pool from "@/lib/db";

const TENANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OTHER_ASSET = "99999999-1111-2222-3333-444444444444";

const goodSession = {
  userId: "u_1",
  tenantId: TENANT_ID,
  email: "x@y",
  status: "trial",
  trialExpiresAt: null,
  isDemo: false,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const queryMock = (pool as any).query as ReturnType<typeof vi.fn>;

// Smart pool mock: route the call by table so the route's two-step flow works.
function wirePool(assetRow: Record<string, unknown> | null = null) {
  queryMock.mockImplementation((sql: string) => {
    if (/FROM cmms_equipment/.test(sql)) {
      return Promise.resolve({ rows: assetRow ? [assetRow] : [] });
    }
    // knowledge_entries rollup — return nothing; we assert the SQL, not rows.
    return Promise.resolve({ rows: [] });
  });
}

const makeReq = (qs = "") =>
  new Request(`https://hub.test/api/documents${qs}`);

// Pull the (sql, params) of the first call whose SQL matches a table.
function callFor(table: RegExp): { sql: string; params: unknown[] } {
  const call = queryMock.mock.calls.find((c) => table.test(c[0] as string));
  if (!call) throw new Error(`no query matched ${table}`);
  return { sql: call[0] as string, params: (call[1] as unknown[]) ?? [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  (sessionOrDemo as ReturnType<typeof vi.fn>).mockResolvedValue(goodSession);
});

describe("GET /api/documents — knowledge_entries hybrid tenant scoping", () => {
  it("emits the hybrid read filter scoped to the caller's tenant", async () => {
    wirePool();
    const res = await GET(makeReq());
    expect(res.status).toBe(200);

    const { sql, params } = callFor(/FROM knowledge_entries/);
    // The law: shared OEM corpus (is_private=false) OR the caller's own rows.
    expect(sql).toMatch(/\(is_private = false OR tenant_id = \$1\)/);
    // tenant_id is the first bound param and is the caller's tenant.
    expect(params[0]).toBe(TENANT_ID);
    // It must NOT be an unfiltered (universal) read.
    expect(sql).not.toMatch(/FROM knowledge_entries\s+GROUP BY/);
  });

  it("keeps the hybrid filter first when a manufacturer filter is added", async () => {
    wirePool();
    await GET(makeReq("?manufacturer=AutomationDirect"));
    const { sql, params } = callFor(/FROM knowledge_entries/);
    expect(sql).toMatch(/\(is_private = false OR tenant_id = \$1\)/);
    expect(params[0]).toBe(TENANT_ID);
    expect(params).toContain("AutomationDirect");
  });

  it("resolves cmms_equipment by id AND tenant_id (no cross-tenant IDOR)", async () => {
    wirePool({ manufacturer: "Allen-Bradley", model_number: "PowerFlex 525" });
    await GET(makeReq(`?asset_id=${OTHER_ASSET}`));

    const cmms = callFor(/FROM cmms_equipment/);
    expect(cmms.sql).toMatch(/WHERE id = \$1 AND tenant_id = \$2/);
    expect(cmms.params).toEqual([OTHER_ASSET, TENANT_ID]);

    // The resolved manufacturer/model still flow into the tenant-scoped rollup.
    const kb = callFor(/FROM knowledge_entries/);
    expect(kb.sql).toMatch(/\(is_private = false OR tenant_id = \$1\)/);
    expect(kb.params[0]).toBe(TENANT_ID);
    expect(kb.params).toContain("Allen-Bradley");
  });

  it("returns the auth response and never touches the db when unauthorized", async () => {
    const unauth = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    (sessionOrDemo as ReturnType<typeof vi.fn>).mockResolvedValue(unauth);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
