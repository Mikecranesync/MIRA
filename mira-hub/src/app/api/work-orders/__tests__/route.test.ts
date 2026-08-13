// Vitest coverage for POST /api/work-orders — the anomaly→work-order
// provenance link (master-plan T4). Mocks session + tenant-context so we can
// assert exactly what lands in the INSERT params without a real DB.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/capabilities", () => ({ requireCapability: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));

import { GET, POST, rowToWO } from "../route";
import { sessionOr401 } from "@/lib/session";
import { requireCapability } from "@/lib/capabilities";
import { withTenantContext } from "@/lib/tenant-context";

const TENANT = "tenant-aaaa";
const EQUIPMENT_ID = "11111111-2222-3333-4444-555555555555";
const DIFF_ID = "99999999-8888-7777-6666-555555555555";
const session = { userId: "u_1", tenantId: TENANT, email: "x@y", role: "owner" };

function postReq(body: Record<string, unknown>) {
  return new Request("http://t/api/work-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

// A mock pg client whose query() answers by matching SQL fragments, and
// records every call so the test can inspect the exact params passed.
function mockClient(handlers: Array<[RegExp, { rows: unknown[] }]>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      for (const [re, res] of handlers) if (re.test(sql)) return res;
      return { rows: [] };
    }),
  };
  return { client, calls };
}

function wireClient(client: { query: ReturnType<typeof vi.fn> }) {
  vi.mocked(withTenantContext).mockImplementation(
    ((_t: string, fn: (c: unknown) => unknown) => fn(client)) as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  vi.mocked(sessionOr401).mockResolvedValue(session as never);
  vi.mocked(requireCapability).mockReturnValue(null);
});

describe("POST /api/work-orders — source_run_diff_id", () => {
  it("includes the diff id as an INSERT param when provided", async () => {
    const { client, calls } = mockClient([
      [/FROM cmms_equipment/, { rows: [{ id: EQUIPMENT_ID, manufacturer: "Allen-Bradley", model_number: "525" }] }],
      [/INSERT INTO work_orders/, { rows: [{ id: "wo-1", work_order_number: "WO-ABC12345", source_run_diff_id: DIFF_ID }] }],
    ]);
    wireClient(client);

    const res = await POST(
      postReq({
        equipment_id: EQUIPMENT_ID,
        description: "Motor current anomaly",
        source_run_diff_id: DIFF_ID,
      }),
    );

    expect(res.status).toBe(201);
    const insertCall = calls.find(({ sql }) => /INSERT INTO work_orders/.test(sql));
    expect(insertCall).toBeDefined();
    // client_key (074) is now the final param; assert presence, not position.
    expect(insertCall!.params).toContain(DIFF_ID);

    const body = (await res.json()) as { work_order: { source_run_diff_id: string | null } };
    expect(body.work_order.source_run_diff_id).toBe(DIFF_ID);
  });

  it("passes null when source_run_diff_id is omitted", async () => {
    const { client, calls } = mockClient([
      [/FROM cmms_equipment/, { rows: [{ id: EQUIPMENT_ID, manufacturer: "Allen-Bradley", model_number: "525" }] }],
      [/INSERT INTO work_orders/, { rows: [{ id: "wo-2", work_order_number: "WO-DEF67890", source_run_diff_id: null }] }],
    ]);
    wireClient(client);

    const res = await POST(
      postReq({
        equipment_id: EQUIPMENT_ID,
        description: "Routine issue, no anomaly link",
      }),
    );

    expect(res.status).toBe(201);
    const insertCall = calls.find(({ sql }) => /INSERT INTO work_orders/.test(sql));
    expect(insertCall).toBeDefined();
    expect(insertCall!.params.at(-1)).toBeNull();
  });

  it("rejects a malformed (non-UUID) source_run_diff_id as null rather than passing it through", async () => {
    const { client, calls } = mockClient([
      [/FROM cmms_equipment/, { rows: [{ id: EQUIPMENT_ID, manufacturer: "Allen-Bradley", model_number: "525" }] }],
      [/INSERT INTO work_orders/, { rows: [{ id: "wo-3", work_order_number: "WO-GHI11111", source_run_diff_id: null }] }],
    ]);
    wireClient(client);

    const res = await POST(
      postReq({
        equipment_id: EQUIPMENT_ID,
        description: "Bad diff id",
        source_run_diff_id: "not-a-uuid",
      }),
    );

    expect(res.status).toBe(201);
    const insertCall = calls.find(({ sql }) => /INSERT INTO work_orders/.test(sql));
    expect(insertCall!.params.at(-1)).toBeNull();
  });

  it("401 passthrough when unauthenticated", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
    );
    const res = await POST(postReq({ equipment_id: EQUIPMENT_ID, description: "x" }));
    expect(res.status).toBe(401);
  });
});

