/**
 * Garage pilot PR-6 (plan row 16-A) — `reprocessNodeDocument` re-extracts ONE
 * already-stored node document through the same parse + row writer the upload
 * uses, and swaps its chunks in ONE transaction: DELETE the document's old
 * node_attachment rows, INSERT the new ones (same INSERT text, `is_private =
 * true` literal, `extraction_version` stamp), COMMIT — then AWAITS the embed
 * pass (the upload fires it and forgets) and records the new chunk count
 * through the existing `updateUploadStatus`. Any failure before COMMIT rolls
 * back and the old rows stay.
 *
 * Why delete-then-insert: the insert is `ON CONFLICT (tenant_id, source_url,
 * chunk_index) DO NOTHING`, so "insert the new rows, then delete the old" would
 * collide on chunk_index 0..N and silently drop EVERY new row.
 *
 * Idempotent on `extraction_version`: a document whose rows all carry the
 * current stamp is a no-op (nothing touched, nothing logged) unless the owner
 * forces it (`recomputed_human_requested`).
 *
 * Bytes: the v2 upload's own bytes are NOT kept after parsing. They come from
 * the parked original (`namespace_direct_uploads` by `hub_uploads.file_id`),
 * or from a local PDF proven to be the upload (sha256 = `content_sha256`,
 * `uploadIdentity`); anything else is refused with its reason.
 *
 * Harness: scripted `@/lib/db` pool (records every statement with the client
 * that ran it, in order) + `@/lib/tenant-context` (the parked-original read
 * and the embed pass run there) + unpdf mocked to a two-page document.
 *
 * Run: npx vitest run src/capabilities/__tests__/node-document-reprocess.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const TENANT = "11111111-1111-4111-8111-111111111111";
const DOC = "33333333-3333-4333-8333-333333333333";
const NODE = "44444444-4444-4444-8444-444444444444";
const FILE = "55555555-5555-4555-8555-555555555555";

const PAGES = [
  "GS10 Series AC Drive User Manual. Chapter 1: Getting Started. Read all safety warnings before installing the drive.",
  "Specifications. Rated input current is listed per model in the table on the next page. Frame A drives weigh 1.2 kg.",
];
const LOCAL_PDF = Buffer.from("%PDF-1.4 the uploaded bytes");
const LOCAL_SHA = createHash("sha256").update(LOCAL_PDF).digest("hex");

type Stmt = { client: string; sql: string; params: unknown[] };
const db = vi.hoisted(() => ({
  stmts: [] as Array<{ client: string; sql: string; params: unknown[] }>,
  upload: null as Record<string, unknown> | null,
  versionRow: { n: 0, current: 0, unstamped: 0, min_version: null } as { n: number; current: number; unstamped: number; min_version: number | null },
  parked: null as Buffer | null,
  insertThrows: false,
  deleteCount: 0,
  clientSeq: 0,
}));

vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({})),
  extractText: vi.fn(async () => ({ text: [...PAGES] })),
}));
// No label worker, no layout read: the parse path itself is covered by the
// upload suites (tables / garble / page-label tests); this file proves the swap.
vi.mock("@/capabilities/pdf-page-label-reader", () => ({ readPageLabelsBounded: vi.fn(async () => null) }));
vi.mock("@/capabilities/pdf-layout-items", () => ({ pageLayoutItems: vi.fn(async () => []) }));

vi.mock("@/lib/db", () => {
  const run = (client: string) => async (sql: string, params: unknown[] = []) => {
    db.stmts.push({ client, sql, params });
    if (/FROM hub_uploads/.test(sql)) return { rows: db.upload ? [db.upload] : [], rowCount: db.upload ? 1 : 0 };
    if (/count\(\*\)/.test(sql) && /FROM knowledge_entries/.test(sql)) return { rows: [db.versionRow], rowCount: 1 };
    if (/DELETE FROM knowledge_entries/.test(sql)) return { rows: [], rowCount: db.deleteCount };
    if (/INSERT INTO knowledge_entries/.test(sql)) {
      if (db.insertThrows) throw new Error("boom: insert failed");
      return { rows: [], rowCount: (params.length - 3) / 4 };
    }
    return { rows: [], rowCount: 0 };
  };
  return {
    default: {
      query: run("pool"),
      connect: vi.fn(async () => {
        const id = `client-${++db.clientSeq}`;
        return { query: run(id), release: vi.fn() };
      }),
    },
  };
});

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<unknown>) =>
    fn({
      query: async (sql: string, params: unknown[] = []) => {
        // The embed pass's read lands a tick late, like a real round trip: a
        // reprocess that fired it and forgot would write the count first.
        if (/embedding IS NULL/.test(sql)) await new Promise((r) => setTimeout(r, 5));
        db.stmts.push({ client: "tenant", sql, params });
        if (/FROM namespace_direct_uploads/.test(sql)) return { rows: db.parked ? [{ content: db.parked }] : [], rowCount: db.parked ? 1 : 0 };
        // The embed pass: nothing pending.
        return { rows: [], rowCount: 0 };
      },
    }),
  ),
}));

const uploads = vi.hoisted(() => ({
  /** How many statements had run when the chunk count was written (-1 = never). */
  countWrittenAt: -1,
  updateUploadStatus: vi.fn(async () => {
    uploads.countWrittenAt = db.stmts.length;
  }),
}));
vi.mock("@/lib/uploads", () => ({ updateUploadStatus: uploads.updateUploadStatus }));

