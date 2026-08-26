/**
 * The NextAuth `session` callback must put a DB-derived role on the session —
 * the client providers read it, and before this callback set nothing they
 * defaulted every user to owner.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/users", () => ({
  ensureInvitedUser: vi.fn(),
  ensureUserAndTenant: vi.fn(),
  findUserByEmail: vi.fn(),
  findUserById: vi.fn(),
  validateMagicToken: vi.fn(),
}));

import { findUserById } from "@/lib/users";
import { authOptions, resolveRoleFromDb } from "@/auth";
import { NO_ROLE } from "@/lib/role";

type SessionCb = NonNullable<NonNullable<typeof authOptions.callbacks>["session"]>;

async function runSessionCallback(token: Record<string, unknown>) {
  const cb = authOptions.callbacks!.session as SessionCb;
  const session = { user: { email: "t@x", name: null }, expires: "" } as never;
  return (await cb({ session, token, user: undefined as never, newSession: undefined, trigger: "update" } as never)) as {
    user: { role: string; id: string; tenantId: string };
  };
}

describe("resolveRoleFromDb", () => {
  beforeEach(() => {
    vi.mocked(findUserById).mockReset();
  });

  it("no uid → NO_ROLE without touching the DB", async () => {
    expect(await resolveRoleFromDb(undefined)).toBe(NO_ROLE);
    expect(findUserById).not.toHaveBeenCalled();
  });

  it("row missing → NO_ROLE", async () => {
    vi.mocked(findUserById).mockResolvedValue(null);
    expect(await resolveRoleFromDb("u1")).toBe(NO_ROLE);
  });

  it("DB error → NO_ROLE (least privilege, request still authenticated)", async () => {
    vi.mocked(findUserById).mockImplementation(async () => { throw new Error("neon blip"); });
    expect(await resolveRoleFromDb("u1")).toBe(NO_ROLE);
  });

  it("malformed stored role → NO_ROLE; valid role → itself", async () => {
    vi.mocked(findUserById).mockResolvedValue({ role: "member" } as never);
    expect(await resolveRoleFromDb("u1")).toBe(NO_ROLE);
    vi.mocked(findUserById).mockResolvedValue({ role: "technician" } as never);
    expect(await resolveRoleFromDb("u1")).toBe("technician");
  });
});

describe("session callback", () => {
  beforeEach(() => {
    vi.mocked(findUserById).mockReset();
  });

  it("sets session.user.role from hub_users, fresh per call", async () => {
    vi.mocked(findUserById).mockResolvedValue({ role: "admin" } as never);
    const s = await runSessionCallback({ uid: "u1", tid: "t1" });
    expect(s.user.role).toBe("admin");
    expect(findUserById).toHaveBeenCalledWith("u1");

    vi.mocked(findUserById).mockResolvedValue({ role: "technician" } as never); // revoked
    expect((await runSessionCallback({ uid: "u1", tid: "t1" })).user.role).toBe("technician");
  });

  it("sets NO_ROLE (not owner) when the lookup fails", async () => {
    vi.mocked(findUserById).mockImplementation(async () => { throw new Error("down"); });
    expect((await runSessionCallback({ uid: "u1", tid: "t1" })).user.role).toBe(NO_ROLE);
  });
});
