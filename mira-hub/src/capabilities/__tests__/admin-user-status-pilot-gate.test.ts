// F10 (Codex #4882 post-cap review): the existing admin "Approve" button on
// /hub/admin/users (PATCH /api/admin/users/[id] -> updateUserStatus) predates
// approval-required pilot mode. With the flag on, it set a pending pilot
// applicant straight to 'approved' with no expiry, bypassing the 5-org
// cohort cap and the pilot window entirely — the dedicated
// POST /api/admin/pilots/[tenantId]/approve path was never consulted.
//
// Fix (mira-hub/src/app/(hub)/api/admin/users/[id]/route.ts): with the flag
// on, if the TARGET user's tenant is pilot-tracked (pilot_status 'pending'
// or 'active'):
//   - status 'approved' or 'trial' -> refused with 409, pointing at the
//     dedicated endpoint (never silently delegated — this legacy route has
//     no notion of "which tenant", so it cannot safely decide for itself).
//   - status 'expired' on an ACTIVE pilot tenant -> delegates to
//     endPilotTenant(tenantId) first (ends the governance window + bulk-
//     expires crew), then still applies the direct per-row update too (so
//     the specific targeted row — even an admin's, which endPilotTenant
//     excludes — matches what was requested).
// Flag off, or the tenant was never pilot-tracked (pilot_status null/ended),
// or the requested status is 'pending'/'admin': completely unchanged.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next-auth/jwt", () => ({ decode: vi.fn() }));

const um = vi.hoisted(() => ({ findUserById: vi.fn(), updateUserStatus: vi.fn() }));
vi.mock("@/lib/users", async (orig) => ({ ...(await orig<typeof import("@/lib/users")>()), ...um }));

const pa = vi.hoisted(() => ({
  isPilotApprovalRequired: vi.fn(() => false),
  getPilotTenantStatus: vi.fn(),
  endPilotTenant: vi.fn(),
}));
vi.mock("@/capabilities/pilot-access", async (orig) => ({
  ...(await orig<typeof import("@/capabilities/pilot-access")>()),
  ...pa,
}));

import { cookies } from "next/headers";
import { decode } from "next-auth/jwt";
import { PATCH as patchUserStatus } from "@/app/(hub)/api/admin/users/[id]/route";

const ADMIN_TID = "11111111-2222-4333-8444-555555555555";
const TARGET_TID = "22222222-3333-4444-8555-666666666666";

function patch(status: string) {
  return patchUserStatus(
    new Request("http://hub.test/hub/api/admin/users/target-1", {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ id: "target-1" }) },
  );
}

beforeEach(() => {
  um.findUserById.mockReset();
  um.updateUserStatus.mockReset().mockResolvedValue(undefined);
  pa.isPilotApprovalRequired.mockReset().mockReturnValue(false);
  pa.getPilotTenantStatus.mockReset();
  pa.endPilotTenant.mockReset();
  vi.mocked(cookies).mockResolvedValue({
    get: (n: string) => (n === "__Secure-next-auth.session-token" ? { value: "jwt" } : undefined),
  } as never);
  vi.mocked(decode).mockResolvedValue({ uid: "admin-1", tid: ADMIN_TID, status: "admin" } as never);
  // findUserById is called twice per request: once by requireSession (for
  // the CALLER, "admin-1"), once by the route (for the TARGET, "target-1").
  um.findUserById.mockImplementation(async (id: string) => {
    if (id === "admin-1") return { role: "owner", status: "admin", tenantId: ADMIN_TID } as never;
    if (id === "target-1") return { tenantId: TARGET_TID } as never;
    return null;
  });
});

