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
      if (/^SELECT tenant_id FROM hub_users/.test(text)) {
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

  it("redeem created no account: removes this run's seeded token by email and fails", async () => {
    state.accountExists = false;
    const mod = await import("../../../scripts/provision-beta-gate");
    await expect(mod.main()).rejects.toThrow(/verified setup created no account/);
    const del = queries.find((q) => /^DELETE FROM hub_magic_tokens WHERE LOWER\(email\) = LOWER\(\$1\)/.test(q.text));
    expect(String(del?.values[0])).toMatch(/^betagate-\d+@factorylm\.com$/);
    expect(log.mock.calls.map((c) => c.join(" ")).join("\n")).not.toMatch(/^ENV:/m);
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
