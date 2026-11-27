/**
 * Safe setup/teardown for integration tests that need a real Postgres (#6030 F13).
 *
 * Rules this module enforces, in order:
 *  1. NOTHING touches a database until the target has been validated: the confirmation variable must be
 *     exactly "DISPOSABLE" and TEST_DATABASE_URL must be a loopback Postgres whose database name says it is
 *     a test database (and does not look like prod/staging). A rejection constructs no pool, opens no
 *     connection and runs no SQL, and teardown then has nothing to do.
 *  2. The fixture lives in an OWNED, randomly named schema holding its own copy of the table structure
 *     (`CREATE TABLE ... LIKE public.knowledge_entries`, a read of the catalog only). Row-level security and
 *     rows are set up on THAT copy; the shared `public.knowledge_entries` is never altered, deleted from or
 *     have its RLS toggled, not even on a failed setup. Production SQL runs unchanged because the test pool's
 *     search_path is `<owned schema>, public`.
 *  3. Teardown is registered state, not a guess: it ends only the pools that were created and drops only the
 *     schema that was created.
 */

export type EnvLike = Record<string, string | undefined>;

/** The subset of pg.Pool the fixture needs; a real Pool satisfies it. */
export interface PoolLike {
  query(sql: string, params?: unknown[]): Promise<unknown>;
  connect(): Promise<unknown>;
  end(): Promise<void>;
}
/**
 * The ONLY connection settings a pool may be built from. They are explicit fields (never a connection string
 * the driver re-parses), so a query key such as ?host= or ?options=, a service name or the environment cannot
 * override what was validated: pg uses a config field whenever it is set, and every field below is always set.
 */
export type SanitizedPgConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** Always set: the owned search_path for the fixture pool, a neutral one for the admin pool. */
  options: string;
};
export type PoolFactory = (config: SanitizedPgConfig) => PoolLike;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export type TargetVerdict =
  | { ok: true; host: string; port: number; user: string; password: string; database: string }
  | { ok: false; reason: string };

const safeDecode = (s: string): string | null => {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
};

/**
 * Pure: decides whether `env` names a disposable local test database, and returns the SANITIZED parts to
 * connect with. Touches nothing. Deliberately strict for a strictly local fixture instead of a DSN framework:
 * no query string, no fragment, a single plain database segment, a loopback host. Anything the driver could
 * interpret differently from this parser (query overrides of host/database/options, service names, encoded or
 * malformed database names) is rejected rather than reconciled.
 */
export function validateDisposableTarget(env: EnvLike): TargetVerdict {
  if (env.MIRA_TEST_DB_CONFIRM !== "DISPOSABLE") return { ok: false, reason: "MIRA_TEST_DB_CONFIRM must be exactly DISPOSABLE" };
  const raw = env.TEST_DATABASE_URL;
  if (!raw) return { ok: false, reason: "TEST_DATABASE_URL is not set" };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "TEST_DATABASE_URL is not a valid URL" };
  }
  if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") return { ok: false, reason: "TEST_DATABASE_URL is not a postgres URL" };
  if (u.search !== "" || u.hash !== "" || raw.includes("?") || raw.includes("#")) return { ok: false, reason: "query strings and fragments are not allowed (they can override host/database/options)" };
  if (!LOOPBACK.has(u.hostname)) return { ok: false, reason: `host ${u.hostname} is not loopback` };
  const database = /^\/([A-Za-z0-9_]+)$/.exec(u.pathname)?.[1];
  if (!database) return { ok: false, reason: "the path must be exactly one plain database name ([A-Za-z0-9_]+)" };
  if (!/test/i.test(database) || /prod|prd|stag/i.test(database)) return { ok: false, reason: "database name must contain 'test' and must not look like prod/staging" };
  const port = u.port === "" ? 5432 : Number(u.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, reason: "invalid port" };
  const user = safeDecode(u.username);
  const password = safeDecode(u.password);
  if (user === null || password === null) return { ok: false, reason: "malformed percent-encoding in the credentials" };
  return { ok: true, host: u.hostname.replace(/^\[|\]$/g, ""), port, user, password, database };
}

export class DisposableTargetRejected extends Error {}

export type IsolatedFixture = {
  /** Validates, then creates the owned schema and pools. Throws DisposableTargetRejected before any I/O on a bad target. */
  setup(): Promise<{ pool: PoolLike; schema: string }>;
  /** Ends what setup created and drops the owned schema; a no-op after a rejected or never-run setup. */
  teardown(): Promise<void>;
};

const TENANT_EXPR =
  "(tenant_id = (COALESCE(NULLIF(current_setting('app.tenant_id', true), ''), NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid))";

export function createIsolatedFixture(opts: {
  env: EnvLike;
  poolFactory: PoolFactory;
  /** Inserts the synthetic rows through `pool` (search_path already points at the owned schema). */
  seed: (pool: PoolLike) => Promise<void>;
  randomSuffix?: () => string;
}): IsolatedFixture {
  let admin: PoolLike | null = null;
  let main: PoolLike | null = null;
  let schema: string | null = null;
  let schemaCreated = false;

  return {
    async setup() {
      const target = validateDisposableTarget(opts.env);
      if (!target.ok) throw new DisposableTargetRejected(`Refusing to run: ${target.reason}`);
      const suffix = (opts.randomSuffix ?? (() => Math.random().toString(16).slice(2, 10)))();
      if (!/^[0-9a-f]{4,16}$/.test(suffix)) throw new Error("schema suffix must be hex");
      schema = `itest_refpages_${suffix}`;
      const base = { host: target.host, port: target.port, user: target.user, password: target.password, database: target.database };
      // The admin pool only runs statements that name the owned schema; its options are pinned anyway so the
      // environment (PGOPTIONS) cannot steer it.
      admin = opts.poolFactory({ ...base, options: "-c search_path=pg_catalog" });
      await admin.query(`CREATE SCHEMA ${schema}`);
      schemaCreated = true;
      // Structure only, copied from the shared table (a catalog read). Every statement below names the OWNED schema.
      await admin.query(`CREATE TABLE ${schema}.knowledge_entries (LIKE public.knowledge_entries INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`);
      await admin.query(
        `ALTER TABLE ${schema}.knowledge_entries ADD COLUMN IF NOT EXISTS content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED`,
      );
      await admin.query(`ALTER TABLE ${schema}.knowledge_entries ENABLE ROW LEVEL SECURITY`);
      await admin.query(`CREATE POLICY knowledge_entries_tenant ON ${schema}.knowledge_entries USING ${TENANT_EXPR}`);
      await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO factorylm_app`);
      await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${schema}.knowledge_entries TO factorylm_app`);
      main = opts.poolFactory({ ...base, options: `-c search_path=${schema},public` });
      await opts.seed(main);
      return { pool: main, schema };
    },
    async teardown() {
      const pools = [main, admin];
      const owned = schemaCreated && schema ? schema : null;
      // Drop first (through the admin pool), then end both; each step independent so one failure cannot skip the rest.
      if (owned && admin) await admin.query(`DROP SCHEMA IF EXISTS ${owned} CASCADE`).catch(() => undefined);
      for (const p of pools) if (p) await p.end().catch(() => undefined);
      main = admin = null;
      schemaCreated = false;
      schema = null;
    },
  };
}