const ocrSeam = vi.hoisted(() => ({ ocrExtractPage: vi.fn(async (): Promise<string | null> => null) }));
vi.mock("@/capabilities/garbled-text-ocr", () => ocrSeam);

async function reprocess(opts: { bytes?: Uint8Array | null; force?: boolean; dryRun?: boolean } = {}) {
  const { reprocessNodeDocument } = await import("@/lib/node-knowledge-ingest");
  return reprocessNodeDocument({ tenantId: TENANT, uploadId: DOC, ...opts });
}

const uploadRow = (extra: Record<string, unknown> = {}) => ({
  id: DOC,
  filename: "gs10usermanual.pdf",
  kg_entity_id: NODE,
  uns_path: "enterprise.garage.demo_cell.cv_101",
  content_sha256: LOCAL_SHA,
  file_id: null,
  kb_chunk_count: 12,
  ...extra,
});

const sqlOf = (s: Stmt) => s.sql.replace(/\s+/g, " ").trim();
const seq = () => db.stmts.map((s) => `${s.client}: ${sqlOf(s).slice(0, 34)}`);

beforeEach(() => {
  db.stmts.length = 0;
  db.upload = uploadRow();
  db.versionRow = { n: 12, current: 0, unstamped: 12, min_version: null }; // twelve old flat rows, none stamped
  db.parked = null;
  db.insertThrows = false;
  db.deleteCount = 12;
  db.clientSeq = 0;
  uploads.updateUploadStatus.mockClear();
  uploads.countWrittenAt = -1;
  vi.resetModules();
  process.env.NODE_EMBED_ON_WRITE = "1";
  delete process.env.NOTEBOOK_GARBLE_DECODE;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  delete process.env.NODE_EMBED_ON_WRITE;
});

