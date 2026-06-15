import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Slice 1 memory-bounding — writePdfChunksForNode must NOT accumulate every chunk
 * of a large manual in one array and issue one INSERT per chunk. It buffers at
 * most BATCH_ROWS (50) chunks and flushes each batch as ONE multi-row INSERT.
 *
 * This asserts the insert SHAPE (batched + multi-row), which is the observable
 * proxy for the bound — it is NOT a memory measurement. The dominant memory term
 * (full file buffer + extracted text) is contained by the concurrency guard, not
 * by batching; see node-knowledge-ingest-concurrency.test.ts and PLAN.md Slice 2.
 *
 * 60 single-chunk pages -> 60 chunks -> 2 inserts (50 + 10).
 */

const PAGES = 60; // > BATCH_ROWS (50) so we cross a batch boundary
const captured: { sql: string; params: unknown[] }[] = [];

vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({})),
  extractText: vi.fn(async () => ({
    // Each page is short enough to yield exactly one chunk.
    text: Array.from({ length: PAGES }, (_, i) => `Page ${i + 1}: fault note ZX-${i}.`),
  })),
}));

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(
    async (_tenantId: string, fn: (c: { query: (sql: string, params: unknown[]) => Promise<{ rows: [] }> }) => Promise<unknown>) =>
      fn({
        query: async (sql: string, params: unknown[]) => {
          captured.push({ sql, params });
          return { rows: [] as [] };
        },
      }),
  ),
}));

const countTuples = (sql: string) => (sql.match(/'node_attachment'/g) ?? []).length;

describe("writePdfChunksForNode batches inserts (memory bound)", () => {
  beforeEach(() => {
    captured.length = 0;
  });

  it("flushes at most BATCH_ROWS per multi-row INSERT and returns the chunk count", async () => {
    const { writePdfChunksForNode } = await import("../node-knowledge-ingest");
    const count = await writePdfChunksForNode({
      tenantId: "tenant-a",
      uploadId: "upload-1",
      nodeId: "node-1",
      unsPath: "enterprise.site.line.press",
      filename: "big-manual.pdf",
      buffer: Buffer.from("%PDF-1.4 stub"),
    });

    const inserts = captured.filter((c) => c.sql.includes("INSERT INTO knowledge_entries"));

    // 60 chunks at BATCH_ROWS=50 -> two flushes, NOT 60 single-row inserts.
    expect(inserts).toHaveLength(2);
    expect(countTuples(inserts[0].sql)).toBe(50);
    expect(countTuples(inserts[1].sql)).toBe(10);

    // Bounded param count: 3 fixed (tenant/url/doc) + 4 per row.
    expect(inserts[0].params).toHaveLength(3 + 50 * 4);
    expect(inserts[1].params).toHaveLength(3 + 10 * 4);

    // Generated-chunk count (matches historical rows.length semantics).
    expect(count).toBe(PAGES);
  });
});
