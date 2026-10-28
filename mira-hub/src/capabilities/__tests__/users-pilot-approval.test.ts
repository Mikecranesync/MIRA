import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ default: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("@/lib/data-schema", () => ({ ensureDataSchema: vi.fn() }));
vi.mock("@/capabilities/pilot-access", () => ({
  isPilotApprovalRequired: vi.fn(() => false),
  getPilotTenantStatus: vi.fn(async () => ({ pilotStatus: null, pilotExpiresAt: null })),
  redeemPilotSeat: vi.fn(async () => undefined),
}));

import pool from "@/lib/db";
import { PILOT_WINDOW_DAYS } from "@/lib/config";
import {
  getPilotTenantStatus,
  isPilotApprovalRequired,
  redeemPilotSeat,
} from "@/capabilities/pilot-access";
import { ensureInvitedUser, ensureUserAndTenant } from "../users";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const queryMock = (pool as any).query as ReturnType<typeof vi.fn>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const connectMock = (pool as any).connect as ReturnType<typeof vi.fn>;
const isPilotApprovalRequiredMock = isPilotApprovalRequired as unknown as ReturnType<typeof vi.fn>;
const getPilotTenantStatusMock = getPilotTenantStatus as unknown as ReturnType<typeof vi.fn>;
const redeemPilotSeatMock = redeemPilotSeat as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockResolvedValue({ rows: [] });
  isPilotApprovalRequiredMock.mockReturnValue(false);
  getPilotTenantStatusMock.mockResolvedValue({ pilotStatus: null, pilotExpiresAt: null });
});

describe("ensureUserAndTenant — #4878 approval-required signup", () => {
  it("CONTROL — flag off: unchanged (trial, 30-day window, no pilot_status write)", async () => {
    const clientQuery = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (/INSERT INTO hub_tenants/.test(sql)) return { rows: [{ id: "tenant-1" }] };
      if (/INSERT INTO hub_users/.test(sql)) {
        return { rows: [{ id: "user-1", email: "buyer@example.com" }] };
      }
      return { rows: [] };
    });
    connectMock.mockResolvedValue({ query: clientQuery, release: vi.fn() });

    await expect(ensureUserAndTenant({ email: "buyer@example.com" })).resolves.toEqual({
      id: "user-1",
      tenantId: "tenant-1",
      email: "buyer@example.com",
    });

    const insert = clientQuery.mock.calls.find((a) => /INSERT INTO hub_users/.test(String(a[0])));
    expect(String(insert?.[0])).toMatch(/'trial', NOW\(\) \+ \(\$6::int \* INTERVAL '1 day'\)/);
    expect(insert?.[1]).toEqual([
      "buyer@example.com",
      null,
      null,
      "tenant-1",
      null,
      PILOT_WINDOW_DAYS,
    ]);
    expect(clientQuery.mock.calls.some((a) => /pilot_status/.test(String(a[0])))).toBe(false);
  });

  it("flag on: the new owner is pending with no trial clock, tenant marked a pilot applicant", async () => {
    isPilotApprovalRequiredMock.mockReturnValue(true);
    const clientQuery = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (/INSERT INTO hub_tenants/.test(sql)) return { rows: [{ id: "tenant-2" }] };
      if (/INSERT INTO hub_users/.test(sql)) {
        return { rows: [{ id: "user-2", email: "applicant@example.com" }] };
      }
      return { rows: [] };
    });
    connectMock.mockResolvedValue({ query: clientQuery, release: vi.fn() });

    await expect(ensureUserAndTenant({ email: "applicant@example.com" })).resolves.toEqual({
      id: "user-2",
      tenantId: "tenant-2",
      email: "applicant@example.com",
    });

    const insert = clientQuery.mock.calls.find((a) => /INSERT INTO hub_users/.test(String(a[0])));
    expect(String(insert?.[0])).toMatch(/'pending', NULL/);
    expect(insert?.[1]).toEqual(["applicant@example.com", null, null, "tenant-2", null]);

    const tenantUpdate = clientQuery.mock.calls.find((a) => /pilot_status = 'pending'/.test(String(a[0])));
    expect(tenantUpdate?.[1]).toEqual(["tenant-2"]);
  });
});

