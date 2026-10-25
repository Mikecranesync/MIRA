// #4362 / Codex #4664 F3: a buyer signed in under the old 7-day trial carries a
// day-8 deadline in the session cookie. The database now says 30 days; the next
// session read must carry that into the cookie, and the real middleware must then
// let a day-8 request through. The control proves the gate still fires on the
// stale cookie, so the pass is the refresh and not a disabled gate.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";
import { encode } from "next-auth/jwt";

vi.mock("@/lib/users", () => ({
  findUserById: vi.fn(),
  findUserByEmail: vi.fn(),
  ensureUserAndTenant: vi.fn(),
  ensureInvitedUser: vi.fn(),
  validateMagicToken: vi.fn(),
}));

import { refreshEntitlementClaims } from "@/capabilities/session-entitlement";
import { authOptions } from "@/auth";
import middleware from "@/middleware";
import { findUserById } from "@/lib/users";

const DAY = 24 * 60 * 60 * 1000;
const CREATED = new Date("2026-10-01T12:00:00Z");
const SECRET = "test-secret-for-entitlement-refresh-0123456789";

function staleToken() {
  return {
    uid: "11111111-2222-3333-4444-555555555555",
    tid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    status: "trial",
    trialExpiresAt: new Date(CREATED.getTime() + 7 * DAY).toISOString(),
  };
}

async function requestWith(token: Record<string, unknown>) {
  const cookie = await encode({ token, secret: SECRET });
  const req = new NextRequest(new URL("http://localhost/assets/"), {
    headers: { cookie: `next-auth.session-token=${cookie}` },
  });
  return middleware(req, {} as NextFetchEvent);
}

function landsOnUpgrade(res: Response) {
  const loc = res.headers.get("location");
  return !!loc && new URL(loc).pathname.replace(/\/$/, "") === "/upgrade";
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = SECRET;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CREATED.getTime() + 8 * DAY));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("refreshEntitlementClaims", () => {
  it("copies the database deadline and status onto the token", async () => {
    const thirty = new Date(CREATED.getTime() + 30 * DAY);
    const out = await refreshEntitlementClaims(staleToken(), async () => ({ status: "trial", trialExpiresAt: thirty }));
    expect(out.trialExpiresAt).toBe(thirty.toISOString());
    expect(out.status).toBe("trial");
  });

  it("keeps the token unchanged when the lookup throws", async () => {
    const t = staleToken();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await refreshEntitlementClaims(t, async () => { throw new Error("db down"); })).toEqual(t);
  });

  it("keeps the token unchanged when the user row is gone", async () => {
    const t = staleToken();
    expect(await refreshEntitlementClaims(t, async () => null)).toEqual(t);
  });

  it("does not look anything up without a user id", async () => {
    const lookup = vi.fn();
    await refreshEntitlementClaims({ status: "trial" }, lookup);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("carries a later expiry from the database too (no one-way extension)", async () => {
    const past = new Date(CREATED.getTime() + 2 * DAY);
    const out = await refreshEntitlementClaims(staleToken(), async () => ({ status: "expired", trialExpiresAt: past }));
    expect(out.status).toBe("expired");
  });
});

describe("day-8 buyer with a pre-deploy session cookie (#4664 F3)", () => {
  it("control: the stale 7-day cookie is sent to /upgrade on day 8", async () => {
    expect(landsOnUpgrade(await requestWith(staleToken()))).toBe(true);
  });

  it("after one session read, the same buyer gets through on day 8", async () => {
    vi.mocked(findUserById).mockResolvedValue({
      status: "trial",
      trialExpiresAt: new Date(CREATED.getTime() + 30 * DAY),
    } as never);
    const jwt = authOptions.callbacks!.jwt!;
    const refreshed = await jwt({ token: staleToken() } as never);
    expect(findUserById).toHaveBeenCalledWith(staleToken().uid);
    const res = await requestWith(refreshed as Record<string, unknown>);
    expect(landsOnUpgrade(res)).toBe(false);
  });

  it("day 31: the refreshed 30-day cookie is still sent to /upgrade", async () => {
    vi.setSystemTime(new Date(CREATED.getTime() + 31 * DAY));
    vi.mocked(findUserById).mockResolvedValue({
      status: "trial",
      trialExpiresAt: new Date(CREATED.getTime() + 30 * DAY),
    } as never);
    const refreshed = await authOptions.callbacks!.jwt!({ token: staleToken() } as never);
    expect(landsOnUpgrade(await requestWith(refreshed as Record<string, unknown>))).toBe(true);
  });
});
