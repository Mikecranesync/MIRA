// F10 (Codex #4882 post-cap review): the existing admin "Approve" button on
// /hub/admin/users (PATCH /api/admin/users/[id] -> updateUserStatus) predates
// approval-required pilot mode. With the flag on, it set a pending pilot
// applicant straight to 'approved' with no expiry, bypassing the 5-org
// cohort cap and the pilot window entirely — the dedicated
// POST /api/admin/pilots/[tenantId]/approve path was never consulted.
//
// Fix (mira-hub/src/app/(hub)/api/admin/users/[id]/route.ts): with the flag
// on, if the TARGET user's tenant is pilot-tracked (pilot_status 'pending'
// or 'active') and the requested status is 'approved' or 'trial', the check
// AND the eventual write happen atomically inside
// applyLegacyUserStatusChange (pilot-access.ts) — refused with 409 (409
// points at the dedicated endpoint; never silently delegated) when
// pilot-tracked, applied directly (still via applyLegacyUserStatusChange,
// not a bare updateUserStatus) when not.
//
// F11 (Codex #4882 review round 3): 'expired' is COMPLETELY UNCHANGED from
// pre-pilot behavior — it affects ONLY the targeted user via a plain
// updateUserStatus and NEVER consults or mutates tenant-level pilot state.
// The previous "delegate to endPilotTenant" behavior (removed here) let
// expiring ONE crew member end the entire organization's pilot and expire
// every other member, including the owner — that was the bug.
//
// F12 (Codex #4882 review round 3): applyLegacyUserStatusChange performs its
// pilot_status read and its hub_users write in ONE transaction under the
// same tenant-scoped advisory lock approvePilotTenant/endPilotTenant take,
// closing the race where activation could land between an unlocked read and
// an unconditional write.
//
// Flag off, or the tenant was never pilot-tracked (pilot_status null/ended),
// or the requested status is 'pending'/'admin': completely unchanged (plain
// updateUserStatus, no pilot-capability call at all).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next-auth/jwt", () => ({ decode: vi.fn() }));

const um = vi.hoisted(() => ({ findUserById: vi.fn(), updateUserStatus: vi.fn() }));
vi.mock("@/lib/users", async (orig) => ({ ...(await orig<typeof import("@/lib/users")>()), ...um }));

const pa = vi.hoisted(() => ({
  isPilotApprovalRequired: vi.fn(() => false),
  applyLegacyUserStatusChange: vi.fn(),
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
  pa.applyLegacyUserStatusChange.mockReset();
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

describe("F10/F12 — legacy admin-user-status PATCH respects pilot tenant governance (approved/trial)", () => {
  it("flag OFF: completely unchanged — approved goes straight through via plain updateUserStatus, no pilot-capability call at all", async () => {
    pa.isPilotApprovalRequired.mockReturnValue(false);
    const res = await patch("approved");
    expect(res.status).toBe(200);
    expect(um.updateUserStatus).toHaveBeenCalledWith("target-1", "approved");
    expect(pa.applyLegacyUserStatusChange).not.toHaveBeenCalled();
  });

  it("flag ON, status 'approved', applyLegacyUserStatusChange refuses (pilot-tracked tenant) -> 409, points at the dedicated endpoint, plain updateUserStatus never called", async () => {
    pa.isPilotApprovalRequired.mockReturnValue(true);
    pa.applyLegacyUserStatusChange.mockResolvedValue({ outcome: "refused", pilotStatus: "pending" });
    const res = await patch("approved");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/\/api\/admin\/pilots\/.*\/approve/);
    expect(pa.applyLegacyUserStatusChange).toHaveBeenCalledWith("target-1", TARGET_TID, "approved");
    expect(um.updateUserStatus).not.toHaveBeenCalled();
  });

  it("flag ON, status 'trial', applyLegacyUserStatusChange refuses (pilot-tracked tenant) -> 409, plain updateUserStatus never called", async () => {
    pa.isPilotApprovalRequired.mockReturnValue(true);
    pa.applyLegacyUserStatusChange.mockResolvedValue({ outcome: "refused", pilotStatus: "active" });
    const res = await patch("trial");
    expect(res.status).toBe(409);
    expect(pa.applyLegacyUserStatusChange).toHaveBeenCalledWith("target-1", TARGET_TID, "trial");
    expect(um.updateUserStatus).not.toHaveBeenCalled();
  });

  it("flag ON, status 'approved', applyLegacyUserStatusChange succeeds (not pilot-tracked) -> 200; the write already happened INSIDE applyLegacyUserStatusChange, so plain updateUserStatus is never called", async () => {
    pa.isPilotApprovalRequired.mockReturnValue(true);
    pa.applyLegacyUserStatusChange.mockResolvedValue({ outcome: "updated" });
    const res = await patch("approved");
    expect(res.status).toBe(200);
    expect(pa.applyLegacyUserStatusChange).toHaveBeenCalledWith("target-1", TARGET_TID, "approved");
    expect(um.updateUserStatus).not.toHaveBeenCalled();
  });

  it("flag ON, status 'approved', target user not found -> falls through to plain updateUserStatus unchanged (no tenant to check)", async () => {
    pa.isPilotApprovalRequired.mockReturnValue(true);
    um.findUserById.mockImplementation(async (id: string) => {
      if (id === "admin-1") return { role: "owner", status: "admin", tenantId: ADMIN_TID } as never;
      return null; // "target-1" not found this time
    });
    const res = await patch("approved");
    expect(res.status).toBe(200);
    expect(pa.applyLegacyUserStatusChange).not.toHaveBeenCalled();
    expect(um.updateUserStatus).toHaveBeenCalledWith("target-1", "approved");
  });
});

describe("F11 — legacy admin-user-status PATCH 'expired' never touches tenant-level pilot state", () => {
  it("flag ON, status 'expired' -> plain updateUserStatus only; applyLegacyUserStatusChange is NEVER called (expiring one user must never cascade to the whole org's pilot)", async () => {
    pa.isPilotApprovalRequired.mockReturnValue(true);
    const res = await patch("expired");
    expect(res.status).toBe(200);
    expect(pa.applyLegacyUserStatusChange).not.toHaveBeenCalled();
    expect(um.updateUserStatus).toHaveBeenCalledWith("target-1", "expired");
  });

  it("flag OFF, status 'expired' -> identical plain updateUserStatus path (flag state is irrelevant to 'expired')", async () => {
    pa.isPilotApprovalRequired.mockReturnValue(false);
    const res = await patch("expired");
    expect(res.status).toBe(200);
    expect(pa.applyLegacyUserStatusChange).not.toHaveBeenCalled();
    expect(um.updateUserStatus).toHaveBeenCalledWith("target-1", "expired");
  });
});

describe("F10 — statuses outside the governance gate stay completely unaffected", () => {
  it("flag ON, status 'admin' -> unaffected (platform-admin promotion must still work), no pilot-capability call", async () => {
    pa.isPilotApprovalRequired.mockReturnValue(true);
    const res = await patch("admin");
    expect(res.status).toBe(200);
    expect(um.updateUserStatus).toHaveBeenCalledWith("target-1", "admin");
    expect(pa.applyLegacyUserStatusChange).not.toHaveBeenCalled();
  });

  it("flag ON, status 'pending' -> unaffected, no pilot-capability call", async () => {
    pa.isPilotApprovalRequired.mockReturnValue(true);
    const res = await patch("pending");
    expect(res.status).toBe(200);
    expect(um.updateUserStatus).toHaveBeenCalledWith("target-1", "pending");
    expect(pa.applyLegacyUserStatusChange).not.toHaveBeenCalled();
  });
});
