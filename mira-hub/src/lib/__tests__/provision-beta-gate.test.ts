// Provisioner contract (review round 3, Medium): a run that registers a
// stranger tenant but fails BEFORE it emits BETA_GATE_TENANT would leave rows
// no job could sweep. The provisioner must self-clean on any post-registration
// failure and must never print ENV lines for a run it did not complete.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queries: Array<{ text: string; values: unknown[] }> = [];
const state = { failCleanup: false };
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
      return { rows: [], rowCount: 0 };
    }
    async end() {}
  },
}));

const TENANT = "9ae14764-fdab-4167-ba79-2659c5fcc200";

function fetchMock(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/auth/register/")) {
      return new Response(JSON.stringify({ ok: true, tenantId: TENANT }), { status: 201 });
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

describe("provision-beta-gate self-cleans on post-registration failure", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const savedEnv = { ...process.env };

  beforeEach(() => {
    queries.length = 0;
    state.failCleanup = false;
    log.mockClear();
    err.mockClear();
    vi.stubGlobal("fetch", fetchMock());
    process.env.NEON_DATABASE_URL = "postgres://x";
  });
  afterEach(() => {
    process.env = { ...savedEnv };
    vi.unstubAllGlobals();
  });

  for (const stage of ["mirror", "signin", "node"] as const) {
    it(`forced failure after '${stage}' sweeps the registered tenant and emits no ENV lines`, async () => {
      process.env.BETA_GATE_FAIL_AFTER = stage;
      const mod = await import("../../../scripts/provision-beta-gate");
      await expect(mod.main()).rejects.toThrow(/forced failure after/);
      const deletes = queries.filter((q) => /^DELETE FROM/.test(q.text));
      expect(deletes.some((q) => /hub_users/.test(q.text) && q.values[0] === TENANT)).toBe(true);
      expect(deletes.some((q) => /hub_tenants/.test(q.text) && q.values[0] === TENANT)).toBe(true);
      expect(deletes.some((q) => /FROM tenants WHERE/.test(q.text) && q.values[0] === TENANT)).toBe(true);
      // hub_users (FK → hub_tenants) is deleted BEFORE hub_tenants
      const iu = deletes.findIndex((q) => /hub_users/.test(q.text));
      const it2 = deletes.findIndex((q) => /hub_tenants/.test(q.text));
      expect(iu).toBeLessThan(it2);
      // nothing sourced by the workflow: no ENV: lines, no password anywhere
      const printed = log.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(printed).not.toMatch(/^ENV:/m);
      const everything = printed + err.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(everything).not.toMatch(/!Aa1/);
    });
  }

  it("a FAILED self-clean propagates BOTH failures (AggregateError), never just the original", async () => {
    process.env.BETA_GATE_FAIL_AFTER = "signin";
    state.failCleanup = true;
    const mod = await import("../../../scripts/provision-beta-gate");
    let caught: unknown;
    try {
      await mod.main();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    const agg = caught as AggregateError;
    expect(agg.errors).toHaveLength(2);
    expect(String(agg.errors[0])).toMatch(/forced failure after signin/);
    expect(String(agg.errors[1])).toMatch(/simulated sweep failure/);
    expect(agg.message).toMatch(/self-clean FAILED/);
    const printed = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(printed).not.toMatch(/^ENV:/m);
  });

  it("happy path emits ENV lines and never the password", async () => {
    delete process.env.BETA_GATE_FAIL_AFTER;
    const mod = await import("../../../scripts/provision-beta-gate");
    await mod.main();
    const printed = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(printed).toMatch(/^ENV:BETA_GATE_TENANT=9ae14764/m);
    expect(printed).toMatch(/^ENV:BETA_PROBE_COOKIE=next-auth\.session-token=MINTED/m);
    expect(printed + err.mock.calls.join("\n")).not.toMatch(/!Aa1/);
    expect(queries.some((q) => /^DELETE FROM/.test(q.text))).toBe(false);
  });
});
