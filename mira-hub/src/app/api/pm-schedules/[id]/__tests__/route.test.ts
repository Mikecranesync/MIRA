// Vitest coverage for PATCH /api/pm-schedules/[id]  (trigger-type updates, #1950).
//
// Run: cd mira-hub && npx vitest run src/app/api/pm-schedules
//
// This is the endpoint the schedule sheet's trigger buttons call. The bug in
// #1950 was client-side (wrong path + no error handling); these tests pin the
// server contract the client now depends on — in particular the deliberate 400
// when switching to a meter trigger without a threshold (surfaced as an error
// toast in the UI, NOT silently swallowed).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(),
}));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(),
}));

import { PATCH } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

const VALID_UUID = "11111111-2222-3333-4444-555555555555";
const TENANT_ID = "00000000-0000-0000-0000-0000000000d1";

const goodSession = {
  userId: "u_1",
  tenantId: TENANT_ID,
  email: "x@y",
  status: "trial",
  trialExpiresAt: null,
};

const makeReq = (body: unknown) =>
  new Request(`https://hub.test/api/pm-schedules/${VALID_UUID}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
});

describe("PATCH /api/pm-schedules/[id]", () => {
  it("returns 503 when NEON_DATABASE_URL is unset", async () => {
    delete process.env.NEON_DATABASE_URL;
    const res = await PATCH(makeReq({ trigger_type: "calendar" }), makeParams(VALID_UUID));
    expect(res.status).toBe(503);
  });

  it("propagates a 401 NextResponse from the session helper", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await PATCH(makeReq({ trigger_type: "calendar" }), makeParams(VALID_UUID));
    expect(res.status).toBe(401);
  });

  it("rejects an unknown trigger_type with 400", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    const res = await PATCH(makeReq({ trigger_type: "nonsense" }), makeParams(VALID_UUID));
    expect(res.status).toBe(400);
  });

  it("rejects switching to a meter trigger without a threshold (400) — surfaced as an error toast in the UI", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    const res = await PATCH(makeReq({ trigger_type: "meter" }), makeParams(VALID_UUID));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/meter_threshold/i);
  });

  it("updates a calendar trigger: 200, runs the UPDATE with the new trigger_type", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    let updateSql = "";
    let updateArgs: unknown[] = [];

    vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
      const client = {
        query: vi.fn(async (sql: string, args: unknown[]) => {
          updateSql = sql;
          updateArgs = args;
          return { rows: [{ id: VALID_UUID, trigger_type: "calendar" }] };
        }),
      };
      return await fn(client as never);
    });

    const res = await PATCH(makeReq({ trigger_type: "calendar" }), makeParams(VALID_UUID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schedule.trigger_type).toBe("calendar");
    expect(updateSql).toContain("UPDATE pm_schedules");
    expect(updateSql).toContain("trigger_type =");
    expect(updateArgs).toContain("calendar");
  });

  it("allows a meter trigger when a threshold is supplied (200)", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
      const client = {
        query: vi.fn(async () => ({
          rows: [{ id: VALID_UUID, trigger_type: "meter", meter_threshold: 500 }],
        })),
      };
      return await fn(client as never);
    });

    const res = await PATCH(
      makeReq({ trigger_type: "meter", meter_threshold: 500 }),
      makeParams(VALID_UUID),
    );
    expect(res.status).toBe(200);
  });

  it("returns 404 when the schedule is not found (covers cross-tenant via RLS)", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
      const client = { query: vi.fn(async () => ({ rows: [] })) };
      return await fn(client as never);
    });
    const res = await PATCH(makeReq({ trigger_type: "calendar" }), makeParams(VALID_UUID));
    expect(res.status).toBe(404);
  });
});
