import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ARPK Phase 1b — server-side SHA-256 content dedup on hub_uploads.
 *
 * The v2 chunk writer embeds the uploadId in source_url, so its ON CONFLICT
 * only protects a retry of the SAME upload — re-uploading the same PDF used to
 * produce a full second chunk set (the "gs10_fault_codes.pdf ingested 158x"
 * incident class; #2968). The door now hashes the bytes, stores
 * hub_uploads.content_sha256 (migration 072), and asks findDuplicateUpload for
 * an existing parsed v2 document with the same (tenant, hash, node) before
 * chunking again. Same bytes on a DIFFERENT node still ingest — chunks must
 * carry that node's node_id.
 */

const queryMock = vi.fn();
vi.mock("@/lib/db", () => ({ default: { query: (...a: unknown[]) => queryMock(...a) } }));

import { createUpload, findDuplicateUpload } from "../uploads";

const SHA = "a".repeat(64);
const NODE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const uploadRow = {
  id: "up-dup",
  tenant_id: "t-1",
  provider: "local",
  kind: "document",
  external_file_id: null,
  external_download_url: null,
  filename: "manual.pdf",
  mime_type: "application/pdf",
  size_bytes: "1000",
  external_created_at: null,
  status: "parsed",
  status_detail: null,
  kb_file_id: null,
  kb_chunk_count: 42,
  asset_tag: null,
  uns_path: null,
  kg_entity_id: NODE,
  ingest_route: "v2",
  content_sha256: SHA,
  created_at: "2026-08-10T00:00:00Z",
  updated_at: "2026-08-10T00:00:00Z",
};

beforeEach(() => {
  queryMock.mockReset();
  // ensureUploadsSchema column probe — always satisfied in these tests.
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes("information_schema.columns")) return { rows: [{ "?column?": 1 }] };
    return { rows: [] };
  });
});

describe("createUpload content hash", () => {
  it("persists content_sha256 when provided", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("information_schema.columns")) return { rows: [{ "?column?": 1 }] };
      return { rows: [uploadRow] };
    });

    const up = await createUpload({
      tenantId: "t-1",
      provider: "local",
      filename: "manual.pdf",
      contentSha256: SHA,
    });
    expect(up.contentSha256).toBe(SHA);

    const insert = queryMock.mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO hub_uploads"),
    );
    expect(insert).toBeDefined();
    expect(String(insert![0])).toContain("content_sha256");
    expect(insert![1]).toContain(SHA);
  });
});

describe("findDuplicateUpload", () => {
  it("returns the existing parsed v2 document for the same (tenant, hash, node)", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("information_schema.columns")) return { rows: [{ "?column?": 1 }] };
      if (sql.includes("content_sha256")) return { rows: [uploadRow] };
      return { rows: [] };
    });

    const dup = await findDuplicateUpload("t-1", SHA, NODE);
    expect(dup).not.toBeNull();
    expect(dup!.id).toBe("up-dup");
    expect(dup!.kbChunkCount).toBe(42);

    const sel = queryMock.mock.calls.find((c) => String(c[0]).includes("content_sha256"));
    const sql = String(sel![0]);
    expect(sql).toContain("kg_entity_id");
    expect(sql).toContain("'parsed'");
    expect(sql).toContain("'v2'");
    expect(sel![1]).toEqual(["t-1", SHA, NODE]);
  });

  it("returns null when nothing matches", async () => {
    const dup = await findDuplicateUpload("t-1", SHA, NODE);
    expect(dup).toBeNull();
  });
});
