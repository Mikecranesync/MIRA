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
  sessionGeneration: (value: unknown) =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0,
}));

import { findUserById } from "@/lib/users";
import { authOptions, resolveRoleFromDb } from "@/auth";
import { NO_ROLE } from "@/lib/role";

type SessionCb = NonNullable<NonNullable<typeof authOptions.callbacks>["session"]>;
type JwtCb = NonNullable<NonNullable<typeof authOptions.callbacks>["jwt"]>;

async function runSessionCallback(token: Record<string, unknown>) {
  const cb = authOptions.callbacks!.session as SessionCb;
  const session = { user: { email: "t@x", name: null }, expires: "" } as never;
  return (await cb({ session, token, user: undefined as never, newSession: undefined, trigger: "update" } as never)) as {
    user: { role: string; id: string; tenantId: string };
  };
}

async function runJwtCallback(args: { token: Record<string, unknown>; user?: Record<string, unknown> }) {
  const cb = authOptions.callbacks!.jwt as JwtCb;
  return await cb({
    token: args.token,
    user: args.user as never,
    account: null,
    profile: undefined,
    trigger: args.user ? "signIn" : "update",
  } as never);
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

describe("jwt callback stamps session_version at issuance (#3831)", () => {
  beforeEach(() => {
    vi.mocked(findUserById).mockReset();
  });

  it("writes token.sv from the live user row on sign-in", async () => {
    vi.mocked(findUserById).mockResolvedValue({ sessionVersion: 7 } as never);
    const token = await runJwtCallback({
      token: {},
      user: { id: "u1", tenantId: "t1", status: "approved" },
    });
    expect(token.sv).toBe(7);
    expect(findUserById).toHaveBeenCalledWith("u1");
  });

  it("does not refresh sv when the callback runs without a user (session update)", async () => {
    vi.mocked(findUserById).mockResolvedValue({ sessionVersion: 99 } as never);
    const token = await runJwtCallback({
      token: { uid: "u1", tid: "t1", sv: 3 },
    });
    expect(token.sv).toBe(3);
    expect(findUserById).not.toHaveBeenCalled();
  });
});