describe("rowToWO source_run_diff_id (T4)", () => {
  it("surfaces the diff id when present", () => {
    const wo = rowToWO({ id: "wo-1", title: "Pump down", status: "open", source_run_diff_id: DIFF_ID });
    expect(wo.source_run_diff_id).toBe(DIFF_ID);
  });

  it("returns null (not undefined) when absent", () => {
    const wo = rowToWO({ id: "wo-2", title: "Inspect", status: "open" });
    expect(wo.source_run_diff_id).toBeNull();
    expect("source_run_diff_id" in wo).toBe(true);
  });
});

function getReq() {
  // GET reads req.nextUrl.searchParams (a NextRequest field), so provide it.
  return { nextUrl: new URL("http://t/api/work-orders") } as unknown as Parameters<typeof GET>[0];
}

// A Postgres error carries a SQLSTATE `code`; the degradation keys on it.
function pgError(message: string, code: string) {
  return Object.assign(new Error(message), { code });
}

describe("GET /api/work-orders — schema-behind graceful degradation", () => {
  it("degrades to empty AND logs on undefined_column 42703 (dev DB behind migration 060)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(withTenantContext).mockRejectedValue(
      pgError('column "source_run_diff_id" does not exist', "42703") as never,
    );
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 0, work_orders: [] });
    // Observable: the degradation is logged (never a silent empty list).
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("SQLSTATE 42703"),
      expect.any(String),
    );
    warn.mockRestore();
  });

  it("degrades to empty on undefined_table 42P01 (table missing)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(withTenantContext).mockRejectedValue(
      pgError('relation "work_orders" does not exist', "42P01") as never,
    );
    const res = await GET(getReq());
    expect(await res.json()).toEqual({ count: 0, work_orders: [] });
  });

  it("does NOT degrade on a 'does not exist' MESSAGE without a schema SQLSTATE (no silent mask)", async () => {
    // A genuine error whose text merely contains "does not exist" (e.g. a
    // constraint/trigger failure) must NOT be masked as empty data.
    vi.mocked(withTenantContext).mockRejectedValue(
      pgError("function some_fn() does not exist in this context", "42883") as never,
    );
    const res = await GET(getReq());
    expect(res.status).toBe(500);
  });

  it("returns 500 on a genuine query failure (no schema code)", async () => {
    vi.mocked(withTenantContext).mockRejectedValue(new Error("connection terminated") as never);
    const res = await GET(getReq());
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Idempotency — client_key replay contract (migration 074, native-mobile P3)
// ---------------------------------------------------------------------------
describe("POST /api/work-orders — client_key idempotency", () => {
  const KEY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const WO_ROW = {
    id: "wo-1",
    work_order_number: "WO-EXISTING1",
    status: "open",
    priority: "medium",
    tenant_id: TENANT,
  };

  it("replays an existing (tenant, client_key) row as 200 replayed:true — no duplicate insert", async () => {
    const { client, calls } = mockClient([
      [/WHERE tenant_id = \$1 AND client_key = \$2/, { rows: [WO_ROW] }],
    ]);
    wireClient(client);
    const res = (await POST(
      postReq({ equipment_id: EQUIPMENT_ID, description: "d", client_key: KEY }),
    )) as NextResponse;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { replayed?: boolean; work_order: { work_order_number: string } };
    expect(body.replayed).toBe(true);
    expect(body.work_order.work_order_number).toBe("WO-EXISTING1");
    expect(calls.some((c) => /INSERT INTO work_orders/.test(c.sql))).toBe(false);
  });

  it("fresh key → 201, INSERT carries client_key as a param and ON CONFLICT clause", async () => {
    const { client, calls } = mockClient([
      [/WHERE tenant_id = \$1 AND client_key = \$2/, { rows: [] }],
      [/FROM cmms_equipment/, { rows: [{ id: EQUIPMENT_ID, manufacturer: "AB", model_number: "525" }] }],
      [/INSERT INTO work_orders/, { rows: [{ ...WO_ROW, work_order_number: "WO-NEW00001" }] }],
    ]);
    wireClient(client);
    const res = (await POST(
      postReq({ equipment_id: EQUIPMENT_ID, description: "d", client_key: KEY }),
    )) as NextResponse;
    expect(res.status).toBe(201);
    const insert = calls.find((c) => /INSERT INTO work_orders/.test(c.sql))!;
    expect(insert.sql).toMatch(/ON CONFLICT \(tenant_id, client_key\)/);
    expect(insert.params).toContain(KEY);
    const body = (await res.json()) as { replayed?: boolean };
    expect(body.replayed).toBe(false);
  });

  it("concurrent race (INSERT conflicts, returns 0 rows) resolves to the winner as 200 replayed", async () => {
    let selectCount = 0;
    const { client } = mockClient([]);
    client.query.mockImplementation(async (sql: string) => {
      if (/WHERE tenant_id = \$1 AND client_key = \$2/.test(sql)) {
        selectCount += 1;
        // 1st pre-check: nothing yet; 2nd post-conflict re-select: winner row.
        return { rows: selectCount === 1 ? [] : [WO_ROW] };
      }
      if (/FROM cmms_equipment/.test(sql))
        return { rows: [{ id: EQUIPMENT_ID, manufacturer: "AB", model_number: "525" }] };
      if (/INSERT INTO work_orders/.test(sql)) return { rows: [] }; // conflict
      return { rows: [] };
    });
    wireClient(client);
    const res = (await POST(
      postReq({ equipment_id: EQUIPMENT_ID, description: "d", client_key: KEY }),
    )) as NextResponse;
    expect(res.status).toBe(200);
    expect(((await res.json()) as { replayed?: boolean }).replayed).toBe(true);
  });

  it("malformed client_key is rejected 400 (never silently ignored)", async () => {
    const { client } = mockClient([]);
    wireClient(client);
    const res = (await POST(
      postReq({ equipment_id: EQUIPMENT_ID, description: "d", client_key: "not-a-uuid" }),
    )) as NextResponse;
    expect(res.status).toBe(400);
  });

  it("no client_key → legacy path unchanged (201, NULL key param, no replay probe)", async () => {
    const { client, calls } = mockClient([
      [/FROM cmms_equipment/, { rows: [{ id: EQUIPMENT_ID, manufacturer: "AB", model_number: "525" }] }],
      [/INSERT INTO work_orders/, { rows: [WO_ROW] }],
    ]);
    wireClient(client);
    const res = (await POST(postReq({ equipment_id: EQUIPMENT_ID, description: "d" }))) as NextResponse;
    expect(res.status).toBe(201);
    expect(calls.some((c) => /WHERE tenant_id = \$1 AND client_key = \$2/.test(c.sql))).toBe(false);
    const insert = calls.find((c) => /INSERT INTO work_orders/.test(c.sql))!;
    expect(insert.params[insert.params.length - 1]).toBeNull();
  });
});
