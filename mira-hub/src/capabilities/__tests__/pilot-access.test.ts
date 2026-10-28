import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ default: { query: vi.fn(), connect: vi.fn() } }));

import pool from "@/lib/db";
import { PILOT_COHORT_MAX_ORGS, PILOT_SEAT_MAX_USERS, PILOT_WINDOW_DAYS } from "@/lib/config";
import {
  PilotCohortCapError,
  PilotCohortRenewalError,
  PilotSeatCapError,
  PilotTenantNotFoundError,
  approvePilotTenant,
  endPilotTenant,
  getPilotTenantStatus,
  isPilotApprovalRequired,
  redeemPilotSeat,
  reservePilotSeat,
} from "../pilot-access";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const queryMock = (pool as any).query as ReturnType<typeof vi.fn>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const connectMock = (pool as any).connect as ReturnType<typeof vi.fn>;

/** Builds a fake transactional client whose `query` dispatches on a regex map,
 *  and records every call for assertions — mirrors the pattern in
 *  users-pilot.test.ts / platform-admin-4591-escalation.test.ts. */
function makeClient(handlers: Array<[RegExp, (sql: string, params: unknown[]) => unknown]>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    for (const [pattern, handler] of handlers) {
      if (pattern.test(sql)) return handler(sql, params);
    }
    return { rows: [] };
  });
  return { query, release: vi.fn(), calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockResolvedValue({ rows: [] });
  delete process.env.MIRA_PILOT_APPROVAL_REQUIRED;
});

describe("isPilotApprovalRequired", () => {
  it("is off by default", () => {
    expect(isPilotApprovalRequired()).toBe(false);
  });
  it("is on only for the exact string '1'", () => {
    process.env.MIRA_PILOT_APPROVAL_REQUIRED = "1";
    expect(isPilotApprovalRequired()).toBe(true);
    process.env.MIRA_PILOT_APPROVAL_REQUIRED = "true";
    expect(isPilotApprovalRequired()).toBe(false);
  });
});

describe("approvePilotTenant", () => {
  it("activates a pending tenant, sets the owner to trial with the org's expiry date", async () => {
    const client = makeClient([
      [
        /FROM hub_tenants WHERE id = \$1 FOR UPDATE/,
        () => ({
          rows: [
            {
              id: "tenant-1",
              owner_user_id: "owner-1",
              pilot_status: "pending",
              pilot_approved_at: null,
              pilot_expires_at: null,
              pilot_approved_by: null,
            },
          ],
        }),
      ],
      [/SELECT COUNT\(\*\)::int AS n FROM hub_tenants WHERE pilot_status = 'active'/, () => ({ rows: [{ n: 2 }] })],
      [
        /UPDATE hub_tenants[\s\S]*SET pilot_status = 'active'/,
        () => ({
          rows: [
            {
              id: "tenant-1",
              pilot_status: "active",
              pilot_approved_at: "2026-10-28T00:00:00.000Z",
              pilot_expires_at: "2026-11-27T00:00:00.000Z",
              pilot_approved_by: "admin-1",
            },
          ],
        }),
      ],
    ]);
    connectMock.mockResolvedValue(client);

    const result = await approvePilotTenant("tenant-1", "admin-1");

    expect(result.status).toBe("activated");
    expect(result.tenant.pilotStatus).toBe("active");
    expect(result.tenant.pilotExpiresAt).toBe("2026-11-27T00:00:00.000Z");

    const ownerUpdate = client.calls.find((c) => /UPDATE hub_users/.test(c.sql));
    expect(ownerUpdate).toBeTruthy();
    expect(ownerUpdate?.sql).toMatch(/status = 'trial'/);
    expect(ownerUpdate?.sql).toMatch(/AND status <> 'admin'/);
    expect(ownerUpdate?.params).toEqual(["owner-1", "2026-11-27T00:00:00.000Z"]);

    const expiryUpdate = client.calls.find((c) => /SET pilot_status = 'active'/.test(c.sql));
    expect(expiryUpdate?.params).toEqual(["tenant-1", PILOT_WINDOW_DAYS, "admin-1"]);
  });

  it("re-approving an already-active tenant is a no-op — it does not extend the date", async () => {
    const client = makeClient([
      [
        /FROM hub_tenants WHERE id = \$1 FOR UPDATE/,
        () => ({
          rows: [
            {
              id: "tenant-1",
              owner_user_id: "owner-1",
              pilot_status: "active",
              pilot_approved_at: "2026-10-01T00:00:00.000Z",
              pilot_expires_at: "2026-10-31T00:00:00.000Z",
              pilot_approved_by: "admin-1",
            },
          ],
        }),
      ],
    ]);
    connectMock.mockResolvedValue(client);

    const result = await approvePilotTenant("tenant-1", "admin-2");

    expect(result.status).toBe("already_active");
    expect(result.tenant.pilotExpiresAt).toBe("2026-10-31T00:00:00.000Z");
    // No write happened — no UPDATE query at all beyond the read.
    expect(client.calls.some((c) => /^UPDATE/i.test(c.sql.trim()))).toBe(false);
  });

  it("rejects re-approving an ended tenant — no automatic renewal", async () => {
    const client = makeClient([
      [
        /FROM hub_tenants WHERE id = \$1 FOR UPDATE/,
        () => ({
          rows: [{ id: "tenant-1", owner_user_id: "owner-1", pilot_status: "ended" }],
        }),
      ],
    ]);
    connectMock.mockResolvedValue(client);

    await expect(approvePilotTenant("tenant-1", "admin-1")).rejects.toBeInstanceOf(
      PilotCohortRenewalError,
    );
  });

  it("the sixth organization gets rejected with PilotCohortCapError when 5 are already active", async () => {
    const client = makeClient([
      [
        /FROM hub_tenants WHERE id = \$1 FOR UPDATE/,
        () => ({
          rows: [{ id: "tenant-6", owner_user_id: "owner-6", pilot_status: "pending" }],
        }),
      ],
      [
        /SELECT COUNT\(\*\)::int AS n FROM hub_tenants WHERE pilot_status = 'active'/,
        () => ({ rows: [{ n: PILOT_COHORT_MAX_ORGS }] }),
      ],
    ]);
    connectMock.mockResolvedValue(client);

    await expect(approvePilotTenant("tenant-6", "admin-1")).rejects.toBeInstanceOf(
      PilotCohortCapError,
    );
  });

  it("404s (via PilotTenantNotFoundError) for a missing tenant or one with no owner", async () => {
    const client = makeClient([
      [/FROM hub_tenants WHERE id = \$1 FOR UPDATE/, () => ({ rows: [] })],
    ]);
    connectMock.mockResolvedValue(client);

    await expect(approvePilotTenant("nope", "admin-1")).rejects.toBeInstanceOf(
      PilotTenantNotFoundError,
    );
  });
});

