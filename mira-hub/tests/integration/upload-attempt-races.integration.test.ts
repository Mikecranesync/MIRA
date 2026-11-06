/** #4091: actual row locking, cancellation, stale-writer rejection and tenant isolation.
 * Disposable schema: defaults plus canonical migrations 003, 049 and 099. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const RUN = Boolean(process.env.TEST_DATABASE_URL) && process.env.MIRA_TEST_DB_CONFIRM === "DISPOSABLE";
const { pool } = await vi.hoisted(async () => {
  const pg = await import("pg");
  return { pool: new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 5 }) };
});
vi.mock("@/lib/db", () => ({ default: pool }));
import { withUploadRowTenantContext } from "@/lib/tenant-context";
import { cancelUpload, UploadAttemptRevokedError } from "@/lib/uploads";
import { writePdfChunksForNode, writeTextChunksForNode } from "@/lib/node-knowledge-ingest";
const tenant = randomUUID(), other = randomUUID(), nodeId = randomUUID();
let upload: { id: string; attempt: string };
const write = (tenantId = tenant) => writeTextChunksForNode({ tenantId, uploadId: upload.id,
  nodeId, filename: "race.txt", unsPath: null, buffer: Buffer.from("Private source evidence."), attemptId: upload.attempt });
describe.skipIf(!RUN)("upload attempt races (real Postgres)", () => {
  beforeAll(async () => {
    await pool.query("INSERT INTO tenants (id, slug, name, contact_email) VALUES ($1, $2, 'Upload fixture', $3)",
      [tenant, tenant, `${tenant}@synthetic.invalid`]);
  });
  beforeEach(async () => {
    const { rows } = await pool.query(`INSERT INTO hub_uploads (tenant_id, provider, filename, status)
      VALUES ($1, 'local', 'race.txt', 'parsing') RETURNING id::text, attempt_id::text AS attempt`, [tenant]);
    upload = rows[0];
    expect(upload.attempt).toMatch(/^[0-9a-f-]{36}$/);
  });
  afterAll(async () => {
    await pool.query("DELETE FROM knowledge_entries WHERE tenant_id=$1", [tenant]);
    await pool.query("DELETE FROM hub_uploads WHERE tenant_id=$1", [tenant]);
    await pool.query("DELETE FROM tenants WHERE id=$1", [tenant]);
    await pool.end();
  });
  it("cancel waits for an active write, removes its committed chunks, then rejects its old attempt", async () => {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(r => { entered = r; });
    const finish = new Promise<void>(r => { release = r; });
    const writing = withUploadRowTenantContext(tenant, upload.id, upload.attempt, async c => {
      entered(); await finish;
      // Fixture write under the real limited role; is_private is explicitly true.
      await c.query(`INSERT INTO knowledge_entries (id, tenant_id, source_type, content, doc_id, is_private)
        VALUES ($1, $2, 'node_attachment', 'in-flight source', $3, true)`, [randomUUID(), tenant, upload.id]);
    });
    await started;
    const cancelling = cancelUpload(upload.id, tenant, "fixture cancellation");
    try {
      const deadline = Date.now() + 3000;
      let blocked = false;
      while (Date.now() < deadline && !blocked) {
        const { rows } = await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND query LIKE '%UPDATE hub_uploads%'`);
        blocked = rows.length > 0;
        if (!blocked) await new Promise(r => setTimeout(r, 10));
      }
      expect(blocked).toBe(true);
    } finally { release(); await Promise.allSettled([writing, cancelling]); }
    expect(await cancelling).toBe(true);
    await expect(write()).rejects.toBeInstanceOf(UploadAttemptRevokedError);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM knowledge_entries WHERE doc_id=$1 AND tenant_id=$2", [upload.id, tenant]);
    expect(rows[0].n).toBe(0);
  });
  it("sanitizes a real PDF under the current attempt, deduplicates retry, and cannot resurrect it after cancellation", async () => {
    const buffer = readFileSync(new URL("./fixtures/nul-glyph-4p-multilingual.pdf", import.meta.url));
    const opts = { tenantId: tenant, uploadId: upload.id, nodeId, attemptId: upload.attempt,
      filename: "fenced\u0000manual.pdf", unsPath: "inbox\u0000manual", buffer };
    const count = await writePdfChunksForNode(opts);
    expect(count).toBeGreaterThan(0);
    expect(await writePdfChunksForNode(opts)).toBe(count);
    const { rows } = await pool.query("SELECT content, page_start, metadata, is_private FROM knowledge_entries WHERE doc_id=$1 AND tenant_id=$2", [upload.id, tenant]);
    expect(rows).toHaveLength(count);
    expect(rows.some(r => r.page_start === 4)).toBe(true);
    for (const row of rows) {
      expect(row.content).not.toContain("\u0000");
      expect(row.metadata.filename).toBe("fenced manual.pdf");
      expect(row.metadata.uns_path).toBe("inbox manual");
      expect(row.is_private).toBe(true);
    }
    expect(await cancelUpload(upload.id, tenant, "fixture cancellation")).toBe(true);
    await expect(writePdfChunksForNode(opts)).rejects.toBeInstanceOf(UploadAttemptRevokedError);
  });
  it("a different tenant cannot write; the current tenant and attempt can persist the source", async () => {
    await expect(write(other)).rejects.toBeInstanceOf(UploadAttemptRevokedError);
    expect(await write()).toBe(1);
    expect(await write()).toBe(1); // Exact retry must not add a second chunk.
    const { rows } = await pool.query("SELECT tenant_id::text, content, is_private FROM knowledge_entries WHERE doc_id=$1 AND tenant_id=$2", [upload.id, tenant]);
    expect(rows).toEqual([{ tenant_id: tenant, content: "Private source evidence.", is_private: true }]);
  });
});
