// Vitest coverage for POST /api/pm-schedules (SCH-04, #3226) — the human
// create door the mobile Schedule tab calls. Pins the contract: 201 with the
// GET-shaped {schedule}, stable 400 tokens per field, 401 unauthenticated,
// 403 without pm_schedules.write, tenant-scoped 404 for foreign/nonexistent
// assets, and reuse of the canonical insert shape (calendar trigger,
// auto_extracted=false, denormalized manufacturer/model from the asset row).
//
// Run: cd mira-hub && npx vitest run src/app/api/pm-schedules

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(),
}));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(),
}));

import { POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

const TENANT_ID = "00000000-0000-0000-0000-0000000000d1";
const ASSET_ID = "11111111-2222-3333-4444-555555555555";

// role:"owner" passes the pm_schedules.write capability gate; the full RBAC
// matrix is unit-tested in src/lib/__tests__/capabilities.test.ts.
const goodSession = {
  userId: "u_1",
  tenantId: TENANT_ID,
  email: "x@y",
  status: "trial",
  trialExpiresAt: null,
  role: "owner",
};

const GOOD_BODY = {
  equipment_id: ASSET_ID,
  task: "Grease main bearing",
  interval_value: 3,
  interval_unit: "months",
};

const makeReq = (body: unknown) =>
  new Request("https://hub.test/api/pm-schedules", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;

/** withTenantContext mock backed by scripted query results (FIFO). */
function scriptQueries(results: { rows: unknown[] }[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  vi.mocked(withTenantContext).mockImplementation(async (_tenant, fn) => {
    let i = 0;
    const client = {
      query: (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return Promise.resolve(results[Math.min(i++, results.length - 1)]);
      },
    };
    return fn(client as never);
  });
  return calls;
}

const insertedRow = {
  id: "99999999-8888-7777-6666-555555555555",
  tenant_id: TENANT_ID,
  manufacturer: "Allen-Bradley",
  model_number: "25B-D010N104",
  equipment_id: ASSET_ID,
  task: "Grease main bearing",
  interval_value: 3,
  interval_unit: "months",
  interval_type: "time",
  parts_needed: [],
  tools_needed: [],
  estimated_duration_minutes: null,
  safety_requirements: ["LOTO"],
  criticality: "medium",
  source_citation: null,
  confidence: null,
  next_due_at: "2026-11-13T00:00:00.000Z",
  last_completed_at: null,
  auto_extracted: false,
  created_at: "2026-08-13T00:00:00.000Z",
  trigger_type: "calendar",
  meter_type: null,
  meter_threshold: null,
  meter_current: 0,
};

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
  vi.mocked(sessionOr401).mockResolvedValue(goodSession as never);
});

describe("POST /api/pm-schedules", () => {
  it("creates and returns the GET-shaped schedule (201)", async () => {
    const calls = scriptQueries([
      { rows: [{ id: ASSET_ID, manufacturer: "Allen-Bradley", model_number: "25B-D010N104" }] },
      { rows: [insertedRow] },
    ]);
    const res = await POST(
      makeReq({ ...GOOD_BODY, safety_requirements: ["LOTO"] }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.schedule.id).toBe(insertedRow.id);
    expect(body.schedule.title).toBe("Grease main bearing");
    expect(body.schedule.recur).toBe("Quarterly");
    expect(body.schedule.auto_extracted).toBe(false);
    expect(body.schedule.trigger_type).toBe("calendar");
    // Insert reuses the canonical column shape + tenant/asset params
    const insert = calls[1];
    expect(insert.sql).toContain("INSERT INTO pm_schedules");
    expect(insert.sql).toContain("auto_extracted");
    expect(insert.params[0]).toBe(TENANT_ID);
    expect(insert.params[3]).toBe(ASSET_ID);
  });

  it("401 when unauthenticated", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }) as never,
    );
    const res = await POST(makeReq(GOOD_BODY));
    expect(res.status).toBe(401);
    expect(withTenantContext).not.toHaveBeenCalled();
  });

  it("403 without pm_schedules.write (viewer role)", async () => {
    vi.mocked(sessionOr401).mockResolvedValue({ ...goodSession, role: "viewer" } as never);
    const res = await POST(makeReq(GOOD_BODY));
    expect(res.status).toBe(403);
    expect(withTenantContext).not.toHaveBeenCalled();
  });

  it("404 asset_not_found for a cross-tenant or nonexistent asset (no leak)", async () => {
    scriptQueries([{ rows: [] }]);
    const res = await POST(makeReq(GOOD_BODY));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("asset_not_found");
  });

  it("400 tokens: missing/invalid fields", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ ...GOOD_BODY, equipment_id: undefined }, "equipment_id_required"],
      [{ ...GOOD_BODY, equipment_id: "not-a-uuid" }, "invalid_equipment_id"],
      [{ ...GOOD_BODY, task: "  " }, "task_required"],
      [{ ...GOOD_BODY, interval_value: 0 }, "invalid_interval"],
      [{ ...GOOD_BODY, interval_value: 1.5 }, "invalid_interval"],
      [{ ...GOOD_BODY, interval_unit: "fortnights" }, "invalid_interval"],
      [{ ...GOOD_BODY, interval_unit: "cycles" }, "invalid_interval"], // meter-only unit
      [{ ...GOOD_BODY, next_due_at: "not-a-date" }, "invalid_next_due_at"],
      [{ ...GOOD_BODY, criticality: "urgent" }, "invalid_criticality"],
      [{ ...GOOD_BODY, estimated_duration_minutes: -5 }, "invalid_duration"],
      [{ ...GOOD_BODY, parts_needed: [1, 2] }, "invalid_string_array"],
    ];
    for (const [body, token] of cases) {
      const res = await POST(makeReq(body));
      expect(res.status, token).toBe(400);
      expect((await res.json()).error, JSON.stringify(body)).toBe(token);
    }
    expect(withTenantContext).not.toHaveBeenCalled();
  });

  it("defaults next_due_at to now + interval via shared math when omitted", async () => {
    const calls = scriptQueries([
      { rows: [{ id: ASSET_ID, manufacturer: "AB", model_number: "X" }] },
      { rows: [insertedRow] },
    ]);
    await POST(makeReq(GOOD_BODY)); // 3 months, no next_due_at
    const nextDue = new Date(String(calls[1].params[12]));
    const expected = new Date();
    expected.setMonth(expected.getMonth() + 3);
    expect(Math.abs(nextDue.getTime() - expected.getTime())).toBeLessThan(60_000);
  });

  it("503 when NEON_DATABASE_URL is unset", async () => {
    delete process.env.NEON_DATABASE_URL;
    const res = await POST(makeReq(GOOD_BODY));
    expect(res.status).toBe(503);
  });

  it("500 with a stable error body when the insert throws", async () => {
    vi.mocked(withTenantContext).mockRejectedValue(new Error("boom"));
    const res = await POST(makeReq(GOOD_BODY));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Create failed");
  });
});

describe("rowToPM raw timestamps (mobile 'due unscheduled' fix)", () => {
  it("201 response carries ISO next_due_at even when pg returns a Date object", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession as never);
    scriptQueries([
      { rows: [{ id: ASSET_ID, manufacturer: "AB", model_number: "X" }] },
      { rows: [{ ...insertedRow, next_due_at: new Date("2026-11-13T00:00:00.000Z") }] },
    ]);
    const res = await POST(makeReq(GOOD_BODY));
    const body = await res.json();
    expect(body.schedule.next_due_at).toBe("2026-11-13T00:00:00.000Z");
    expect(body.schedule.date).toBe("2026-11-13");
    expect(body.schedule.last_completed_at).toBeNull();
  });
});
