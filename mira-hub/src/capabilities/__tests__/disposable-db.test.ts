/**
 * #6030 F13 — zero-DB regressions for the integration fixture's preflight and teardown.
 * Default-CI tests: no database is contacted; every pool is a spy.
 */
import { describe, expect, it, vi } from "vitest";
import { Client as PgClient } from "pg";

// @types/pg does not declare connectionParameters; it is the driver's own effective, parsed connection settings.
type Effective = { host: string; port: number; database: string; options?: string };
const Client = PgClient as unknown as new (cfg: object) => { connectionParameters: Effective };
import { DisposableTargetRejected, createIsolatedFixture, validateDisposableTarget, type PoolFactory, type PoolLike, type SanitizedPgConfig } from "./disposable-db";

const OK_ENV = { MIRA_TEST_DB_CONFIRM: "DISPOSABLE", TEST_DATABASE_URL: "postgresql://u:p@127.0.0.1:55626/mira_manual_context_test_20261126" };

function spyFactory() {
  const queries: string[] = [];
  const pools: Array<PoolLike & { ended: boolean; config: SanitizedPgConfig }> = [];
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
  ["?host= override to a remote host", { ...OK_ENV, TEST_DATABASE_URL: `${OK_ENV.TEST_DATABASE_URL}?host=example.invalid` }],
  ["?options= overriding the owned search_path", { ...OK_ENV, TEST_DATABASE_URL: `${OK_ENV.TEST_DATABASE_URL}?options=-c%20search_path%3Dpublic` }],
  ["?hostaddr= override", { ...OK_ENV, TEST_DATABASE_URL: `${OK_ENV.TEST_DATABASE_URL}?hostaddr=10.0.0.9` }],
  ["?dbname= override", { ...OK_ENV, TEST_DATABASE_URL: `${OK_ENV.TEST_DATABASE_URL}?dbname=prod_main` }],
  ["?database= override", { ...OK_ENV, TEST_DATABASE_URL: `${OK_ENV.TEST_DATABASE_URL}?database=main` }],
  ["?service= name", { ...OK_ENV, TEST_DATABASE_URL: `${OK_ENV.TEST_DATABASE_URL}?service=shared` }],
  ["?sslmode= (any query at all)", { ...OK_ENV, TEST_DATABASE_URL: `${OK_ENV.TEST_DATABASE_URL}?sslmode=disable` }],
  ["an empty query marker", { ...OK_ENV, TEST_DATABASE_URL: `${OK_ENV.TEST_DATABASE_URL}?` }],
  ["percent-encoded query key (%68ost=)", { ...OK_ENV, TEST_DATABASE_URL: `${OK_ENV.TEST_DATABASE_URL}?%68ost=example.invalid` }],
  ["fragment", { ...OK_ENV, TEST_DATABASE_URL: `${OK_ENV.TEST_DATABASE_URL}#host=example.invalid` }],
  ["extra path segment", { ...OK_ENV, TEST_DATABASE_URL: `${OK_ENV.TEST_DATABASE_URL}/extra` }],
  ["percent-encoded database name", { ...OK_ENV, TEST_DATABASE_URL: "postgresql://u@127.0.0.1:55626/mira_%74est" }],
  ["malformed percent-encoded database name (no URIError)", { ...OK_ENV, TEST_DATABASE_URL: "postgresql://u@127.0.0.1:55626/mira_test_%E0%A4%A" }],
  ["malformed percent-encoded credentials", { ...OK_ENV, TEST_DATABASE_URL: "postgresql://%E0%A4%A@127.0.0.1:55626/mira_test" }],
  ["encoded-dot host trick", { ...OK_ENV, TEST_DATABASE_URL: "postgresql://u@127.0.0.1%2eevil.example:55626/mira_test" }],
  ["userinfo host trick (host is example.invalid)", { ...OK_ENV, TEST_DATABASE_URL: "postgresql://127.0.0.1@example.invalid:55626/mira_test" }],
  ["port out of range", { ...OK_ENV, TEST_DATABASE_URL: "postgresql://u@127.0.0.1:99999/mira_test" }],
  ["database name that looks like staging", { ...OK_ENV, TEST_DATABASE_URL: "postgresql://u:p@127.0.0.1:55626/staging_test" }],
];

