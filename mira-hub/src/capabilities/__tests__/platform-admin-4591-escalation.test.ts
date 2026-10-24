// #4591 regression battery: unverified (self-registered) accounts, impersonation, duplicate/variant
// identities and privilege escalation. Platform admin = hub_users.status 'admin', read fresh per
// request; nothing a registrant controls (email, JWT claims, request body) may grant it.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next-auth/jwt", () => ({ decode: vi.fn() }));

const db = vi.hoisted(() => ({ calls: [] as { sql: string; params: unknown[] }[] }));
vi.mock("@/lib/db", () => {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    db.calls.push({ sql, params });
    if (/INSERT INTO hub_tenants/i.test(sql)) return { rows: [{ id: "t-new" }] };
    if (/INSERT INTO hub_users/i.test(sql)) return { rows: [{ id: "u-new", email: params[0], tenant_id: params[3] ?? "t" }] };
    return { rows: [] };
  });
  return { default: { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } };
});
vi.mock("@/lib/data-schema", () => ({ ensureDataSchema: vi.fn() }));
const um = vi.hoisted(() => ({ findUserById: vi.fn(), updateUserStatus: vi.fn() }));
vi.mock("@/lib/users", async (orig) => ({ ...(await orig<typeof import("@/lib/users")>()), ...um }));

import { cookies } from "next/headers";
import { decode } from "next-auth/jwt";
import * as users from "@/lib/users";
import { requireSession, UnauthorizedError, type SessionContext } from "@/lib/session";
import { getCapabilities } from "@/lib/capabilities";
import { PATCH as patchUserStatus } from "@/app/(hub)/api/admin/users/[id]/route";

const TID = "11111111-2222-4333-8444-555555555555";
const PLATFORM = ["review_queue.read", "review_queue.decide", "platform.users.read"] as const;
const noPlatform = (ctx: SessionContext) => {
  const caps = getCapabilities(ctx);
  for (const c of PLATFORM) expect(caps).not.toContain(c);
};

beforeEach(() => {
  db.calls.length = 0;
  um.findUserById.mockReset();
  um.updateUserStatus.mockReset();
  vi.mocked(cookies).mockResolvedValue({ get: (n: string) => (n === "__Secure-next-auth.session-token" ? { value: "jwt" } : undefined) } as never);
});

describe("unverified, self-registered accounts (#4591)", () => {
  it("registering an allowlisted address creates a 'trial' row — never 'admin' — and nothing promotes it", async () => {
    await users.ensureUserAndTenant({ email: "harperhousebuyers@gmail.com", passwordHash: "x" });
    const inserts = db.calls.filter((c) => /INSERT INTO hub_users/i.test(c.sql));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toMatch(/'trial'/);
    expect(db.calls.some((c) => /status\s*=\s*'admin'/i.test(c.sql) || c.params.includes("admin"))).toBe(false);
  });

  it("that self-registered account, signed in, holds no platform capability", async () => {
    vi.mocked(decode).mockResolvedValue({ uid: "u-new", tid: TID, email: "harperhousebuyers@gmail.com", status: "trial" } as never);
    um.findUserById.mockResolvedValue({ role: "owner", status: "trial" } as never);
    noPlatform(await requireSession());
  });
});

describe("impersonation (#4591)", () => {
  it.each([
    ["JWT claims an allowlisted email and status 'admin'", { email: "mike@factorylm.com", status: "admin" }],
    ["JWT claims status 'admin' with any email", { email: "someone@customer.test", status: "admin" }],
  ])("%s, but the DB row for that uid is not an admin → no platform caps", async (_l, claims) => {
    vi.mocked(decode).mockResolvedValue({ uid: "u-1", tid: TID, ...claims } as never);
    um.findUserById.mockResolvedValue({ role: "owner", status: "approved" } as never);
    const s = await requireSession();
    expect(s.platformAdmin).toBe(false);
    noPlatform(s);
  });

  it("a token for a uid with no DB row (deleted or invented) is unauthorized (#3831)", async () => {
    vi.mocked(decode).mockResolvedValue({ uid: "ghost", tid: TID, email: "mike@cranesync.com", status: "admin" } as never);
    um.findUserById.mockResolvedValue(null);
    await expect(requireSession()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("duplicate and variant identities (#4591)", () => {
  it.each(["Mike@FactoryLM.com", "MIKE@FACTORYLM.COM", " mike@factorylm.com ", "HarperHouseBuyers@Gmail.com"])(
    "%j without the DB flag gets nothing, however the address is cased or padded",
    (email) => {
      noPlatform({ userId: "u", tenantId: TID, email, status: "admin", trialExpiresAt: null, role: "owner", platformAdmin: false });
    },
  );

  it("look-alike addresses never match the review allowlist even WITH the DB flag", () => {
    for (const email of ["mike@factorylm.com.evil.test", "mike+x@factorylm.com", "harperhousebuyers@gmail.co", "xmike@cranesync.com"]) {
      const caps = getCapabilities({ userId: "u", tenantId: TID, email, status: "admin", trialExpiresAt: null, role: "owner", platformAdmin: true });
      expect(caps).not.toContain("review_queue.read");
      expect(caps).toContain("platform.users.read"); // the DB flag itself is the user-admin authority
    }
  });

});

describe("privilege escalation through the status route (#4591)", () => {
  const patch = (status: string) =>
    patchUserStatus(new Request("http://hub.test/hub/api/admin/users/u-target", { method: "PATCH", body: JSON.stringify({ status }) }), {
      params: Promise.resolve({ id: "u-target" }),
    });

  it.each([
    ["allowlisted email, DB status trial", { email: "mike@factorylm.com", status: "trial" }],
    ["tenant owner (role admin) without the DB flag", { email: "owner@customer.test", status: "approved" }],
    ["JWT says status admin, DB says approved", { email: "x@customer.test", status: "admin" }],
  ])("%s cannot set anyone's status to admin (403, no write)", async (_l, claims) => {
    vi.mocked(decode).mockResolvedValue({ uid: "u-attacker", tid: TID, ...claims } as never);
    um.findUserById.mockResolvedValue({ role: "admin", status: claims.status === "admin" ? "approved" : claims.status } as never);
    const spy = um.updateUserStatus;
    const res = await patch("admin");
    expect(res.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it("control: a provisioned platform admin can still change a status", async () => {
    vi.mocked(decode).mockResolvedValue({ uid: "u-admin", tid: TID, email: "ops@factorylm.com", status: "admin" } as never);
    um.findUserById.mockResolvedValue({ role: "owner", status: "admin" } as never);
    const spy = um.updateUserStatus.mockResolvedValue(undefined);
    const res = await patch("approved");
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith("u-target", "approved");
  });
});
