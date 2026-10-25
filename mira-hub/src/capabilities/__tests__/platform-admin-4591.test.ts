// #4591: platform admin (cross-tenant review queue + global user admin) must rest on authority that
// public registration cannot mint. That authority is hub_users.status = 'admin', read fresh from the
// DB per request — never an email match, never the JWT's copy of status — and nothing may set it
// from an email address.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next-auth/jwt", () => ({ decode: vi.fn() }));
vi.mock("@/lib/users", async (orig) => ({ ...(await orig<typeof import("@/lib/users")>()), findUserById: vi.fn() }));

import { cookies } from "next/headers";
import { decode } from "next-auth/jwt";
import { findUserById } from "@/lib/users";
import { requireSession, type SessionContext } from "@/lib/session";
import { getCapabilities } from "@/lib/capabilities";

const TID = "11111111-2222-4333-8444-555555555555";
const ALLOWLISTED = "harperhousebuyers@gmail.com"; // in the default ADMIN_EMAILS

function ctx(over: Partial<SessionContext>): SessionContext {
  return { userId: "u", tenantId: TID, email: "owner@example.com", status: "trial", trialExpiresAt: null, role: "owner", platformAdmin: false, ...over };
}
const PLATFORM = ["review_queue.read", "review_queue.decide", "platform.users.read"] as const;

describe("getCapabilities — platform caps need the DB admin flag (#4591)", () => {
  it("an allowlisted email WITHOUT the DB flag (a self-registered claim) gets no platform caps", () => {
    const caps = getCapabilities(ctx({ email: ALLOWLISTED, status: "trial", platformAdmin: false }));
    for (const c of PLATFORM) expect(caps).not.toContain(c);
  });

  it("a stale/forged JWT status of 'admin' without the DB flag gets no platform caps", () => {
    const caps = getCapabilities(ctx({ email: ALLOWLISTED, status: "admin", platformAdmin: false }));
    for (const c of PLATFORM) expect(caps).not.toContain(c);
  });

  it("an absent flag (a hand-built context) is treated as not-admin", () => {
    const bare: SessionContext = ctx({ email: ALLOWLISTED, status: "admin" });
    delete bare.platformAdmin;
    const caps = getCapabilities(bare);
    for (const c of PLATFORM) expect(caps).not.toContain(c);
  });

  it("a provisioned admin on the allowlist keeps review + user-admin access", () => {
    const caps = getCapabilities(ctx({ email: ALLOWLISTED, status: "admin", platformAdmin: true }));
    for (const c of PLATFORM) expect(caps).toContain(c);
  });

  it("a provisioned admin NOT on the review allowlist keeps user-admin only (no widening of review)", () => {
    const caps = getCapabilities(ctx({ email: "ops@factorylm.com", platformAdmin: true }));
    expect(caps).toContain("platform.users.read");
    expect(caps).not.toContain("review_queue.read");
  });

  it("tenant owner/admin roles never imply platform caps", () => {
    for (const role of ["owner", "admin"]) {
      const caps = getCapabilities(ctx({ role, platformAdmin: false }));
      for (const c of PLATFORM) expect(caps).not.toContain(c);
    }
  });
});

describe("requireSession derives platformAdmin fresh from hub_users.status (#4591)", () => {
  const token = (over: Record<string, unknown> = {}) =>
    vi.mocked(decode).mockResolvedValue({ uid: "u1", tid: TID, email: ALLOWLISTED, status: "admin", ...over } as never);
  beforeEach(() => {
    vi.mocked(cookies).mockResolvedValue({ get: (n: string) => (n === "__Secure-next-auth.session-token" ? { value: "jwt" } : undefined) } as never);
  });

  it("DB status 'admin' → platformAdmin true", async () => {
    token();
    vi.mocked(findUserById).mockResolvedValue({ role: "owner", status: "admin" } as never);
    expect((await requireSession()).platformAdmin).toBe(true);
  });

  it("DB status 'trial' overrides a JWT that still says 'admin' → false", async () => {
    token({ status: "admin" });
    vi.mocked(findUserById).mockResolvedValue({ role: "owner", status: "trial" } as never);
    expect((await requireSession()).platformAdmin).toBe(false);
  });

  it.each(["approved", "pending", "expired", "Admin ", ""])("DB status %j → false", async (status) => {
    token();
    vi.mocked(findUserById).mockResolvedValue({ role: "owner", status } as never);
    expect((await requireSession()).platformAdmin).toBe(false);
  });

  it("deleted user or a DB error → false (fail closed), session itself still resolves", async () => {
    token();
    vi.mocked(findUserById).mockResolvedValue(null);
    expect((await requireSession()).platformAdmin).toBe(false);
    vi.mocked(findUserById).mockRejectedValue(new Error("db blip"));
    const s = await requireSession();
    expect(s.platformAdmin).toBe(false);
    expect(s.tenantId).toBe(TID);
  });
});

describe("no code path mints admin from an email address (#4591)", () => {
  it("ensureSchema does not promote any email to status 'admin'", async () => {
    vi.resetModules();
    const query = vi.fn().mockResolvedValue({ rows: [] });
    vi.doMock("@/lib/db", () => ({ default: { query } }));
    vi.doMock("@/lib/data-schema", () => ({ ensureDataSchema: vi.fn() }));
    vi.doUnmock("@/lib/users");
    process.env.ADMIN_EMAIL = "attacker-chosen@example.com";
    const users = await import("@/lib/users");
    await users.ensureSchema();
    const sql = query.mock.calls.map((c) => String(c[0]));
    expect(sql.length).toBeGreaterThan(0);
    expect(sql.some((s) => /status\s*=\s*'admin'/i.test(s) && /UPDATE\s+hub_users/i.test(s))).toBe(false);
    // Duplicate identities: one account per case-folded email ("Mike@…" cannot be a second row).
    expect(sql.some((s) => /CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_users_email_lower[\s\S]*\(email_lower\)/i.test(s))).toBe(true);
    delete process.env.ADMIN_EMAIL;
  });
});