describe("reprocessNodeDocument — one transaction, delete then insert, then the embed pass is awaited", () => {
  it("old flat rows → BEGIN, DELETE (this tenant, this doc, node_attachment only), INSERT, COMMIT on ONE client; then embed; then the count", async () => {
    const r = await reprocess({ bytes: LOCAL_PDF });
    expect(r.action).toBe("reprocessed");
    if (r.action !== "reprocessed") return;
    expect(r.from).toBeNull();
    expect(r.to).toBe(2);
    expect(r.deleted).toBe(12);
    expect(r.inserted).toBeGreaterThan(0);

    const tx = db.stmts.filter((s) => s.client.startsWith("client-"));
    expect(new Set(tx.map((s) => s.client)).size).toBe(1);
    const kinds = tx.map((s) => sqlOf(s)).map((q) =>
      /^BEGIN/.test(q) ? "BEGIN" : /^DELETE FROM knowledge_entries/.test(q) ? "DELETE" : /^INSERT INTO knowledge_entries/.test(q) ? "INSERT" : /^COMMIT/.test(q) ? "COMMIT" : /^ROLLBACK/.test(q) ? "ROLLBACK" : q.slice(0, 20),
    );
    expect(kinds[0]).toBe("BEGIN");
    expect(kinds[1]).toBe("DELETE");
    expect(kinds.slice(2, -1).every((k) => k === "INSERT")).toBe(true);
    expect(kinds[kinds.length - 1]).toBe("COMMIT");
    expect(kinds).not.toContain("ROLLBACK");

    const del = tx.find((s) => /^DELETE/.test(sqlOf(s)))!;
    expect(sqlOf(del)).toMatch(/WHERE tenant_id = \$1(::uuid)? AND doc_id = \$2::uuid AND source_type = 'node_attachment'/);
    expect(del.params).toEqual([TENANT, DOC]);

    // The INSERT is the upload's own: is_private literal, the version stamp on every row.
    const ins = tx.filter((s) => /^INSERT/.test(sqlOf(s)));
    for (const s of ins) {
      expect(sqlOf(s)).toMatch(/, true\)/);
      expect(sqlOf(s)).toMatch(/ON CONFLICT \(tenant_id, source_url, \(\(metadata->>'chunk_index'\)::int\)\)/);
      expect(s.params[0]).toBe(TENANT);
      expect(s.params[1]).toBe(`node-doc/${DOC}/gs10usermanual.pdf`);
      expect(s.params[2]).toBe(DOC);
      for (let i = 3; i + 3 < s.params.length; i += 4) {
        expect(JSON.parse(String(s.params[i + 3])).extraction_version).toBe(2);
      }
    }

    // Awaited, in order: COMMIT, then the embed pass reads pending rows, then the count is written.
    const commitAt = db.stmts.findIndex((s) => /^COMMIT/.test(sqlOf(s)));
    const embedAt = db.stmts.findIndex((s) => s.client === "tenant" && /embedding IS NULL/.test(s.sql));
    expect(commitAt).toBeGreaterThan(-1);
    expect(embedAt).toBeGreaterThan(commitAt);
    expect(r.embed.state).toBe("complete");
    expect(uploads.updateUploadStatus).toHaveBeenCalledTimes(1);
    expect(uploads.updateUploadStatus).toHaveBeenCalledWith(DOC, TENANT, "parsed", null, { kbChunkCount: r.inserted });
    // The count is written only AFTER the (slow) embed read returned — i.e. the pass was awaited.
    expect(uploads.countWrittenAt).toBeGreaterThan(embedAt);
  });

  it("the insert fails → ROLLBACK, no COMMIT, no embed pass, no count written; the old rows stay", async () => {
    db.insertThrows = true;
    await expect(reprocess({ bytes: LOCAL_PDF })).rejects.toThrow(/insert failed/);
    const q = db.stmts.map(sqlOf);
    expect(q.some((s) => /^ROLLBACK/.test(s))).toBe(true);
    expect(q.some((s) => /^COMMIT/.test(s))).toBe(false);
    expect(db.stmts.some((s) => s.client === "tenant" && /embedding IS NULL/.test(s.sql))).toBe(false);
    expect(uploads.updateUploadStatus).not.toHaveBeenCalled();
  });

  it("control: a document already at the current version is a no-op — nothing deleted, inserted, embedded or parsed", async () => {
    db.versionRow = { n: 20, current: 20, unstamped: 0, min_version: 2 };
    db.upload = uploadRow({ kb_chunk_count: 20 }); // the recorded count agrees with the rows
    const r = await reprocess({ bytes: LOCAL_PDF });
    expect(r).toEqual({ action: "noop", version: 2, chunkCount: 20 });
    const q = db.stmts.map(sqlOf);
    expect(q.some((s) => /^DELETE|^INSERT|^BEGIN/.test(s))).toBe(false);
    expect(db.stmts.some((s) => /embedding IS NULL/.test(s.sql))).toBe(false);
    expect(uploads.updateUploadStatus).not.toHaveBeenCalled();
  });

  // Cheap review of PR-6 (#5427 r1) finding 1: the count is written AFTER commit, so a failed
  // status write leaves the swapped chunks with a stale kb_chunk_count; the retry lands on the
  // no-op path, which must make the write the failed step would have made.
  it("a no-op retry repairs a stale kb_chunk_count with the same write the failed step would have made", async () => {
    db.versionRow = { n: 12, current: 12, unstamped: 0, min_version: 2 };
    db.upload = uploadRow({ kb_chunk_count: 7 });
    const r = await reprocess();
    expect(r).toEqual({ action: "noop", version: 2, chunkCount: 12, countRepaired: true });
    expect(uploads.updateUploadStatus).toHaveBeenCalledWith(DOC, TENANT, "parsed", null, { kbChunkCount: 12 });
    expect(db.stmts.some((s) => /^DELETE|^INSERT|^BEGIN/.test(sqlOf(s)))).toBe(false);
  });

  it("control: a no-op whose count already matches writes nothing", async () => {
    db.versionRow = { n: 12, current: 12, unstamped: 0, min_version: 2 };
    db.upload = uploadRow({ kb_chunk_count: 12 });
    expect(await reprocess()).toEqual({ action: "noop", version: 2, chunkCount: 12 });
    expect(uploads.updateUploadStatus).not.toHaveBeenCalled();
  });

  it("force (recomputed_human_requested) recomputes a document already at the current version", async () => {
    db.versionRow = { n: 20, current: 20, unstamped: 0, min_version: 2 };
    db.deleteCount = 20;
    const r = await reprocess({ bytes: LOCAL_PDF, force: true });
    expect(r.action).toBe("reprocessed");
    if (r.action === "reprocessed") {
      expect(r.from).toBe(2);
      expect(r.deleted).toBe(20);
      expect(r.reason).toBe("recomputed_human_requested");
    }
  });

  it("the script's dry run reports the plan (counts, bytes source, reason) and touches nothing — not even the parse", async () => {
    const { getDocumentProxy } = await import("unpdf");
    vi.mocked(getDocumentProxy).mockClear();
    const r = await reprocess({ bytes: LOCAL_PDF, dryRun: true });
    expect(r).toEqual({ action: "plan", reason: "recomputed_algorithm_changed", from: null, to: 2, chunkCount: 12, bytesFrom: "local_pdf" });
    expect(db.stmts.some((s) => /^DELETE|^INSERT|^BEGIN/.test(sqlOf(s)))).toBe(false);
    expect(db.stmts.some((s) => /embedding IS NULL/.test(s.sql))).toBe(false);
    expect(uploads.updateUploadStatus).not.toHaveBeenCalled();
    expect(getDocumentProxy).not.toHaveBeenCalled();
    // The dry run still proves the bytes: a wrong local file is refused, not planned.
    expect(await reprocess({ bytes: Buffer.from("%PDF-1.4 not it"), dryRun: true })).toEqual({ action: "refused", reason: "sha_mismatch" });
  });

  it("a partly-stamped document (some rows at 2, some unstamped) is NOT current: it is reprocessed", async () => {
    db.versionRow = { n: 20, current: 8, unstamped: 12, min_version: 2 };
    db.deleteCount = 20;
    const r = await reprocess({ bytes: LOCAL_PDF });
    expect(r.action).toBe("reprocessed");
    if (r.action === "reprocessed") expect(r.reason).toBe("recomputed_algorithm_changed");
  });
});

