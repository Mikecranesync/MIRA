// #4250: the asset documents tab and the asset-intelligence KB search read
// knowledge_entries with `tenant_id = $1` alone, inside withTenantContext.
// Under that RLS context the shared OEM corpus (is_private = false, owned by
// the system tenant) is invisible, so an asset saw 0 OEM manuals for every
// manufacturer. The law (.claude/rules/knowledge-entries-tenant-scoping.md):
// hybrid filter `(is_private = false OR tenant_id = $caller)` on the RAW pool.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/workspace-files", () => ({ listFilesForTarget: vi.fn(async () => []) }));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn() } }));

import { GET as documentsGET } from "@/app/api/assets/[id]/documents/route";
import { searchKB } from "@/lib/agents/asset-intelligence";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import pool from "@/lib/db";

const TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ASSET = "11111111-2222-3333-4444-555555555555";
const HYBRID = /\(is_private = false OR tenant_id = \$1\)/;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const poolQuery = (pool as any).query as ReturnType<typeof vi.fn>;
const rlsQuery = vi.fn();

function kbCalls(fn: ReturnType<typeof vi.fn>) {
  return fn.mock.calls.filter((c) => /\bknowledge_entries\b/.test(String(c[0])));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  poolQuery.mockResolvedValue({ rows: [] });
  rlsQuery.mockImplementation(async (sql: string) =>
    /FROM cmms_equipment/.test(sql)
      ? { rows: [{ id: ASSET, manufacturer: "Allen-Bradley", model_number: "525", equipment_type: "VFD" }] }
      : { rows: [] },
  );
  vi.mocked(withTenantContext).mockImplementation(
    ((_t: string, fn: (c: unknown) => unknown) => fn({ query: rlsQuery })) as never,
  );
  vi.mocked(sessionOr401).mockResolvedValue({ userId: "u", tenantId: TENANT } as never);
});

describe("GET /api/assets/[id]/documents — suggested manuals (#4250)", () => {
  it("reads knowledge_entries on the raw pool with the hybrid filter", async () => {
    const res = await documentsGET(new Request("http://t/api/assets/x/documents"), {
      params: Promise.resolve({ id: ASSET }),
    } as never);
    expect(res.status).toBe(200);
    const calls = kbCalls(poolQuery);
    expect(calls).toHaveLength(1);
    expect(String(calls[0][0])).toMatch(HYBRID);
    expect((calls[0][1] as unknown[])[0]).toBe(TENANT);
    expect((calls[0][1] as unknown[])).toContain("Allen-Bradley");
  });

  it("never reads knowledge_entries through the RLS tenant context (it hides the OEM corpus)", async () => {
    const res = await documentsGET(new Request("http://t/api/assets/x/documents"), {
      params: Promise.resolve({ id: ASSET }),
    } as never);
    expect(res.status).toBe(200);
    expect(kbCalls(poolQuery).length + kbCalls(rlsQuery).length).toBe(1);
    expect(kbCalls(rlsQuery)).toHaveLength(0);
  });

  it("control: the asset itself is still resolved by id AND tenant (no IDOR)", async () => {
    const res = await documentsGET(new Request("http://t/api/assets/x/documents"), {
      params: Promise.resolve({ id: ASSET }),
    } as never);
    expect(res.status).toBe(200);
    const cmms = rlsQuery.mock.calls.find((c) => /FROM cmms_equipment/.test(String(c[0])));
    expect(String(cmms![0])).toMatch(/WHERE id = \$1 AND tenant_id = \$2/);
    expect(cmms![1]).toEqual([ASSET, TENANT]);
  });
});

describe("asset-intelligence searchKB (#4250)", () => {
  it("vector search: raw pool + hybrid filter", async () => {
    process.env.OLLAMA_BASE_URL = "http://ollama.test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ embedding: [0.1, 0.2] }))));
    await searchKB(TENANT, "Allen-Bradley 525");
    const calls = kbCalls(poolQuery);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(String(calls[0][0])).toMatch(/embedding <=>/);
    expect(String(calls[0][0])).toMatch(HYBRID);
    expect((calls[0][1] as unknown[])[0]).toBe(TENANT);
    expect(kbCalls(rlsQuery)).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("text fallback: raw pool + hybrid filter", async () => {
    process.env.OLLAMA_BASE_URL = "http://ollama.test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    await searchKB(TENANT, "Allen-Bradley 525", ["recall"]);
    const calls = kbCalls(poolQuery);
    expect(calls).toHaveLength(1);
    expect(String(calls[0][0])).toMatch(/plainto_tsquery/);
    expect(String(calls[0][0])).toMatch(HYBRID);
    expect((calls[0][1] as unknown[])[0]).toBe(TENANT);
    expect(kbCalls(rlsQuery)).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});