describe("endPilotTenant", () => {
  it("ends an active tenant and expires every non-admin user", async () => {
    const client = makeClient([
      [/UPDATE hub_tenants SET pilot_status = 'ended'/, () => ({ rows: [{ id: "tenant-1" }] })],
    ]);
    connectMock.mockResolvedValue(client);

    const result = await endPilotTenant("tenant-1");

    expect(result.ended).toBe(true);
    const usersUpdate = client.calls.find((c) => /UPDATE hub_users SET status = 'expired'/.test(c.sql));
    expect(usersUpdate?.sql).toMatch(/AND status <> 'admin'/);
    expect(usersUpdate?.params).toEqual(["tenant-1"]);
  });

  it("is a no-op for a tenant that isn't currently active", async () => {
    const client = makeClient([
      [/UPDATE hub_tenants SET pilot_status = 'ended'/, () => ({ rows: [] })],
    ]);
    connectMock.mockResolvedValue(client);

    const result = await endPilotTenant("tenant-1");

    expect(result.ended).toBe(false);
    expect(client.calls.some((c) => /UPDATE hub_users/.test(c.sql))).toBe(false);
  });
});

describe("getPilotTenantStatus", () => {
  it("reads the durable tenant columns, not a hub_users status", async () => {
    queryMock.mockResolvedValue({
      rows: [{ pilot_status: "active", pilot_expires_at: "2026-11-27T00:00:00.000Z" }],
    });
    const result = await getPilotTenantStatus("tenant-1");
    expect(result.pilotStatus).toBe("active");
    expect(result.pilotExpiresAt?.toISOString()).toBe("2026-11-27T00:00:00.000Z");
  });

  it("returns nulls for a tenant with no pilot row", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const result = await getPilotTenantStatus("tenant-x");
    expect(result).toEqual({ pilotStatus: null, pilotExpiresAt: null });
  });
});