describe("reprocessNodeDocument — where the bytes come from", () => {
  it("the parked original (namespace_direct_uploads by file_id) is used when the upload has one, with no local file", async () => {
    db.upload = uploadRow({ file_id: FILE, content_sha256: null });
    db.parked = LOCAL_PDF;
    const r = await reprocess();
    expect(r.action).toBe("reprocessed");
    const read = db.stmts.find((s) => /FROM namespace_direct_uploads/.test(s.sql))!;
    expect(read).toBeDefined();
    expect(read.params).toEqual([FILE, TENANT]);
  });

  it("a local PDF is accepted only when its sha256 equals the upload's recorded hash", async () => {
    const r = await reprocess({ bytes: Buffer.from("%PDF-1.4 some other file") });
    expect(r).toEqual({ action: "refused", reason: "sha_mismatch" });
    expect(db.stmts.some((s) => /^DELETE|^INSERT/.test(sqlOf(s)))).toBe(false);
  });

  it("a local PDF cannot be proven to be an upload that has no recorded hash → refused", async () => {
    db.upload = uploadRow({ content_sha256: null });
    const r = await reprocess({ bytes: LOCAL_PDF });
    expect(r).toEqual({ action: "refused", reason: "no_upload_hash" });
  });

  it("no parked original and no local file → refused (never 'best effort')", async () => {
    const r = await reprocess();
    expect(r).toEqual({ action: "refused", reason: "no_bytes" });
  });

  // Cheap review of PR-6 (#5427 r1) finding 2: a plan must not promise bytes it never checked.
  it("dry run with a file_id whose parked row has no content → refused no_bytes, not a plan", async () => {
    db.upload = uploadRow({ file_id: FILE, content_sha256: null });
    db.parked = null;
    expect(await reprocess({ dryRun: true })).toEqual({ action: "refused", reason: "no_bytes" });
    expect(db.stmts.some((s) => /^DELETE|^INSERT|^BEGIN/.test(sqlOf(s)))).toBe(false);
    // The proof reads presence, never the bytes.
    const probe = db.stmts.find((s) => /FROM namespace_direct_uploads/.test(s.sql))!;
    expect(probe).toBeDefined();
    expect(probe.sql).toMatch(/content IS NOT NULL/);
    expect(probe.sql).not.toMatch(/SELECT\s+content\b/);
  });

  it("control: dry run with a parked original present → plan from parked_original", async () => {
    db.upload = uploadRow({ file_id: FILE, content_sha256: null });
    db.parked = LOCAL_PDF;
    expect(await reprocess({ dryRun: true })).toEqual({
      action: "plan", reason: "recomputed_algorithm_changed", from: null, to: 2, chunkCount: 12, bytesFrom: "parked_original",
    });
  });

  it("an upload with no attached node (kg_entity_id null) → refused: the rows would carry an empty node_id", async () => {
    db.upload = uploadRow({ kg_entity_id: null });
    expect(await reprocess({ bytes: LOCAL_PDF })).toEqual({ action: "refused", reason: "no_node" });
    expect(db.stmts.some((s) => /^DELETE|^INSERT|^BEGIN/.test(sqlOf(s)))).toBe(false);
  });

  it("an upload that does not belong to this tenant → refused before anything is read or written", async () => {
    db.upload = null;
    const r = await reprocess({ bytes: LOCAL_PDF });
    expect(r).toEqual({ action: "refused", reason: "no_upload" });
    expect(db.stmts.filter((s) => /FROM hub_uploads/.test(s.sql))[0]!.params).toEqual([DOC, TENANT]);
    expect(seq().some((s) => /DELETE|INSERT|namespace_direct/.test(s))).toBe(false);
  });
});
