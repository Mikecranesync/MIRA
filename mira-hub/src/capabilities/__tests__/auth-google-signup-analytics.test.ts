/**
 * Google OAuth new-account path fires signup_completed with cookie UTMs.
 * Existing Google users must not re-fire the conversion.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const cookieGet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGet })),
}));

vi.mock("@/lib/db", () => ({ default: { query: vi.fn(), connect: vi.fn() } }));

vi.mock("@/lib/users", () => ({
  ensureInvitedUser: vi.fn(),
  ensureUserAndTenant: vi.fn(),
  findUserByEmail: vi.fn(),
  findUserById: vi.fn(),
  validateMagicToken: vi.fn(),
}));

vi.mock("@/capabilities/pilot-funnel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/capabilities/pilot-funnel")>();
  return {
    ...actual,
    handlePilotApplicationSubmitted: vi.fn(async () => undefined),
  };
});

import { ensureUserAndTenant, findUserByEmail } from "@/lib/users";
import { handlePilotApplicationSubmitted } from "@/capabilities/pilot-funnel";
import { authOptions } from "@/auth";
import { UTM_COOKIE_NAME } from "../utm";

const mockFind = vi.mocked(findUserByEmail);
const mockEnsure = vi.mocked(ensureUserAndTenant);
const mockHook = vi.mocked(handlePilotApplicationSubmitted) as unknown as Mock;

type SignInCb = NonNullable<NonNullable<typeof authOptions.callbacks>["signIn"]>;

async function runGoogleSignIn() {
  const cb = authOptions.callbacks!.signIn as SignInCb;
  const user = { id: "", email: "", tenantId: "", status: "", trialExpiresAt: null };
  await cb({
    user,
    account: { provider: "google", providerAccountId: "sub-1" } as never,
    profile: { email: "new@plant.com", name: "Alex" } as never,
  } as never);
  return user;
}

describe("Google signIn — signup_completed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieGet.mockReturnValue(undefined);
    mockEnsure.mockResolvedValue({ id: "user-1", tenantId: "tenant-1", email: "new@plant.com" });
    mockHook.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fires the funnel hook with method=google and cookie UTMs for a NEW account", async () => {
    mockFind.mockResolvedValue(null);
    cookieGet.mockImplementation((name: string) =>
      name === UTM_COOKIE_NAME ? { value: "utm_source=linkedin&utm_campaign=q4" } : undefined,
    );

    await runGoogleSignIn();

    await vi.waitFor(() => {
      expect(mockHook).toHaveBeenCalledTimes(1);
    });
    const arg = mockHook.mock.calls[0][0];
    expect(arg.method).toBe("google");
    expect(arg.tenantId).toBe("tenant-1");
    expect(arg.userId).toBe("user-1");
    expect(arg.attribution.utmSource).toBe("linkedin");
    expect(arg.attribution.utmCampaign).toBe("q4");
    expect(arg.email).toBe("new@plant.com");
  });

  it("does not fire the hook when the Google email already has a Hub user", async () => {
    mockFind.mockResolvedValue({
      id: "existing",
      email: "new@plant.com",
      tenantId: "tenant-old",
      passwordHash: null,
      googleSub: "sub-1",
      name: "Alex",
      role: "owner",
      status: "trial",
      trialExpiresAt: null,
      plan: null,
      preferences: {},
    });

    await runGoogleSignIn();

    await new Promise((r) => setTimeout(r, 10));
    expect(mockHook).not.toHaveBeenCalled();
  });
});
