import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * #2277 — text/markdown + text/plain manual uploads become CITABLE.
 *
 * writeTextChunksForNode is the sibling of writePdfChunksForNode: the bytes ARE
 * the text (no unpdf extraction), and it routes through the SAME v2 core
 * (writeChunkRowsForNode) so the per-tenant privacy + node addressing are
 * identical to the PDF path. This mocks the DB client, runs the real writer, and
 * asserts (a) the decoded text lands as knowledge_entries chunks, (b) is_private
 * = true (per-tenant, never leaks), and (c) unpdf is never touched for text.
 */

const captured: { sql: string; params: unknown[] }[] = [];

const unpdfExtract = vi.fn(async () => ({ text: ["SHOULD NOT BE CALLED"] }));
vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({})),
  extractText: unpdfExtract,
}));

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(
    async (
      _tenantId: string,
      fn: (c: {
        query: (sql: string, params: unknown[]) => Promise<{ rows: never[] }>;
      }) => Promise<unknown>,
    ) =>
      fn({
        query: async (sql: string, params: unknown[]) => {
          captured.push({ sql, params });
          return { rows: [] as never[] };
        },
      }),
  ),
}));

describe("#2277 writeTextChunksForNode makes .md/.txt citable", () => {
  beforeEach(() => {
    captured.length = 0;
    unpdfExtract.mockClear();
  });

  it("decodes UTF-8 text into node_attachment chunks, is_private = true, no unpdf", async () => {
    const { writeTextChunksForNode } = await import("../node-knowledge-ingest");
    const body =
      "# Lockout Procedure\n\nStep 1: de-energize the PT-7 transducer before service.\n" +
      "Step 2: verify zero energy state with a calibrated meter.";
    const count = await writeTextChunksForNode({
      tenantId: "tenant-a",
      uploadId: "upload-md-1",
      nodeId: "node-1",
      unsPath: "enterprise.site.line.press",
      filename: "lockout.md",
      buffer: Buffer.from(body, "utf-8"),
    });

    expect(count).toBeGreaterThan(0);
    // unpdf must never be invoked on the text path — the bytes are the text.
    expect(unpdfExtract).not.toHaveBeenCalled();

    const insert = captured.find((c) =>
      c.sql.includes("INSERT INTO knowledge_entries"),
    );
    expect(insert, "no knowledge_entries INSERT was issued").toBeTruthy();
    // Same v2 core as PDF: node_attachment rows, is_private literal true.
    expect(insert!.sql).toMatch(/'node_attachment'/);
    expect(insert!.sql).toMatch(/'v2',\s*(\$\d+),\s*\1,\s*\$\d+,\s*true\b/);
    expect(insert!.params).not.toContain(false);
    // The decoded text actually reached a chunk (citable content, not a stub).
    const joined = captured.flatMap((c) => c.params).join(" ");
    expect(joined).toContain("de-energize the PT-7 transducer");
  });
});
