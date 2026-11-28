// #6119: migration 119 and the manual byte cache, against a real, disposable Postgres.
// The migration is applied from db/pending-migrations/ (it is held out of db/migrations/ until
// Mike approves the staging apply — migration-verify.yml applies that folder to staging Neon).
// Proves: the migration is idempotent, the app role can read/insert/update but not delete, the
// ok-has-bytes check holds, the resolver never returns a private row, and two concurrent misses
// for one manual fetch the vendor once and store one row.
//
// From mira-hub/ (throwaway database only):
//   docker run -d --name mira6119-pg -e POSTGRES_PASSWORD=testpw -e POSTGRES_DB=mira_test -p 55619:5432 postgres:16
//   export TEST_DATABASE_URL=postgres://postgres:testpw@127.0.0.1:55619/mira_test MIRA_TEST_DB_CONFIRM=DISPOSABLE
//   node scripts/setup-integration-db.mjs
//   npx vitest run --config vitest.integration.config.ts src/capabilities/__tests__/oem-source-bytes.integration.test.ts
// Not wired into CI (same status as confirmed-numbers.integration.test.ts).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";

// The pool is built only for an explicit disposable loopback database (the repository's shared
// validator): without MIRA_TEST_DB_CONFIRM=DISPOSABLE, or for any other host, the suite throws
// before a single connection or query.
vi.mock("@/lib/db", async () => {
  const { equipmentTestDatabaseUrl } = await import("../../../scripts/equipment-test-database.mjs");
  const { Pool: PgPool } = await import("pg");
  const url = equipmentTestDatabaseUrl(process.env.TEST_DATABASE_URL ?? "", process.env.MIRA_TEST_DB_CONFIRM ?? "");
  return { default: new PgPool({ connectionString: url }) };
});

import dbPool from "@/lib/db";
import { RESOLVE_SOURCE_SQL, STORE_SQL, oemSourceBytes, sha256Hex, type SourceDeps } from "@/capabilities/oem-source-bytes";

const testPool = dbPool as unknown as Pool;

const MIGRATION = readFileSync(join(__dirname, "../../../db/pending-migrations/119_oem_source_documents.sql"), "utf8");
const TENANT = "6119beef-0000-4000-8000-0000000000aa";
const PUBLIC_ENTRY = "6119beef-0000-4000-8000-000000000001";
const PRIVATE_ENTRY = "6119beef-0000-4000-8000-000000000002";
const URL_OK = "https://cache.industry.siemens.com/dl/files/6119-g120.pdf";
const URL_PRIVATE = "https://cache.industry.siemens.com/dl/files/6119-private.pdf";
const PDF = Buffer.from("%PDF-1.7\n6119\n%%EOF\n");

const wipe = async () => {
  await testPool.query(`DELETE FROM oem_source_documents WHERE source_url IN ($1, $2)`, [URL_OK, URL_PRIVATE]);
};

beforeAll(async () => {
  await testPool.query(MIGRATION);
  await testPool.query(MIGRATION); // idempotent: a second apply is a no-op, not an error
  await testPool.query(`DELETE FROM knowledge_entries WHERE id IN ($1::uuid, $2::uuid)`, [PUBLIC_ENTRY, PRIVATE_ENTRY]);
  await testPool.query(
    `INSERT INTO knowledge_entries (id, tenant_id, content, source_url, source_page, is_private)
     VALUES ($1::uuid, $3::uuid, 'F30011 line fault', $4, 906, false),
            ($2::uuid, $3::uuid, 'private upload', $5, 1, true)`,
    [PUBLIC_ENTRY, PRIVATE_ENTRY, TENANT, URL_OK, URL_PRIVATE],
  );
  await wipe();
});

afterAll(async () => {
  await wipe();
  await testPool.query(`DELETE FROM knowledge_entries WHERE id IN ($1::uuid, $2::uuid)`, [PUBLIC_ENTRY, PRIVATE_ENTRY]);
  await testPool.end();
});

