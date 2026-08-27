import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => ({ getSession: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));

import { getSession } from "next-auth/react";
import { authProvider } from "@/providers/auth-provider";
import { NO_ROLE } from "@/lib/role";

describe("authProvider.getPermissions — never owner by default", () => {
  beforeEach(() => {
    vi.mocked(getSession).mockReset();
  });

  it.each([
    ["no session", null],
    ["user without role", { user: { id: "u1" } }],
    ["malformed role", { user: { role: "root" } }],
  ])("%s → NO_ROLE", async (_label, session) => {
    vi.mocked(getSession).mockResolvedValue(session as never);
    expect(await authProvider.getPermissions!()).toBe(NO_ROLE);
  });

  it("resolved role passes through", async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { role: "manager" } } as never);
    expect(await authProvider.getPermissions!()).toBe("manager");
  });
});