describe("validateDisposableTarget", () => {
  it.each(REJECTED_ENVS)("rejects: %s", (_n, env) => {
    expect(validateDisposableTarget(env).ok).toBe(false);
  });
  it("accepts the owned canonical loopback test database, with and without credentials, and sanitises it", () => {
    expect(validateDisposableTarget(OK_ENV)).toEqual({ ok: true, host: "127.0.0.1", port: 55626, user: "u", password: "p", database: "mira_manual_context_test_20261126" });
    expect(validateDisposableTarget({ ...OK_ENV, TEST_DATABASE_URL: "postgresql://mira_task_admin@127.0.0.1:55626/mira_manual_context_test_20261126" })).toMatchObject({ ok: true, user: "mira_task_admin", password: "", port: 55626 });
    expect(validateDisposableTarget({ ...OK_ENV, TEST_DATABASE_URL: "postgres://u:p%40ss@[::1]:5433/itest_db" })).toMatchObject({ ok: true, host: "::1", password: "p@ss", port: 5433 });
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
    expect(pools[0].config).toMatchObject({ host: "127.0.0.1", port: 55626, database: "mira_manual_context_test_20261126", options: "-c search_path=pg_catalog" });
    expect(pools[1].config.options).toBe("-c search_path=itest_refpages_abc12345,public");
    // both pools are built from the same sanitised fields, never from a connection string the driver re-parses
    for (const p of pools) expect(p.config).not.toHaveProperty("connectionString");
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


describe("the driver's EFFECTIVE connection equals what was validated (installed pg, no connection is made)", () => {
  const effective = (cfg: SanitizedPgConfig): Effective => new Client(cfg).connectionParameters;

  it("the sanitised config for the canonical target yields exactly that host/port/database and the owned search_path", async () => {
    const { factory, pools } = spyFactory();
    const fixture = createIsolatedFixture({ env: OK_ENV, poolFactory: factory, seed: async () => undefined, randomSuffix: () => "feed1234" });
    await fixture.setup();
    for (const pool of pools) {
      const cp = effective(pool.config);
      expect([cp.host, cp.port, cp.database]).toEqual(["127.0.0.1", 55626, "mira_manual_context_test_20261126"]);
    }
    expect(effective(pools[1].config).options).toBe("-c search_path=itest_refpages_feed1234,public");
    await fixture.teardown();
  });

  it("the two root-reproduced overrides, applied to a connection STRING, DO change the effective host/options: that is why strings are rejected", () => {
    const host = new Client({ connectionString: `${OK_ENV.TEST_DATABASE_URL}?host=example.invalid`, options: "-c search_path=itest_owned,public" }).connectionParameters;
    expect(host.host).toBe("example.invalid");
    const opts = new Client({ connectionString: `${OK_ENV.TEST_DATABASE_URL}?options=-c%20search_path%3Dpublic`, options: "-c search_path=itest_owned,public" }).connectionParameters;
    expect(opts.options).toBe("-c search_path=public");
    // ...and the validator refuses both before any pool exists
    expect(validateDisposableTarget({ ...OK_ENV, TEST_DATABASE_URL: `${OK_ENV.TEST_DATABASE_URL}?host=example.invalid` }).ok).toBe(false);
    expect(validateDisposableTarget({ ...OK_ENV, TEST_DATABASE_URL: `${OK_ENV.TEST_DATABASE_URL}?options=-c%20search_path%3Dpublic` }).ok).toBe(false);
  });

  it("the environment cannot steer a sanitised config (PGHOST/PGDATABASE/PGOPTIONS/PGPORT set to hostile values)", async () => {
    const saved = { ...process.env };
    process.env.PGHOST = "example.invalid";
    process.env.PGDATABASE = "main";
    process.env.PGPORT = "1";
    process.env.PGOPTIONS = "-c search_path=public";
    try {
      const { factory, pools } = spyFactory();
      const fixture = createIsolatedFixture({ env: OK_ENV, poolFactory: factory, seed: async () => undefined, randomSuffix: () => "c0ffee11" });
      await fixture.setup();
      for (const pool of pools) {
        const cp = effective(pool.config);
        expect([cp.host, cp.port, cp.database]).toEqual(["127.0.0.1", 55626, "mira_manual_context_test_20261126"]);
        expect(cp.options).toMatch(/^-c search_path=(pg_catalog|itest_refpages_c0ffee11,public)$/);
      }
      await fixture.teardown();
    } finally {
      process.env = saved;
    }
  });
});