describe("reservePilotSeat", () => {
  it("is a no-op (reserved: false) when the flag is off — never calls pool.connect", async () => {
    const result = await reservePilotSeat("tenant-1", "crew@example.com");
    expect(result).toEqual({ reserved: false });
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("is a no-op when the flag is on but the tenant isn't an active pilot", async () => {
    process.env.MIRA_PILOT_APPROVAL_REQUIRED = "1";
    const client = makeClient([
      [/SELECT pilot_status FROM hub_tenants WHERE id = \$1/, () => ({ rows: [{ pilot_status: "pending" }] })],
    ]);
    connectMock.mockResolvedValue(client);

    await expect(reservePilotSeat("tenant-1", "crew@example.com")).resolves.toEqual({
      reserved: false,
    });
    expect(client.calls.some((c) => /INSERT INTO pilot_seat_reservations/.test(c.sql))).toBe(false);
  });

  it("is a no-op for an email that is already a member", async () => {
    process.env.MIRA_PILOT_APPROVAL_REQUIRED = "1";
    const client = makeClient([
      [/SELECT pilot_status FROM hub_tenants WHERE id = \$1/, () => ({ rows: [{ pilot_status: "active" }] })],
      [/FROM hub_users WHERE tenant_id = \$1 AND email_lower = \$2/, () => ({ rows: [{ "1": 1 }] })],
    ]);
    connectMock.mockResolvedValue(client);

    await expect(reservePilotSeat("tenant-1", "crew@example.com")).resolves.toEqual({
      reserved: false,
    });
    expect(client.calls.some((c) => /INSERT INTO pilot_seat_reservations/.test(c.sql))).toBe(false);
  });

  it("F4 — a resend finds the existing reservation instead of reserving a second seat", async () => {
    process.env.MIRA_PILOT_APPROVAL_REQUIRED = "1";
    const client = makeClient([
      [/SELECT pilot_status FROM hub_tenants WHERE id = \$1/, () => ({ rows: [{ pilot_status: "active" }] })],
      [/FROM hub_users WHERE tenant_id = \$1 AND email_lower = \$2/, () => ({ rows: [] })],
      [/FROM pilot_seat_reservations WHERE tenant_id = \$1 AND email_lower = \$2/, () => ({ rows: [{ id: "res-1" }] })],
    ]);
    connectMock.mockResolvedValue(client);

    await expect(reservePilotSeat("tenant-1", "crew@example.com")).resolves.toEqual({
      reserved: true,
    });
    expect(client.calls.some((c) => /INSERT INTO pilot_seat_reservations/.test(c.sql))).toBe(false);
  });

  it(`throws PilotSeatCapError at ${PILOT_SEAT_MAX_USERS} occupied seats`, async () => {
    process.env.MIRA_PILOT_APPROVAL_REQUIRED = "1";
    const client = makeClient([
      [/SELECT pilot_status FROM hub_tenants WHERE id = \$1/, () => ({ rows: [{ pilot_status: "active" }] })],
      [/FROM hub_users WHERE tenant_id = \$1 AND email_lower = \$2/, () => ({ rows: [] })],
      [/FROM pilot_seat_reservations WHERE tenant_id = \$1 AND email_lower = \$2/, () => ({ rows: [] })],
      [/COUNT\(DISTINCT email_lower\)/, () => ({ rows: [{ n: PILOT_SEAT_MAX_USERS }] })],
    ]);
    connectMock.mockResolvedValue(client);

    await expect(reservePilotSeat("tenant-1", "sixth@example.com")).rejects.toBeInstanceOf(
      PilotSeatCapError,
    );
    expect(client.calls.some((c) => /INSERT INTO pilot_seat_reservations/.test(c.sql))).toBe(false);
  });

  it("reserves a seat below the cap", async () => {
    process.env.MIRA_PILOT_APPROVAL_REQUIRED = "1";
    const client = makeClient([
      [/SELECT pilot_status FROM hub_tenants WHERE id = \$1/, () => ({ rows: [{ pilot_status: "active" }] })],
      [/FROM hub_users WHERE tenant_id = \$1 AND email_lower = \$2/, () => ({ rows: [] })],
      [/FROM pilot_seat_reservations WHERE tenant_id = \$1 AND email_lower = \$2/, () => ({ rows: [] })],
      [/COUNT\(DISTINCT email_lower\)/, () => ({ rows: [{ n: 4 }] })],
    ]);
    connectMock.mockResolvedValue(client);

    await expect(reservePilotSeat("tenant-1", "fifth@example.com")).resolves.toEqual({
      reserved: true,
    });
    expect(client.calls.some((c) => /INSERT INTO pilot_seat_reservations/.test(c.sql))).toBe(true);
  });
});

describe("redeemPilotSeat", () => {
  it("transitions a pending reservation to redeemed", async () => {
    await redeemPilotSeat("tenant-1", "CREW@EXAMPLE.COM");
    const call = queryMock.mock.calls.find((c) => /SET status = 'redeemed'/.test(String(c[0])));
    expect(call).toBeTruthy();
    expect(call?.[1]).toEqual(["tenant-1", "crew@example.com"]);
    expect(String(call?.[0])).toMatch(/AND status = 'pending'/);
  });
});