describe("ensureInvitedUser — #4878 crew follow the organization", () => {
  it("CONTROL — flag off: a new invited user is still 'approved' with no expiry", async () => {
    queryMock.mockImplementation((sql: string) => {
      if (/SELECT .*FROM hub_users WHERE email_lower/.test(sql)) return Promise.resolve({ rows: [] });
      if (/INSERT INTO hub_users/.test(sql)) {
        return Promise.resolve({
          rows: [{ id: "user-new", email: "new@example.com", tenant_id: "tenant-1" }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(
      ensureInvitedUser({ email: "NEW@EXAMPLE.COM", tenantId: "tenant-1", role: "technician" }),
    ).resolves.toEqual({ id: "user-new", tenantId: "tenant-1", email: "new@example.com" });

    const insert = queryMock.mock.calls.find((a) => /INSERT INTO hub_users/.test(String(a[0])));
    expect(String(insert?.[0])).toMatch(/'approved'/);
    expect(insert?.[1]).toEqual(["new@example.com", "tenant-1", "technician"]);
    expect(getPilotTenantStatusMock).not.toHaveBeenCalled();
    expect(redeemPilotSeatMock).not.toHaveBeenCalled();
  });

  it("a new invited user on an active pilot tenant inherits the org's expiry and redeems the seat", async () => {
    isPilotApprovalRequiredMock.mockReturnValue(true);
    getPilotTenantStatusMock.mockResolvedValue({
      pilotStatus: "active",
      pilotExpiresAt: new Date("2026-11-27T00:00:00.000Z"),
    });
    queryMock.mockImplementation((sql: string) => {
      if (/SELECT .*FROM hub_users WHERE email_lower/.test(sql)) return Promise.resolve({ rows: [] });
      if (/INSERT INTO hub_users/.test(sql)) {
        return Promise.resolve({
          rows: [{ id: "user-crew", email: "crew@example.com", tenant_id: "tenant-1" }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(
      ensureInvitedUser({ email: "CREW@EXAMPLE.COM", tenantId: "tenant-1", role: "technician" }),
    ).resolves.toEqual({ id: "user-crew", tenantId: "tenant-1", email: "crew@example.com" });

    const insert = queryMock.mock.calls.find((a) => /INSERT INTO hub_users/.test(String(a[0])));
    expect(String(insert?.[0])).toMatch(/'trial', \$4\)/);
    expect(insert?.[1]).toEqual([
      "crew@example.com",
      "tenant-1",
      "technician",
      new Date("2026-11-27T00:00:00.000Z"),
    ]);
    expect(redeemPilotSeatMock).toHaveBeenCalledWith("tenant-1", "crew@example.com");
  });

  it("an existing member re-invited on an active pilot tenant moves to trial, except an admin stays admin", async () => {
    isPilotApprovalRequiredMock.mockReturnValue(true);
    getPilotTenantStatusMock.mockResolvedValue({
      pilotStatus: "active",
      pilotExpiresAt: new Date("2026-11-27T00:00:00.000Z"),
    });
    queryMock.mockImplementation((sql: string) => {
      if (/SELECT .*FROM hub_users WHERE email_lower/.test(sql)) {
        return Promise.resolve({
          rows: [
            {
              id: "user-existing",
              email: "existing@example.com",
              tenant_id: "tenant-1",
              status: "approved",
              role: "technician",
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    await ensureInvitedUser({ email: "existing@example.com", tenantId: "tenant-1", role: "admin" });

    const update = queryMock.mock.calls.find((a) => /UPDATE hub_users/.test(String(a[0])));
    expect(String(update?.[0])).toMatch(/ELSE 'trial' END/);
    expect(String(update?.[0])).toMatch(/WHEN status = 'admin' THEN status/);
    expect(update?.[1]).toEqual(["admin", "user-existing", new Date("2026-11-27T00:00:00.000Z")]);
  });
});
