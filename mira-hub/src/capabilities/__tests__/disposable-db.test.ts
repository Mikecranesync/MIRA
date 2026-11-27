/**
 * #6030 F13 — zero-DB regressions for the integration fixture's preflight and teardown.
 * Default-CI tests: no database is contacted; every pool is a spy.
 */
import { describe, expect, it, vi } from "vitest";
import { DisposableTargetRejected, createIsolatedFixture, validateDisposableTarget, type PoolFactory, type PoolLike } from "./disposable-db";

const OK_ENV = { MIRA_TEST_DB_CONFIRM: "DISPOSABLE", TEST_DATABASE_URL: "postgresql://u:p@127.0.0.1:55626/mira_manual_context_test_20261126" };

function spyFactory() {
  const queries: string[] = [];
  const pools: Array<PoolLike & { ended: boolean; config: { connectionString: string; options?: string } }> = [];
  const factory: PoolFactory = vi.fn((config) => {
    const pool = {
      ended: false,
      config,
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        return {};
      }),
      connect: vi.fn(async () => ({})),
      end: vi.fn(async () => {
        pool.ended = true;
      }),
    };
    pools.push(pool);
    return pool;
  });
  return { factory, queries, pools };
}

const REJECTED_ENVS: Array<[string, Record<string, string | undefined>]> = [
  ["confirmation missing", { TEST_DATABASE_URL: OK_ENV.TEST_DATABASE_URL }],
  ["confirmation wrong", { ...OK_ENV, MIRA_TEST_DB_CONFIRM: "disposable" }],
  ["confirmation empty", { ...OK_ENV, MIRA_TEST_DB_CONFIRM: "" }],
  ["URL missing", { MIRA_TEST_DB_CONFIRM: "DISPOSABLE" }],
  ["URL not a URL", { ...OK_ENV, TEST_DATABASE_URL: "not a url" }],
  ["URL not postgres", { ...OK_ENV, TEST_DATABASE_URL: "http://127.0.0.1:55626/test_db" }],
  ["remote host", { ...OK_ENV, TEST_DATABASE_URL: "postgresql://u:p@db.example.com:5432/mira_test" }],
  ["shared host name that merely contains 127.0.0.1", { ...OK_ENV, TEST_DATABASE_URL: "postgresql://u:p@127.0.0.1.evil.example/mira_test" }],
  ["database name without 'test'", { ...OK_ENV, TEST_DATABASE_URL: "postgresql://u:p@127.0.0.1:55626/mira_main" }],
  ["database name that looks like prod", { ...OK_ENV, TEST_DATABASE_URL: "postgresql://u:p@127.0.0.1:55626/mira_test_prod" }],
  ["database name that looks like staging", { ...OK_ENV, TEST_DATABASE_URL: "postgresql://u:p@127.0.0.1:55626/staging_test" }],
];

describe("validateDisposableTarget", () => {
  it.each(REJECTED_ENVS)("rejects: %s", (_n, env) => {
    expect(validateDisposableTarget(env).ok).toBe(false);
  });
  it("accepts the owned loopback test database", () => {
    expect(validateDisposableTarget(OK_ENV)).toEqual({ ok: true, url: OK_ENV.TEST_DATABASE_URL, database: "mira_manual_context_test_20261126" });
  });
});

describe("a rejected preflight touches nothing", () => {
  it.each(REJECTED_ENVS)("%s: zero pools, zero connections, zero queries, no seed, and teardown is a no-op", async (_n, env) => {
    const { factory, queries, pools } = spyFactory();
    const seed = vi.fn(async () => undefined);
    const fixture = createIsolatedFixture({ env, poolFactory: factory, seed });
    await expect(fixture.setup()).rejects.toBeInstanceOf(DisposableTargetRejected);
    // Vitest runs afterAll even when beforeAll threw: exactly what the real hooks do.
    await fixture.teardown();
    expect(factory).not.toHaveBeenCalled();
    expect(pools).toHaveLength(0);
    expect(queries).toEqual([]);
    expect(seed).not.toHaveBeenCalled();
  });
});

