// Vitest coverage for POST /api/work-orders — the anomaly→work-order
// provenance link (master-plan T4). Mocks session + tenant-context so we can
// assert exactly what lands in the INSERT params without a real DB.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/capabilities", () => ({ requireCapability: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));

import { POST, rowToWO } from "../route";
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
    expect(insertCall!.params.at(-1)).toBe(DIFF_ID);

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
