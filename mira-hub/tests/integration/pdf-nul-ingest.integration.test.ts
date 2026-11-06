/** #4923: real PDF extraction, tenant context, Postgres write and readback.
 * The fixture is synthetic and reuses the original #5038 regression artifact.
 * Setup: standard integration schema plus 003_kb_hardening.sql and
 * 049_grant_app_knowledge_entries_insert.sql. No provider, shared DB or customer document. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";

const RUN = Boolean(process.env.TEST_DATABASE_URL) && process.env.MIRA_TEST_DB_CONFIRM === "DISPOSABLE";
const { pool } = await vi.hoisted(async () => {
  const pg = await import("pg");
  return { pool: new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL }) };
});
vi.mock("@/lib/db", () => ({ default: pool }));
import { withTenantContext } from "@/lib/tenant-context";
import { writePdfChunksForNode, writeTextChunksForNode } from "@/lib/node-knowledge-ingest";

const tenant = randomUUID(), otherTenant = randomUUID(), nodeId = randomUUID();
const fixture = readFileSync(new URL("./fixtures/nul-glyph-4p-multilingual.pdf", import.meta.url));

describe.skipIf(!RUN)("PDF NUL ingest (real parser and Postgres)", () => {
  beforeAll(async () => {
    for (const id of [tenant, otherTenant]) {
      await pool.query("INSERT INTO tenants (id, slug, name, contact_email) VALUES ($1, $2, 'PDF regression', $3)",
        [id, id, `${id}@synthetic.invalid`]);
    }
  });
  afterAll(async () => {
    await pool.query("DELETE FROM knowledge_entries WHERE tenant_id=$1", [tenant]);
    await pool.query("DELETE FROM tenants WHERE id=ANY($1::uuid[])", [[tenant, otherTenant]]);
    await pool.end();
  });

  it("extracts the actual NUL glyph, persists citable page anchors and private metadata, and denies another tenant", async () => {
    const pdf = await getDocumentProxy(new Uint8Array(fixture));
    try {
      const raw = await extractText(pdf, { mergePages: false });
      expect(raw.text.join("\n")).toContain("\u0000");
    } finally { await pdf.destroy(); }
    const uploadId = randomUUID();
    const count = await writePdfChunksForNode({ tenantId: tenant, uploadId, nodeId,
      unsPath: "inbox\u0000manual", filename: "synthetic\u0000nul.pdf", buffer: fixture });
    const rows = await withTenantContext(tenant, async c => (await c.query(
      "SELECT content, page_start, page_end, metadata, is_private FROM knowledge_entries WHERE doc_id=$1", [uploadId])).rows);
    expect(rows).toHaveLength(count);
    expect(count).toBeGreaterThan(0);
    expect(rows.some(r => r.page_start === 4 && r.page_end === 4 &&
      r.content.includes("Page four: fault table F005 OverVoltage"))).toBe(true);
    for (const row of rows) {
      expect(row.content).not.toContain("\u0000");
      expect(row.is_private).toBe(true);
      expect(row.metadata.filename).toBe("synthetic nul.pdf");
      expect(row.metadata.uns_path).toBe("inbox manual");
    }
    const foreign = await withTenantContext(otherTenant, async c => (await c.query(
      "SELECT id FROM knowledge_entries WHERE doc_id=$1", [uploadId])).rows);
    expect(foreign).toEqual([]);
  });

  it("preserves a NUL-free text upload's exact content through the real database", async () => {
    const uploadId = randomUUID(), content = "A normal manual passage with 240 V and an explicit isolation condition.";
    const count = await writeTextChunksForNode({ tenantId: tenant, uploadId, nodeId,
      unsPath: "inbox", filename: "normal.txt", buffer: Buffer.from(content) });
    expect(count).toBe(1);
    const { rows } = await pool.query("SELECT content, metadata, is_private FROM knowledge_entries WHERE doc_id=$1", [uploadId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe(content);
    expect(rows[0].metadata.filename).toBe("normal.txt");
    expect(rows[0].is_private).toBe(true);
  });
});