describe("migration 119 on a real Postgres", () => {
  it("the table exists after two applies", async () => {
    const r = await testPool.query(`SELECT to_regclass('public.oem_source_documents')::text AS t`);
    expect(r.rows[0].t).toBe("oem_source_documents");
  });

  it("the app role can insert, read and update a row, but cannot delete it", async () => {
    const c = await testPool.connect();
    const sha = sha256Hex(URL_OK);
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE factorylm_app");
      await c.query(
        `INSERT INTO oem_source_documents (url_sha256, source_url, status, retry_after) VALUES ($1, $2, 'fetch_failed', now())`,
        [sha, URL_OK],
      );
      await c.query(`UPDATE oem_source_documents SET http_status = 500 WHERE url_sha256 = $1`, [sha]);
      const read = await c.query(`SELECT http_status FROM oem_source_documents WHERE url_sha256 = $1`, [sha]);
      expect(read.rows[0].http_status).toBe(500);
      await c.query("SAVEPOINT d");
      await expect(c.query(`DELETE FROM oem_source_documents WHERE url_sha256 = $1`, [sha])).rejects.toThrow(/permission denied/);
      await c.query("ROLLBACK TO SAVEPOINT d");
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  it("an ok row must carry bytes, and a failure row must not", async () => {
    await expect(
      testPool.query(`INSERT INTO oem_source_documents (url_sha256, source_url, status) VALUES ('x6119a', 'https://a/6119', 'ok')`),
    ).rejects.toThrow(/oem_source_documents_ok_has_bytes/);
    await expect(
      testPool.query(
        `INSERT INTO oem_source_documents (url_sha256, source_url, status, content) VALUES ('x6119b', 'https://b/6119', 'not_pdf', '\\x00')`,
      ),
    ).rejects.toThrow(/oem_source_documents_ok_has_bytes/);
  });
});

describe("the resolver reads only shared rows", () => {
  it("a private row resolves to nothing; control: the public row resolves to its address", async () => {
    expect((await testPool.query(RESOLVE_SOURCE_SQL, [PRIVATE_ENTRY])).rows).toEqual([]);
    expect((await testPool.query(RESOLVE_SOURCE_SQL, [PUBLIC_ENTRY])).rows).toEqual([{ source_url: URL_OK }]);
  });
});

describe("two concurrent misses for one manual", () => {
  it("fetch the vendor once and store one row", async () => {
    await wipe();
    let calls = 0;
    const slowFetch = (async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 300));
      return new Response(PDF);
    }) as unknown as typeof fetch;
    const deps = (): SourceDeps => ({
      db: testPool as unknown as SourceDeps["db"],
      fetch: { fetch: slowFetch, resolve: async () => ["23.0.0.10"], timeoutMs: 5_000, maxBytes: 1024 },
      now: () => Date.now(),
      log: () => undefined,
    });
    const [a, b] = await Promise.all([oemSourceBytes(PUBLIC_ENTRY, deps()), oemSourceBytes(PUBLIC_ENTRY, deps())]);
    expect(a.kind).toBe("ok");
    expect(b.kind).toBe("ok");
    expect(calls).toBe(1);
    const rows = await testPool.query(`SELECT status, byte_length FROM oem_source_documents WHERE source_url = $1`, [URL_OK]);
    expect(rows.rows).toEqual([{ status: "ok", byte_length: String(PDF.byteLength) }]);
  });

  it("five cold opens on a five-connection pool: one download, and other queries are not starved", async () => {
    await wipe();
    const { Pool: PgPool } = await import("pg");
    const small = new PgPool({ connectionString: (testPool as unknown as { options: { connectionString: string } }).options.connectionString, max: 5, connectionTimeoutMillis: 5_000 });
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const heldFetch = (async () => {
      calls += 1;
      await gate;
      return new Response(PDF);
    }) as unknown as typeof fetch;
    const deps: SourceDeps = {
      db: small as unknown as SourceDeps["db"],
      fetch: { fetch: heldFetch, resolve: async () => ["23.0.0.10"], timeoutMs: 5_000, maxBytes: 1024 },
      now: () => Date.now(),
      log: () => undefined,
    };
    try {
      const opens = Promise.all(Array.from({ length: 5 }, () => oemSourceBytes(PUBLIC_ENTRY, deps)));
      await new Promise((r) => setTimeout(r, 200));
      // While the vendor download is still pending, an unrelated query on the same pool answers.
      const unrelated = await small.query("SELECT 1 AS one");
      expect(unrelated.rows[0].one).toBe(1);
      expect(calls).toBe(1);
      release();
      const results = await opens;
      expect(results.every((r) => r.kind === "ok")).toBe(true);
      expect(calls).toBe(1);
    } finally {
      release();
      await small.end();
    }
  });

  it("a private row is never fetched or stored", async () => {
    await wipe();
    let calls = 0;
    const f = (async () => {
      calls += 1;
      return new Response(PDF);
    }) as unknown as typeof fetch;
    const out = await oemSourceBytes(PRIVATE_ENTRY, {
      db: testPool as unknown as SourceDeps["db"],
      fetch: { fetch: f, resolve: async () => ["23.0.0.10"], timeoutMs: 5_000, maxBytes: 1024 },
      now: () => Date.now(),
      log: () => undefined,
    });
    expect(out).toEqual({ kind: "not_found" });
    expect(calls).toBe(0);
    expect((await testPool.query(`SELECT 1 FROM oem_source_documents WHERE source_url = $1`, [URL_PRIVATE])).rows).toEqual([]);
  });
});

describe("the stored copy of a manual", () => {
  const store = (status: string, content: Buffer | null) =>
    testPool.query(STORE_SQL, [
      sha256Hex(URL_OK), URL_OK, status, 200, content, content ? sha256Hex(content) : null,
      content ? "application/pdf" : null, content ? content.byteLength : null,
      content ? null : new Date(Date.now() + 60_000),
    ]);
  const row = async () =>
    (await testPool.query(`SELECT status, content_sha256 FROM oem_source_documents WHERE source_url = $1`, [URL_OK])).rows[0];

  it("a good copy is never replaced, by a failure or by different bytes", async () => {
    await wipe();
    await store("ok", PDF);
    await store("not_pdf", null);
    expect(await row()).toEqual({ status: "ok", content_sha256: sha256Hex(PDF) });
    const other = Buffer.from("%PDF-1.7\nrevised\n%%EOF\n");
    await store("ok", other);
    expect(await row()).toEqual({ status: "ok", content_sha256: sha256Hex(PDF) });
  });

  it("control — a failure row is replaced by a later good copy", async () => {
    await wipe();
    await store("fetch_failed", null);
    await store("ok", PDF);
    expect(await row()).toEqual({ status: "ok", content_sha256: sha256Hex(PDF) });
  });
});
