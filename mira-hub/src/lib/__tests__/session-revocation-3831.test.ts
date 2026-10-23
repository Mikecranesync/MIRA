// #3831: a leaked Hub JWT must be killable for one user without rotating
// AUTH_SECRET (which signs everyone out). requireSession already reads
// hub_users per request for role; session_version rides that same read and
// fail-closes — unlike role, an unevaluable revocation signal is a 401.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next-auth/jwt", () => ({ decode: vi.fn() }));
vi.mock("@/lib/users", async (orig) => ({
  ...(await orig<typeof import("@/lib/users")>()),
  findUserById: vi.fn(),
}));

import { cookies } from "next/headers";
import { decode } from "next-auth/jwt";
import { findUserById } from "@/lib/users";
import { requireSession, UnauthorizedError } from "@/lib/session";

const TID = "11111111-2222-4333-8444-555555555555";
const USER_A = "user-a";
const USER_B = "user-b";

function cookiePresent() {
  vi.mocked(cookies).mockResolvedValue({
    get: (n: string) =>
      n === "__Secure-next-auth.session-token" ? { value: "jwt" } : undefined,
  } as never);
}

function token(over: Record<string, unknown> = {}) {
  vi.mocked(decode).mockResolvedValue({
    uid: USER_A,
    tid: TID,
    email: "a@example.com",
    status: "approved",
    sv: 0,
    ...over,
  } as never);
}

function user(over: Record<string, unknown> = {}) {
  return {
    id: USER_A,
    email: "a@example.com",
    role: "owner",
    status: "approved",
    sessionVersion: 0,
    ...over,
  } as never;
}

describe("requireSession — per-user session revocation (#3831)", () => {
  beforeEach(() => {
    vi.mocked(findUserById).mockReset();
    cookiePresent();
  });

  it("admits a live token whose generation matches the user row", async () => {
    token({ sv: 2 });
    vi.mocked(findUserById).mockResolvedValue(user({ sessionVersion: 2 }));
    const s = await requireSession();
    expect(s.userId).toBe(USER_A);
    expect(s.tenantId).toBe(TID);
  });

  it("rejects a leaked token after that user's sessions are revoked (generation bumped)", async () => {
    token({ sv: 0 });
    vi.mocked(findUserById).mockResolvedValue(user({ sessionVersion: 1 }));
    await expect(requireSession()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("treats a pre-deploy token with no sv claim as generation 0", async () => {
    token({ sv: undefined });
    vi.mocked(findUserById).mockResolvedValue(user({ sessionVersion: 0 }));
    await expect(requireSession()).resolves.toMatchObject({ userId: USER_A });
  });

  it("rejects a pre-deploy token once that user has been revoked (db generation > 0)", async () => {
    token({ sv: undefined });
    vi.mocked(findUserById).mockResolvedValue(user({ sessionVersion: 1 }));
    await expect(requireSession()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("does not revoke anyone else when user A's generation is bumped", async () => {
    token({ uid: USER_B, sv: 0 });
    vi.mocked(findUserById).mockResolvedValue(
      user({ id: USER_B, email: "b@example.com", sessionVersion: 0 }),
    );
    await expect(requireSession()).resolves.toMatchObject({ userId: USER_B });
    expect(findUserById).toHaveBeenCalledWith(USER_B);
  });

  it("fail-closes when the user row is gone — deletion is revocation", async () => {
    token();
    vi.mocked(findUserById).mockResolvedValue(null);
    await expect(requireSession()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("fail-closes when the revocation signal cannot be read (DB error)", async () => {
    token();
    vi.mocked(findUserById).mockRejectedValue(new Error("neon blip"));
    await expect(requireSession()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
