import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * New-ingest cross-page overlap: when page N's last chunk ends mid-passage,
 * page N+1's first chunk is prefixed with that tail so a page-break split is
 * searchable without re-ingesting existing manuals.
 */

const captured: { sql: string; params: unknown[] }[] = [];

vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({})),
  extractText: vi.fn(async () => ({
    text: [
      "The CAN expansion bus between a TM172 controller and its expansions is terminated",
      "with a 120 ohm resistor at each end of the bus.",
    ],
  })),
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

describe("writePdfChunksForNode cross-page overlap (new ingests only)", () => {
  beforeEach(() => {
    captured.length = 0;
  });

  it("prefixes the next page's first chunk with the truncated previous-page tail", async () => {
    const { writePdfChunksForNode } = await import("../node-knowledge-ingest");
    await writePdfChunksForNode({
      tenantId: "tenant-a",
      uploadId: "upload-overlap-1",
      nodeId: "node-1",
      unsPath: "enterprise.site.line.cell",
      filename: "tm172.pdf",
      buffer: Buffer.from("%PDF-1.4 stub"),
    });

    const insert = captured.find((c) => c.sql.includes("INSERT INTO knowledge_entries"));
    expect(insert, "no knowledge_entries INSERT was issued").toBeTruthy();
    const contents = insert!.params.filter((p) => typeof p === "string") as string[];
    const page2 = contents.find((c) => c.includes("120 ohm resistor"));
    expect(page2).toBeTruthy();
    expect(page2).toContain("terminated");
    expect(page2).toContain("120 ohm resistor");
  });
});