describe("F10 — legacy admin-user-status PATCH respects pilot tenant governance", () => {
  it("flag OFF: completely unchanged — approved still goes straight through, no pilot lookup at all", async () => {
    pa.isPilotApprovalRequired.mockReturnValue(false);
    const res = await patch("approved");
    expect(res.status).toBe(200);
    expect(um.updateUserStatus).toHaveBeenCalledWith("target-1", "approved");
    expect(pa.getPilotTenantStatus).not.toHaveBeenCalled();
  });

  it("flag ON, target tenant pilot_status 'pending', status 'approved' -> 409, no write, points at the dedicated endpoint", async () => {
    pa.isPilotApprovalRequired.mockReturnValue(true);
    pa.getPilotTenantStatus.mockResolvedValue({ pilotStatus: "pending", pilotExpiresAt: null });
    const res = await patch("approved");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/\/api\/admin\/pilots\/.*\/approve/);
    expect(um.updateUserStatus).not.toHaveBeenCalled();
  });

  it("flag ON, target tenant pilot_status 'active', status 'trial' -> 409, no write (this route never grants trial directly for a pilot tenant)", async () => {
    pa.isPilotApprovalRequired.mockReturnValue(true);
    pa.getPilotTenantStatus.mockResolvedValue({ pilotStatus: "active", pilotExpiresAt: new Date() });
    const res = await patch("trial");
    expect(res.status).toBe(409);
    expect(um.updateUserStatus).not.toHaveBeenCalled();
  });

  it("flag ON, target tenant pilot_status 'active', status 'expired' -> delegates to endPilotTenant, THEN still applies the direct row update", async () => {
    pa.isPilotApprovalRequired.mockReturnValue(true);
    pa.getPilotTenantStatus.mockResolvedValue({ pilotStatus: "active", pilotExpiresAt: new Date() });
    pa.endPilotTenant.mockResolvedValue({ ended: true });
    const res = await patch("expired");
    expect(res.status).toBe(200);
    expect(pa.endPilotTenant).toHaveBeenCalledWith(TARGET_TID);
    expect(um.updateUserStatus).toHaveBeenCalledWith("target-1", "expired");
  });

  it("flag ON, target tenant pilot_status 'pending' (never activated), status 'expired' -> does NOT call endPilotTenant (nothing to end), still applies the direct row update", async () => {
    pa.isPilotApprovalRequired.mockReturnValue(true);
    pa.getPilotTenantStatus.mockResolvedValue({ pilotStatus: "pending", pilotExpiresAt: null });
    const res = await patch("expired");
    expect(res.status).toBe(200);
    expect(pa.endPilotTenant).not.toHaveBeenCalled();
    expect(um.updateUserStatus).toHaveBeenCalledWith("target-1", "expired");
  });

  it("flag ON, target tenant NEVER pilot-tracked (pilot_status null) -> completely unchanged, legacy approve still works", async () => {
    pa.isPilotApprovalRequired.mockReturnValue(true);
    pa.getPilotTenantStatus.mockResolvedValue({ pilotStatus: null, pilotExpiresAt: null });
    const res = await patch("approved");
    expect(res.status).toBe(200);
    expect(um.updateUserStatus).toHaveBeenCalledWith("target-1", "approved");
  });

  it("flag ON, target tenant pilot_status 'ended' -> completely unchanged (out of this gate's scope)", async () => {
    pa.isPilotApprovalRequired.mockReturnValue(true);
    pa.getPilotTenantStatus.mockResolvedValue({ pilotStatus: "ended", pilotExpiresAt: null });
    const res = await patch("approved");
    expect(res.status).toBe(200);
    expect(um.updateUserStatus).toHaveBeenCalledWith("target-1", "approved");
  });

  it("flag ON, target tenant pilot_status 'active', status 'admin' -> unaffected (platform-admin promotion must still work)", async () => {
    pa.isPilotApprovalRequired.mockReturnValue(true);
    pa.getPilotTenantStatus.mockResolvedValue({ pilotStatus: "active", pilotExpiresAt: new Date() });
    const res = await patch("admin");
    expect(res.status).toBe(200);
    expect(um.updateUserStatus).toHaveBeenCalledWith("target-1", "admin");
    expect(pa.getPilotTenantStatus).not.toHaveBeenCalled();
  });

  it("flag ON, target tenant pilot_status 'active', status 'pending' -> unaffected", async () => {
    pa.isPilotApprovalRequired.mockReturnValue(true);
    pa.getPilotTenantStatus.mockResolvedValue({ pilotStatus: "active", pilotExpiresAt: new Date() });
    const res = await patch("pending");
    expect(res.status).toBe(200);
    expect(um.updateUserStatus).toHaveBeenCalledWith("target-1", "pending");
    expect(pa.getPilotTenantStatus).not.toHaveBeenCalled();
  });
});
