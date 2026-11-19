/**
 * The throwaway-tenant sweep (`scripts/provision-beta-gate.ts --cleanup <tenantId>`) and the audit row
 * it used to leave behind (#5662). The run's own node (step 4, POST /api/namespace/node/) writes one
 * `namespace_versions` row; the table has no foreign key to the tenant, so nothing removed it and the
 * sweep's proof never counted it. Also what keeps the sweep off any tenant it did not provision, and
 * all-or-nothing (#5663 review F2, F3). No database: `pg` is a recording fake, so what PostgreSQL itself
 * does with a transaction is not shown here.
 *
 * Run: npx vitest run src/capabilities/__tests__/provision-beta-gate-cleanup.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queries: Array<{ text: string; values: unknown[] }> = [];
const THROWAWAY = { users: 1, other_users: 0, auth_tenants: 1, tenants: 1, other_tenants: 0 };
const state = {
  left: {} as Record<string, number>,
  missing: [] as string[],
  proofError: null as string | null,
  who: { ...THROWAWAY },
  failDelete: null as { table: string; code: string } | null,
};
/** The check of whose tenant this is, and the count of what is left afterwards. */
const isWho = (text: string) => /AS other_users/.test(text);
const isProof = (text: string) => /^SELECT \(SELECT count/.test(text) && !isWho(text);
vi.mock("pg", () => ({
  Client: class {
    async connect() {}
    async query(text: string, values: unknown[] = []) {
      queries.push({ text, values });
      const table = /^DELETE FROM (\w+)/.exec(text)?.[1];
      if (table && state.missing.includes(table)) throw Object.assign(new Error(`relation "${table}" does not exist`), { code: "42P01" });
      if (table && state.failDelete?.table === table) throw Object.assign(new Error("delete failed"), { code: state.failDelete.code });
      if (isWho(text)) return { rows: [{ ...state.who }] };
      if (isProof(text)) {
        const audit = /FROM namespace_versions/.test(text);
        // The whole statement fails when a table it names is not there, as PostgreSQL does.
        if (audit && state.missing.includes("namespace_versions")) throw Object.assign(new Error('relation "namespace_versions" does not exist'), { code: "42P01" });
        if (state.proofError) throw Object.assign(new Error("proof failed"), { code: state.proofError });
        return { rows: [{ users: 0, auth_tenants: 0, tenants: 0, ...(audit ? { namespace_versions: 0 } : {}), ...state.left }] };
      }
      return { rows: [], rowCount: 0 };
    }
    async end() {}
  },
}));

const TENANT = "9ae14764-fdab-4167-ba79-2659c5fcc200";
// One spy for the file: a second one on the same method would leave the first with no calls.
const err = vi.spyOn(console, "error").mockImplementation(() => {});

describe("the throwaway-tenant sweep leaves no namespace audit row behind (#5662)", () => {
  beforeEach(() => {
    queries.length = 0;
    state.left = {};
    state.missing = [];
    state.proofError = null;
    state.who = { ...THROWAWAY };
    state.failDelete = null;
    err.mockClear();
  });
  afterEach(() => {
    vi.resetModules();
  });
  const sweep = async () => (await import("../../../scripts/provision-beta-gate")).cleanup(TENANT);
  const deletes = () => queries.filter((q) => /^DELETE FROM/.test(q.text));

  it("deletes the tenant's namespace_versions rows, before the tenant row itself goes", async () => {
    await sweep();
    const audit = deletes().findIndex((q) => q.text === "DELETE FROM namespace_versions WHERE tenant_id::text = $1");
    expect(audit).toBeGreaterThanOrEqual(0);
    expect(audit).toBeLessThan(deletes().findIndex((q) => q.text === "DELETE FROM tenants WHERE id = $1"));
  });

  it("every delete of the sweep is bound to that one tenant and to nothing else", async () => {
    await sweep();
    expect(deletes().length).toBeGreaterThanOrEqual(13);
    for (const q of deletes()) {
      expect(q.text).toMatch(/^DELETE FROM \w+ WHERE (?:tenant_id::text|tenant_id|id) = \$1$/);
      expect(q.values).toEqual([TENANT]);
    }
  });

  it("the proof counts the audit rows that are left, for that tenant", async () => {
    await sweep();
    const proof = queries.filter((q) => isProof(q.text));
    expect(proof).toHaveLength(1);
    expect(proof[0].text).toMatch(/\(SELECT count\(\*\) FROM namespace_versions WHERE tenant_id::text = \$1\)::int AS namespace_versions/);
    expect(proof[0].values).toEqual([TENANT]);
    expect(err.mock.calls.map((c) => c.join(" ")).join("\n")).toMatch(/verified gone/);
  });

  it.each([["namespace_versions"], ["users"], ["auth_tenants"], ["tenants"]])("a %s row still there after the sweep fails the cleanup instead of passing it", async (kind) => {
    state.left = { [kind]: 1 };
    await expect(sweep()).rejects.toThrow(/cleanup incomplete/);
    expect(err.mock.calls.map((c) => c.join(" ")).join("\n")).not.toMatch(/verified gone/);
  });

  it("a database with no audit table at all: the delete is skipped and the other three are still counted", async () => {
    state.missing = ["namespace_versions"];
    await sweep();
    const proof = queries.filter((q) => isProof(q.text));
    expect(proof).toHaveLength(2);
    expect(proof[1].text).not.toMatch(/namespace_versions/);
    expect(proof[1].text).toMatch(/FROM hub_users[\s\S]*FROM hub_tenants[\s\S]*FROM tenants/);
    expect(err.mock.calls.map((c) => c.join(" ")).join("\n")).toMatch(/verified gone/);
  });

  it("a database with no audit table still fails the cleanup for a user, auth tenant or tenant row left behind", async () => {
    state.missing = ["namespace_versions"];
    state.left = { tenants: 1 };
    await expect(sweep()).rejects.toThrow(/cleanup incomplete/);
  });

  it.each([["42501"], ["57014"], ["08006"]])("a count that fails for any other reason (%s) is never read as zero rows", async (code) => {
    state.proofError = code;
    await expect(sweep()).rejects.toMatchObject({ code });
    expect(queries.filter((q) => isProof(q.text))).toHaveLength(1);
    expect(err.mock.calls.map((c) => c.join(" ")).join("\n")).not.toMatch(/verified gone/);
  });

  it("control: a table that does not exist on an older branch is still skipped, and the rest is swept", async () => {
    state.missing = ["turn_ingress"];
    await sweep();
    expect(deletes().some((q) => /^DELETE FROM namespace_versions /.test(q.text))).toBe(true);
    expect(deletes().some((q) => /^DELETE FROM hub_tenants /.test(q.text))).toBe(true);
  });
});

describe("the sweep only ever touches a tenant this script provisioned, and all of it or none (#5663 review F2, F3)", () => {
  beforeEach(() => {
    queries.length = 0;
    state.left = {};
    state.missing = [];
    state.proofError = null;
    state.who = { ...THROWAWAY };
    state.failDelete = null;
    err.mockClear();
  });
  afterEach(() => {
    vi.resetModules();
  });
  const sweep = async (id: string = TENANT) => (await import("../../../scripts/provision-beta-gate")).cleanup(id);
  const deletes = () => queries.filter((q) => /^DELETE FROM/.test(q.text));
  const texts = () => queries.map((q) => q.text);
  const logged = () => err.mock.calls.map((c) => c.join(" ")).join("\n");

  it("asks whose tenant it is before the first delete, inside the transaction, with this script's own address", async () => {
    await sweep();
    const t = texts();
    expect(t[0]).toBe("BEGIN");
    const who = t.findIndex(isWho);
    expect(who).toBe(1);
    expect(who).toBeLessThan(t.findIndex((x) => /^DELETE FROM/.test(x)));
    expect(queries[who].values).toEqual([TENANT, "^betagate-[0-9]+@factorylm\\.com$"]);
    const address = new RegExp(queries[who].values[1] as string);
    expect(address.test("betagate-1795101515086@factorylm.com")).toBe(true);
    for (const real of ["mike@factorylm.com", "betagate-1@factorylm.com.evil.example", "xbetagate-1@factorylm.com", "betagate-@factorylm.com", "betagate-1@factorylmxcom"]) {
      expect(address.test(real)).toBe(false);
    }
  });

  it.each([
    ["a user with any other address", { other_users: 1 }],
    ["a second user with another address beside the throwaway one", { users: 2, other_users: 1 }],
    ["a data-side tenant row with another contact address", { other_tenants: 1 }],
    ["only an auth tenant row, with no user and no data-side row to say whose it is", { users: 0, tenants: 0 }],
  ])("a tenant with %s is refused and nothing is deleted", async (_what, who) => {
    state.who = { ...THROWAWAY, ...who };
    await expect(sweep()).rejects.toThrow(/not a tenant this script provisioned \(nothing was deleted\)/);
    expect(deletes()).toHaveLength(0);
    expect(texts()).toContain("ROLLBACK");
    expect(texts()).not.toContain("COMMIT");
    expect(queries.filter((q) => isProof(q.text))).toHaveLength(0);
    expect(logged()).not.toMatch(/verified gone/);
  });

  it("an id nobody is registered under deletes nothing and says so, without failing", async () => {
    state.who = { users: 0, other_users: 0, auth_tenants: 0, tenants: 0, other_tenants: 0 };
    await expect(sweep()).resolves.toBeUndefined();
    expect(deletes()).toHaveLength(0);
    expect(texts()).not.toContain("COMMIT");
    expect(logged()).toMatch(/nothing to clean, nothing deleted/);
    expect(logged()).not.toMatch(/verified gone/);
  });

  it("the run's own self-clean sweeps the tenant it just registered even where no row is found under the id", async () => {
    state.who = { users: 0, other_users: 0, auth_tenants: 0, tenants: 0, other_tenants: 0 };
    const fetched = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/api/auth/register/")
        ? new Response(JSON.stringify({ ok: true, tenantId: TENANT }), { status: 201 })
        : new Response("{}", { status: 404 }),
    );
    vi.stubGlobal("fetch", fetched as unknown as typeof fetch);
    process.env.BETA_GATE_FAIL_AFTER = "mirror";
    try {
      await expect((await import("../../../scripts/provision-beta-gate")).main()).rejects.toThrow(/forced failure after mirror/);
    } finally {
      delete process.env.BETA_GATE_FAIL_AFTER;
      vi.unstubAllGlobals();
    }
    expect(texts().findIndex(isWho)).toBeLessThan(texts().findIndex((x) => /^DELETE FROM/.test(x)));
    expect(deletes().some((q) => /^DELETE FROM hub_tenants /.test(q.text))).toBe(true);
    expect(texts()).toContain("COMMIT");
  });

  it.each([
    ["a user with another address", { users: 1, other_users: 1 }],
    ["a data-side tenant row with another contact address", { tenants: 1, other_tenants: 1 }],
  ])("the run's own self-clean still refuses an id that holds %s", async (_what, who) => {
    state.who = { users: 0, other_users: 0, auth_tenants: 1, tenants: 0, other_tenants: 0, ...who };
    const fetched = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/api/auth/register/")
        ? new Response(JSON.stringify({ ok: true, tenantId: TENANT }), { status: 201 })
        : new Response("{}", { status: 404 }),
    );
    vi.stubGlobal("fetch", fetched as unknown as typeof fetch);
    process.env.BETA_GATE_FAIL_AFTER = "mirror";
    let caught: unknown;
    try {
      await (await import("../../../scripts/provision-beta-gate")).main();
    } catch (e) {
      caught = e;
    } finally {
      delete process.env.BETA_GATE_FAIL_AFTER;
      vi.unstubAllGlobals();
    }
    expect(caught).toBeInstanceOf(AggregateError);
    expect(String((caught as AggregateError).errors[1])).toMatch(/not a tenant this script provisioned/);
    expect(deletes()).toHaveLength(0);
  });

  it("a throwaway tenant whose user rows are already gone is still swept, on its data-side row", async () => {
    state.who = { users: 0, other_users: 0, auth_tenants: 1, tenants: 1, other_tenants: 0 };
    await sweep();
    expect(deletes().some((q) => /^DELETE FROM hub_tenants /.test(q.text))).toBe(true);
    expect(texts()).toContain("COMMIT");
  });

  it("the whole sweep is one transaction: BEGIN first, COMMIT after the last delete, the count on its own afterwards", async () => {
    await sweep();
    const t = texts();
    const lastDelete = t.map((x) => /^DELETE FROM/.test(x)).lastIndexOf(true);
    expect(t.filter((x) => x === "BEGIN")).toHaveLength(1);
    expect(t.filter((x) => x === "COMMIT")).toHaveLength(1);
    expect(t.indexOf("COMMIT")).toBe(lastDelete + 1);
    expect(t.findIndex(isProof)).toBeGreaterThan(t.indexOf("COMMIT"));
    expect(t).not.toContain("ROLLBACK");
  });

  it.each([["tenants", "23503"], ["hub_users", "57014"], ["kg_entities", "40001"], ["namespace_versions", "42501"]])(
    "a delete from %s that fails (%s) undoes the whole sweep: no commit, no count, no success line",
    async (table, code) => {
      state.failDelete = { table, code };
      await expect(sweep()).rejects.toMatchObject({ code });
      const t = texts();
      expect(t).not.toContain("COMMIT");
      expect(t[t.length - 1]).toBe("ROLLBACK");
      expect(queries.filter((q) => isProof(q.text))).toHaveLength(0);
      expect(logged()).not.toMatch(/verified gone/);
    },
  );

  it("a table that is not there is undone to its savepoint, so the transaction lives and the sweep commits", async () => {
    state.missing = ["turn_ingress"];
    await sweep();
    const t = texts();
    const failed = t.indexOf("DELETE FROM turn_ingress WHERE tenant_id::text = $1");
    expect(t[failed - 1]).toBe("SAVEPOINT sweep_table");
    expect(t[failed + 1]).toBe("ROLLBACK TO SAVEPOINT sweep_table");
    expect(t[failed + 2]).toBe("RELEASE SAVEPOINT sweep_table");
    expect(t).toContain("COMMIT");
    expect(t).not.toContain("ROLLBACK");
  });

  it("an upper-case id is the same tenant: every statement is bound to the one lower-case spelling", async () => {
    await sweep(`  ${TENANT.toUpperCase()} `);
    expect(deletes().length).toBeGreaterThanOrEqual(13);
    for (const q of queries.filter((x) => x.values.length)) expect(q.values[0]).toBe(TENANT);
    expect(logged()).toMatch(new RegExp(`cleaned tenant ${TENANT} `));
  });

  it.each([["mike"], ["9ae14764-fdab-4167-ba79-2659c5fcc20"], ["9ae14764fdab4167ba792659c5fcc200"], [`${TENANT}' OR '1'='1`], ["%"], ["   "]])(
    "%j is not a tenant id: refused before the database is asked anything",
    async (id) => {
      await expect(sweep(id)).rejects.toThrow(/tenant id/);
      expect(queries).toHaveLength(0);
    },
  );
});
