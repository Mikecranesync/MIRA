/**
 * The throwaway-tenant sweep (`scripts/provision-beta-gate.ts --cleanup <tenantId>`) and the audit row
 * it used to leave behind (#5662). The run's own node (step 4, POST /api/namespace/node/) writes one
 * `namespace_versions` row; the table has no foreign key to the tenant, so nothing removed it and the
 * sweep's proof never counted it. No database: `pg` is a recording fake.
 *
 * Run: npx vitest run src/capabilities/__tests__/provision-beta-gate-cleanup.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queries: Array<{ text: string; values: unknown[] }> = [];
const state = { left: {} as Record<string, number>, missing: [] as string[], proofError: null as string | null };
vi.mock("pg", () => ({
  Client: class {
    async connect() {}
    async query(text: string, values: unknown[] = []) {
      queries.push({ text, values });
      const table = /^DELETE FROM (\w+)/.exec(text)?.[1];
      if (table && state.missing.includes(table)) throw Object.assign(new Error(`relation "${table}" does not exist`), { code: "42P01" });
      if (/^SELECT \(SELECT count/.test(text)) {
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

describe("the throwaway-tenant sweep leaves no namespace audit row behind (#5662)", () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  beforeEach(() => {
    queries.length = 0;
    state.left = {};
    state.missing = [];
    state.proofError = null;
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
    const proof = queries.filter((q) => /^SELECT \(SELECT count/.test(q.text));
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
    const proof = queries.filter((q) => /^SELECT \(SELECT count/.test(q.text));
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
    expect(queries.filter((q) => /^SELECT \(SELECT count/.test(q.text))).toHaveLength(1);
    expect(err.mock.calls.map((c) => c.join(" ")).join("\n")).not.toMatch(/verified gone/);
  });

  it("control: a table that does not exist on an older branch is still skipped, and the rest is swept", async () => {
    state.missing = ["turn_ingress"];
    await sweep();
    expect(deletes().some((q) => /^DELETE FROM namespace_versions /.test(q.text))).toBe(true);
    expect(deletes().some((q) => /^DELETE FROM hub_tenants /.test(q.text))).toBe(true);
  });
});
