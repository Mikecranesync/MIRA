// #3831 admin path: platform admin can kill one user's sessions without a
// status change and without touching anyone else. Tenant-only callers 403.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next-auth/jwt", () => ({ decode: vi.fn() }));

const um = vi.hoisted(() => ({
  findUserById: vi.fn(),
  updateUserStatus: vi.fn(),
  revokeUserSessions: vi.fn(),
}));
vi.mock("@/lib/users", async (orig) => ({
  ...(await orig<typeof import("@/lib/users")>()),
  ...um,
}));

import { cookies } from "next/headers";
import { decode } from "next-auth/jwt";
import { PATCH } from "@/app/(hub)/api/admin/users/[id]/route";

const TID = "11111111-2222-4333-8444-555555555555";

function patch(body: unknown, id = "u-target") {
  return PATCH(
    new Request(`http://hub.test/hub/api/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  um.findUserById.mockReset();
  um.updateUserStatus.mockReset();
  um.revokeUserSessions.mockReset();
  vi.mocked(cookies).mockResolvedValue({
    get: (n: string) =>
      n === "__Secure-next-auth.session-token" ? { value: "jwt" } : undefined,
  } as never);
});

describe("PATCH /api/admin/users/[id] revokeSessions (#3831)", () => {
  it("platform admin bumps only the named user", async () => {
    vi.mocked(decode).mockResolvedValue({
      uid: "u-admin",
      tid: TID,
      email: "ops@factorylm.com",
      status: "admin",
      sv: 0,
    } as never);
    um.findUserById.mockResolvedValue({
      role: "owner",
      status: "admin",
      sessionVersion: 0,
    } as never);
    um.revokeUserSessions.mockResolvedValue({ found: true, sessionVersion: 2 });

    const res = await patch({ revokeSessions: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, revoked: true, sessionVersion: 2 });
    expect(um.revokeUserSessions).toHaveBeenCalledWith("u-target");
    expect(um.updateUserStatus).not.toHaveBeenCalled();
  });

  it("404 when the target user does not exist — no other row is updated", async () => {
    vi.mocked(decode).mockResolvedValue({
      uid: "u-admin",
      tid: TID,
      email: "ops@factorylm.com",
      status: "admin",
      sv: 0,
    } as never);
    um.findUserById.mockResolvedValue({
      role: "owner",
      status: "admin",
      sessionVersion: 0,
    } as never);
    um.revokeUserSessions.mockResolvedValue({ found: false, sessionVersion: null });

    const res = await patch({ revokeSessions: true }, "ghost");
    expect(res.status).toBe(404);
    expect(um.revokeUserSessions).toHaveBeenCalledWith("ghost");
  });

  it("tenant owner without the platform flag cannot revoke sessions (403)", async () => {
    vi.mocked(decode).mockResolvedValue({
      uid: "u-owner",
      tid: TID,
      email: "owner@customer.test",
      status: "approved",
      sv: 0,
    } as never);
    um.findUserById.mockResolvedValue({
      role: "owner",
      status: "approved",
      sessionVersion: 0,
    } as never);

    const res = await patch({ revokeSessions: true });
    expect(res.status).toBe(403);
    expect(um.revokeUserSessions).not.toHaveBeenCalled();
  });
});
