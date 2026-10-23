// #3831 self-path: the signed-in user can kill every one of their own
// sessions. The route never accepts a target id — it can only bump ctx.userId.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const um = vi.hoisted(() => ({ revokeUserSessions: vi.fn() }));
vi.mock("@/lib/users", async (orig) => ({
  ...(await orig<typeof import("@/lib/users")>()),
  ...um,
}));
vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));

import { sessionOr401 } from "@/lib/session";
import { POST } from "@/app/api/user/sessions/revoke/route";

const TID = "11111111-2222-4333-8444-555555555555";
const CTX = {
  userId: "user-self",
  tenantId: TID,
  email: "self@example.com",
  status: "approved",
  trialExpiresAt: null,
  role: "technician",
};

beforeEach(() => {
  um.revokeUserSessions.mockReset();
  vi.mocked(sessionOr401).mockResolvedValue(CTX as never);
});

describe("POST /api/user/sessions/revoke (#3831)", () => {
  it("returns 401 when unauthenticated and does not write", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
    );
    const res = await POST(
      new Request("http://hub.test/api/user/sessions/revoke", {
        method: "POST",
        body: JSON.stringify({ userId: "someone-else" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(um.revokeUserSessions).not.toHaveBeenCalled();
  });

  it("bumps only the authenticated user, ignoring any body userId", async () => {
    um.revokeUserSessions.mockResolvedValue({ found: true, sessionVersion: 1 });
    const res = await POST(
      new Request("http://hub.test/api/user/sessions/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "someone-else" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, revoked: true, sessionVersion: 1 });
    expect(um.revokeUserSessions).toHaveBeenCalledTimes(1);
    expect(um.revokeUserSessions).toHaveBeenCalledWith("user-self");
  });
});
