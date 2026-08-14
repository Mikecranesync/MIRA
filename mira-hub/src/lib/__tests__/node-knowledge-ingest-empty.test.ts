import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ARPK Phase 1c — a scanned/image-only PDF must FAIL loudly, not "succeed"
 * with zero chunks.
 *
 * unpdf extracts no text from an image-only PDF, chunkText returns [] for every
 * page, and the old path reported the upload `parsed` / `indexed:true` with
 * chunkCount 0 — a document that silently can never be cited. PRD
 * (2026-08-10-prd-agent-readable-product-knowledge-t2108.md § "Ingestion fixes
 * required"): "Honest failure if no usable content is extracted" / "Never
 * report success while required representations are missing."
 */

const captured: { sql: string; params: unknown[] }[] = [];

vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({})),
  // Three pages, none with extractable text — the scanned-manual shape.
  extractText: vi.fn(async () => ({ text: ["", "   ", "\n\n"] })),
}));

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(
    async (
      _tenantId: string,
      fn: (c: { query: (sql: string, params: unknown[]) => Promise<{ rows: [] }> }) => Promise<unknown>,
    ) =>
      fn({
        query: async (sql: string, params: unknown[]) => {
          captured.push({ sql, params });
          return { rows: [] as [] };
        },
      }),
  ),
}));

describe("zero extractable text is an honest failure", () => {
  beforeEach(() => {
    captured.length = 0;
  });

  it("writePdfChunksForNode throws NoExtractableTextError and inserts nothing", async () => {
    const { writePdfChunksForNode, NoExtractableTextError } = await import(
      "../node-knowledge-ingest"
    );
    await expect(
      writePdfChunksForNode({
        tenantId: "tenant-a",
        uploadId: "upload-1",
        nodeId: "node-1",
        unsPath: "inbox",
        filename: "scanned.pdf",
        buffer: Buffer.from("%PDF-1.4 stub"),
      }),
    ).rejects.toBeInstanceOf(NoExtractableTextError);

    const inserts = captured.filter((c) => c.sql.includes("INSERT INTO knowledge_entries"));
    expect(inserts).toHaveLength(0);
  });

  it("writeTextChunksForNode throws on a whitespace-only text file", async () => {
    const { writeTextChunksForNode, NoExtractableTextError } = await import(
      "../node-knowledge-ingest"
    );
    await expect(
      writeTextChunksForNode({
        tenantId: "tenant-a",
        uploadId: "upload-2",
        nodeId: "node-1",
        unsPath: "inbox",
        filename: "empty.md",
        buffer: Buffer.from("   \n\n  "),
      }),
    ).rejects.toBeInstanceOf(NoExtractableTextError);
  });

  it("the error message names the cause so friendlyIngestError can surface it", async () => {
    const { writePdfChunksForNode } = await import("../node-knowledge-ingest");
    await expect(
      writePdfChunksForNode({
        tenantId: "tenant-a",
        uploadId: "upload-3",
        nodeId: "node-1",
        unsPath: "inbox",
        filename: "scanned.pdf",
        buffer: Buffer.from("%PDF-1.4 stub"),
      }),
    ).rejects.toThrow(/no extractable text/i);
  });
});
