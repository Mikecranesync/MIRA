// Vitest coverage for POST /api/pm-schedules/[id]/complete  (issue #1950).
//
// Run: cd mira-hub && npx vitest run src/app/api/pm-schedules
//
// Mocks the session helper and the tenant-context wrapper so each test drives a
// single code path. Asserts observable state (status, body, the SQL the route
// produced, and the args passed to UPDATE) rather than implementation detail.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(),
}));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(),
}));

import { POST } from "../route";
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

const makeReq = () =>
  new Request(`https://hub.test/api/pm-schedules/${VALID_UUID}/complete`, {
    method: "POST",
  });

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
});

describe("POST /api/pm-schedules/[id]/complete", () => {
  it("returns 503 when NEON_DATABASE_URL is unset", async () => {
    delete process.env.NEON_DATABASE_URL;
    const res = await POST(makeReq(), makeParams(VALID_UUID));
    expect(res.status).toBe(503);
  });

  it("propagates a 401 NextResponse from the session helper", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await POST(makeReq(), makeParams(VALID_UUID));
    expect(res.status).toBe(401);
  });

  it("returns 400 on an invalid UUID in the path", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    const res = await POST(makeReq(), makeParams("not-a-uuid"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the schedule is not found (covers cross-tenant via RLS)", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
      const client = { query: vi.fn(async () => ({ rows: [] })) };
      return await fn(client as never);
    });
    const res = await POST(makeReq(), makeParams(VALID_UUID));
    expect(res.status).toBe(404);
  });

  it("completes a calendar PM: stamps last_completed_at + future next_due_at, no meter reset", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    let updateSql = "";
    let updateArgs: unknown[] = [];

    vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
      const client = {
        query: vi.fn(async (sql: string, args: unknown[]) => {
          if (sql.includes("SELECT") && sql.includes("FROM pm_schedules")) {
            return {
              rows: [
                {
                  id: VALID_UUID,
                  trigger_type: "calendar",
                  interval_value: 6,
                  interval_unit: "months",
                },
              ],
            };
          }
          if (sql.includes("UPDATE pm_schedules")) {
            updateSql = sql;
            updateArgs = args;
            return {
              rows: [
                {
                  id: VALID_UUID,
                  next_due_at: "2099-01-01T00:00:00.000Z",
                  last_completed_at: "2026-06-14T00:00:00.000Z",
                  trigger_type: "calendar",
                  meter_current: 0,
                  meter_threshold: null,
                  meter_last_reset_at: null,
                },
              ],
            };
          }
          return { rows: [] };
        }),
      };
      return await fn(client as never);
    });

    const res = await POST(makeReq(), makeParams(VALID_UUID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schedule.id).toBe(VALID_UUID);

    // last_completed_at + next_due_at are persisted; meter is NOT reset for calendar PMs.
    expect(updateSql).toContain("last_completed_at = NOW()");
    expect(updateSql).toContain("next_due_at");
    expect(updateSql).not.toContain("meter_current = 0");

    // next_due_at (3rd positional arg) is in the future.
    const nextDue = new Date(updateArgs[2] as string);
    expect(nextDue.getTime()).toBeGreaterThan(Date.now());
  });

  it("completing a meter PM also resets the meter cycle", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    let updateSql = "";

    vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
      const client = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes("SELECT") && sql.includes("FROM pm_schedules")) {
            return {
              rows: [
                {
                  id: VALID_UUID,
                  trigger_type: "meter",
                  interval_value: 500,
                  interval_unit: "hours",
                },
              ],
            };
          }
          if (sql.includes("UPDATE pm_schedules")) {
            updateSql = sql;
            return { rows: [{ id: VALID_UUID, next_due_at: "2099-01-01T00:00:00.000Z" }] };
          }
          return { rows: [] };
        }),
      };
      return await fn(client as never);
    });

    const res = await POST(makeReq(), makeParams(VALID_UUID));
    expect(res.status).toBe(200);
    expect(updateSql).toContain("meter_current = 0");
    expect(updateSql).toContain("meter_last_reset_at = NOW()");
  });

  it("returns 500 when the UPDATE throws", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
      const client = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes("SELECT")) {
            return {
              rows: [{ id: VALID_UUID, trigger_type: "calendar", interval_value: 6, interval_unit: "months" }],
            };
          }
          throw new Error("db exploded");
        }),
      };
      return await fn(client as never);
    });
    const res = await POST(makeReq(), makeParams(VALID_UUID));
    expect(res.status).toBe(500);
  });
});