describe("a confirmed setup is isolated from the shared table", () => {
  const sharedTableMutation = /(ALTER|DELETE|UPDATE|INSERT|TRUNCATE|DROP|CREATE POLICY|ENABLE|DISABLE|GRANT)[^;]*\b(public\.)?knowledge_entries\b/i;
  const touchesPublic = (sql: string) => /\bpublic\.knowledge_entries\b/i.test(sql) && !/LIKE public\.knowledge_entries/i.test(sql);

  it("creates an owned schema copy, points the main pool at it, and never mutates public", async () => {
    const { factory, queries, pools } = spyFactory();
    const fixture = createIsolatedFixture({ env: OK_ENV, poolFactory: factory, seed: async () => undefined, randomSuffix: () => "abc12345" });
    const { schema } = await fixture.setup();
    expect(schema).toBe("itest_refpages_abc12345");
    expect(pools[0].config).toEqual({ connectionString: OK_ENV.TEST_DATABASE_URL });
    expect(pools[1].config.options).toBe("-c search_path=itest_refpages_abc12345,public");
    expect(queries.some((q) => /ENABLE ROW LEVEL SECURITY/.test(q))).toBe(true);
    for (const q of queries) {
      expect(touchesPublic(q), q).toBe(false);
      if (sharedTableMutation.test(q)) expect(q, "mutating statements must name the owned schema").toMatch(/itest_refpages_abc12345\.knowledge_entries/);
    }
    await fixture.teardown();
    expect(queries.at(-1)).toBe("DROP SCHEMA IF EXISTS itest_refpages_abc12345 CASCADE");
    expect(pools.every((p) => p.ended)).toBe(true);
  });

  it("a setup that fails after the schema exists drops ONLY the owned schema; RLS on the shared table is never disabled or restored", async () => {
    const { factory, queries, pools } = spyFactory();
    const fixture = createIsolatedFixture({
      env: OK_ENV,
      poolFactory: factory,
      seed: async () => {
        throw new Error("synthetic seed failure");
      },
      randomSuffix: () => "deadbeef",
    });
    await expect(fixture.setup()).rejects.toThrow("synthetic seed failure");
    await fixture.teardown();
    expect(queries.at(-1)).toBe("DROP SCHEMA IF EXISTS itest_refpages_deadbeef CASCADE");
    expect(queries.filter((q) => /DISABLE ROW LEVEL SECURITY/i.test(q))).toEqual([]);
    expect(queries.filter((q) => /^\s*DELETE/i.test(q))).toEqual([]);
    for (const q of queries) expect(touchesPublic(q), q).toBe(false);
    expect(pools.every((p) => p.ended)).toBe(true);
  });

  it("a failure BEFORE the schema exists runs no DROP at all", async () => {
    const queries: string[] = [];
    const factory: PoolFactory = () => ({
      query: async (sql: string) => {
        queries.push(sql);
        throw new Error("synthetic connection failure");
      },
      connect: async () => ({}),
      end: async () => undefined,
    });
    const fixture = createIsolatedFixture({ env: OK_ENV, poolFactory: factory, seed: async () => undefined });
    await expect(fixture.setup()).rejects.toThrow("synthetic connection failure");
    await fixture.teardown();
    expect(queries.filter((q) => /DROP/i.test(q))).toEqual([]);
  });

  it("teardown is idempotent", async () => {
    const { factory, queries } = spyFactory();
    const fixture = createIsolatedFixture({ env: OK_ENV, poolFactory: factory, seed: async () => undefined, randomSuffix: () => "0a0a0a0a" });
    await fixture.setup();
    await fixture.teardown();
    const n = queries.length;
    await fixture.teardown();
    expect(queries).toHaveLength(n);
  });
});
