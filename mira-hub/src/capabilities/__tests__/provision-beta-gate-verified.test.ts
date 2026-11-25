// Provisioner contract when /api/auth/register refuses unverified accounts
// (403 verified_onboarding_required: pilot review or free signup on). The
// password-register contract lives in src/lib/__tests__/provision-beta-gate.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queries: Array<{ text: string; values: unknown[] }> = [];
const state = {
  failCleanup: false,
  // Verified-setup mode: register answers 403 verified_onboarding_required.
  verified: false,
  openKind: { technician: "trial", pilot: "trial" } as Record<"technician" | "pilot", string>,
  accountExists: true,
  // The setup callback refuses (e.g. the address already holds another run's account).
  redeemRefused: false,
  // An account under the same email that predates this run (another run's).
  priorAccount: false,
  // Receipt reads that fail before one succeeds (a transient database error).
  receiptReadFailures: 0,
};
const calls: Array<{ url: string; body: string }> = [];
vi.mock("pg", () => ({
  Client: class {
    async connect() {}
    async query(text: string, values: unknown[] = []) {
      queries.push({ text, values });
      if (state.failCleanup && /^DELETE FROM hub_tenants/.test(text)) {
        throw new Error("simulated sweep failure (hub_tenants)");
      }
      if (/^SELECT \(SELECT count/.test(text)) {
        return { rows: [{ users: 0, auth_tenants: 0, tenants: 0 }] };
      }
      if (/onboarding->>'createdTenantId'/.test(text) && state.receiptReadFailures > 0) {
        state.receiptReadFailures -= 1;
        throw new Error("simulated transient receipt read failure");
      }
      if (/^SELECT used_at, onboarding->>'createdTenantId'/.test(text)) {
        // The locked recovery read: a refused setup leaves the token unused.
        return { rows: [{ used_at: state.redeemRefused ? null : "2026-11-21", tenant_id: state.accountExists ? TENANT : null }] };
      }
      if (/^SELECT onboarding->>'createdTenantId'/.test(text)) {
        // Models the real receipt: only a token whose redemption CREATED the
        // workspace carries it. A prior account under the address never does.
        return { rows: state.accountExists ? [{ tenant_id: TENANT }] : [] };
      }
      return { rows: [], rowCount: 0 };
    }
    async end() {}
  },
}));

const TENANT = "9ae14764-fdab-4167-ba79-2659c5fcc200";
// One spy pair for the whole file: a second spyOn would capture the calls instead.
const log = vi.spyOn(console, "log").mockImplementation(() => {});
const err = vi.spyOn(console, "error").mockImplementation(() => {});

function fetchMock(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? "") });
    if (url.endsWith("/api/auth/register/")) {
      if (state.verified) {
        return new Response(JSON.stringify({ code: "verified_onboarding_required", signupUrl: "/signup/" }), {
          status: 403,
        });
      }
      return new Response(JSON.stringify({ ok: true, tenantId: TENANT }), { status: 201 });
    }
    if (url.includes("/api/public/signup-policy/")) {
      const intent = url.includes("intent=pilot") ? "pilot" : "technician";
      return new Response(JSON.stringify({ kind: state.openKind[intent], agreementVersion: "agree-v1" }), {
        status: 200,
      });
    }
    if (url.endsWith("/api/auth/callback/magic-token/")) {
      if (state.redeemRefused) return new Response("", { status: 401 });
      return new Response("", { status: 200, headers: { "set-cookie": "next-auth.session-token=MINTED; Path=/" } });
    }
    if (url.endsWith("/api/auth/csrf/")) {
      return new Response(JSON.stringify({ csrfToken: "c" }), {
        status: 200,
        headers: { "set-cookie": "next-auth.csrf-token=x" },
      });
    }
    if (url.endsWith("/api/auth/callback/credentials/")) {
      return new Response("", { status: 200, headers: { "set-cookie": "next-auth.session-token=MINTED; Path=/" } });
    }
    if (url.endsWith("/api/namespace/node/")) {
      return new Response(JSON.stringify({ node: { id: "node-1" } }), { status: 201 });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("provision-beta-gate when register requires verified setup", () => {
  const savedEnv = { ...process.env };
  const tokenInserts = () => queries.filter((q) => /^INSERT INTO hub_magic_tokens/.test(q.text));
  const printedAll = () =>
    log.mock.calls.map((c) => c.join(" ")).join("\n") + "\n" + err.mock.calls.map((c) => c.join(" ")).join("\n");

  beforeEach(() => {
    queries.length = 0;
    calls.length = 0;
    state.failCleanup = false;
    state.verified = true;
    state.openKind = { technician: "pilot_application", pilot: "pilot_application" };
    state.accountExists = true;
    state.redeemRefused = false;
    state.priorAccount = false;
    state.receiptReadFailures = 0;
    log.mockClear();
    err.mockClear();
    vi.stubGlobal("fetch", fetchMock());
    process.env.NEON_DATABASE_URL = "postgres://x";
    delete process.env.BETA_GATE_FAIL_AFTER;
  });
  afterEach(() => {
    process.env = { ...savedEnv };
    vi.unstubAllGlobals();
  });

  it("pilot review on (staging/prod today): onboards as 'pilot', un-pends, then signs in with a fresh login token", async () => {
    const mod = await import("../../../scripts/provision-beta-gate");
    await mod.main();
    const [onboard, login] = tokenInserts();
    expect(onboard.values[2]).toBe("onboarding");
    expect(JSON.parse(String(onboard.values[3]))).toEqual({ intent: "pilot", agreementVersion: "agree-v1" });
    expect(login.values[2]).toBe("login");
    expect(login.values[3]).toBeNull();
    // The session that reaches the gate is minted AFTER the un-pend (status rides in the JWT).
    const unpend = queries.findIndex((q) => /^UPDATE hub_users SET status = 'trial'/.test(q.text));
    expect(unpend).toBeGreaterThan(queries.indexOf(onboard));
    expect(queries.indexOf(login)).toBeGreaterThan(unpend);
    const magic = calls.filter((c) => c.url.endsWith("/api/auth/callback/magic-token/"));
    expect(magic).toHaveLength(2);
    expect(magic[0].body).toContain("agreementVersion=agree-v1");
    expect(calls.some((c) => c.url.endsWith("/api/auth/callback/credentials/"))).toBe(false);
    // Never asks the server to email anyone.
    expect(calls.some((c) => /magic-link/.test(c.url))).toBe(false);
    expect(log.mock.calls.map((c) => c.join(" ")).join("\n")).toMatch(/^ENV:BETA_GATE_TENANT=9ae14764/m);
    // Seeded tokens are bearer credentials: never printed.
    for (const t of tokenInserts()) expect(printedAll()).not.toContain(String(t.values[0]));
  });

  it("free technician signup on: onboards as 'technician'", async () => {
    state.openKind = { technician: "free_technician", pilot: "pilot_application" };
    const mod = await import("../../../scripts/provision-beta-gate");
    await mod.main();
    expect(JSON.parse(String(tokenInserts()[0].values[3]))).toMatchObject({ intent: "technician" });
  });

  it("no verified signup open: fails loudly, seeds nothing, emits no ENV lines", async () => {
    state.openKind = { technician: "trial", pilot: "trial" };
    const mod = await import("../../../scripts/provision-beta-gate");
    await expect(mod.main()).rejects.toThrow(/no verified signup is open/);
    expect(tokenInserts()).toHaveLength(0);
    expect(log.mock.calls.map((c) => c.join(" ")).join("\n")).not.toMatch(/^ENV:/m);
  });

  it("redeem created no account: removes exactly this run's seeded token and fails", async () => {
    state.accountExists = false;
    const mod = await import("../../../scripts/provision-beta-gate");
    await expect(mod.main()).rejects.toThrow(/verified setup created no account for this run/);
    const del = queries.filter((q) => /^DELETE FROM hub_magic_tokens/.test(q.text));
    expect(del).toHaveLength(1);
    expect(del[0].text).toMatch(/WHERE token = \$1/);
    expect(del[0].values[0]).toBe(tokenInserts()[0].values[0]);
    expect(log.mock.calls.map((c) => c.join(" ")).join("\n")).not.toMatch(/^ENV:/m);
  });

  it("F39: an unreadable receipt keeps the seeded token and reports, never deletes", async () => {
    state.receiptReadFailures = 99;
    const mod = await import("../../../scripts/provision-beta-gate");
    await expect(mod.main()).rejects.toThrow(/creation receipt could not be read; the seeded token was kept/);
    expect(queries.some((q) => /^DELETE FROM/.test(q.text))).toBe(false);
  });

  it("F39: a receipt that reads on retry lets the committed fixture be swept", async () => {
    state.receiptReadFailures = 1;
    const mod = await import("../../../scripts/provision-beta-gate");
    await expect(mod.main()).rejects.toThrow(/simulated transient receipt read failure/);
    const swept = queries.filter((q) => /^DELETE FROM hub_tenants/.test(q.text));
    expect(swept.map((q) => q.values[0])).toEqual([TENANT]);
  });

  it("F32: a refused setup never deletes an account this run did not create", async () => {
    // Another run's account already holds the address: this run's own token
    // carries no creation receipt, so nothing is attributable to it.
    state.redeemRefused = true;
    state.accountExists = false;
    state.priorAccount = true;
    const mod = await import("../../../scripts/provision-beta-gate");
    await expect(mod.main()).rejects.toThrow(/no session cookie/);
    const lookups = queries.filter((q) => /createdTenantId/.test(q.text));
    expect(lookups.length).toBeGreaterThan(0);
    for (const q of lookups) {
      expect(q.text).toMatch(/FROM hub_magic_tokens WHERE token = \$1( AND used_at IS NOT NULL| FOR UPDATE)/);
      expect(q.values).toEqual([tokenInserts()[0].values[0]]);
    }
    expect(queries.some((q) => /FROM hub_users/.test(q.text) && /email/i.test(q.text))).toBe(false);
    expect(queries.some((q) => /^DELETE FROM (hub_tenants|hub_users|tenants)\b/.test(q.text))).toBe(false);
    const del = queries.filter((q) => /^DELETE FROM hub_magic_tokens/.test(q.text));
    expect(del.map((q) => q.values[0])).toEqual([tokenInserts()[0].values[0]]);
  });

  it("F32: each run's fixture email carries a random part", async () => {
    const mod = await import("../../../scripts/provision-beta-gate");
    await mod.main();
    const email = String(tokenInserts()[0].values[1]);
    // 13-digit clock reading + 12 random hex characters (a bare timestamp is 13 chars).
    expect(email).toMatch(/^betagate-\d{13}[0-9a-f]{12}@factorylm\.com$/);
  });

  it("forced failure after signin sweeps the tenant, its tokens before its users", async () => {
    process.env.BETA_GATE_FAIL_AFTER = "signin";
    const mod = await import("../../../scripts/provision-beta-gate");
    await expect(mod.main()).rejects.toThrow(/forced failure after signin/);
    const deletes = queries.filter((q) => /^DELETE FROM/.test(q.text));
    const tokens = deletes.findIndex((q) => /^DELETE FROM hub_magic_tokens/.test(q.text));
    const users = deletes.findIndex((q) => /^DELETE FROM hub_users/.test(q.text));
    expect(tokens).toBeGreaterThanOrEqual(0);
    expect(deletes[tokens].values[0]).toBe(TENANT);
    expect(tokens).toBeLessThan(users);
  });
});
