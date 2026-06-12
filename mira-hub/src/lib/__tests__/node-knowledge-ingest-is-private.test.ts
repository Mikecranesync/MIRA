import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * #1903 regression — node-attachment chunks MUST be written is_private = true.
 *
 * A PDF attached to a namespace node is a PER-TENANT upload, not shared OEM
 * corpus. Per `.claude/rules/knowledge-entries-tenant-scoping.md`, a per-tenant
 * row left is_private = false (the column default) leaks to every other tenant
 * through the hybrid read filter `(is_private = false OR tenant_id = $caller)`
 * and the universal library/aggregate surfaces (#1833). This test mocks the DB
 * client and unpdf, runs the real writePdfChunksForNode, and asserts the chunk
 * INSERT pins is_private = true (so removing it fails loudly, no DB required).
 */

const captured: { sql: string; params: unknown[] }[] = [];

vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({})),
  extractText: vi.fn(async () => ({
    text: ["Fault ZX-451 — recalibrate the PT-7 pressure transducer."],
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

describe("#1903 node-attachment chunks are is_private = true", () => {
  beforeEach(() => {
    captured.length = 0;
  });

  it("the knowledge_entries INSERT pins is_private = true", async () => {
    const { writePdfChunksForNode } = await import("../node-knowledge-ingest");
    const count = await writePdfChunksForNode({
      tenantId: "tenant-a",
      uploadId: "upload-1",
      nodeId: "node-1",
      unsPath: "enterprise.site.line.press",
      filename: "zephyr.pdf",
      buffer: Buffer.from("%PDF-1.4 stub"),
    });

    expect(count).toBeGreaterThan(0);
    const insert = captured.find((c) => c.sql.includes("INSERT INTO knowledge_entries"));
    expect(insert, "no knowledge_entries INSERT was issued").toBeTruthy();

    // Column list includes is_private, and it is the literal `true` (not a default,
    // not a bound param that could be flipped).
    expect(insert!.sql).toMatch(/\bis_private\b/);
    expect(insert!.sql).toMatch(/'v2',\s*\$7,\s*\$7,\s*\$8,\s*true\b/);
    // Belt + suspenders: the params never carry a `false` for privacy.
    expect(insert!.params).not.toContain(false);
  });
});
