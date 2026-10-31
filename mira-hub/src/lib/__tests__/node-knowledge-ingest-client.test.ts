import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Optional client / deferEmbed on writeChunkRowsForNode — the one-off
 * #4859 rechunk script shares ONE transaction (DELETE then insert) and
 * must embed only after COMMIT. Default callers are unchanged: no client
 * → withTenantContext; no deferEmbed → fire-and-forget embed.
 */

const captured: { sql: string }[] = [];
const withTenant = vi.fn(
  async (
    _tenantId: string,
    fn: (c: { query: (sql: string, params?: unknown[]) => Promise<{ rows: [] }> }) => Promise<unknown>,
  ) =>
    fn({
      query: async (sql: string) => {
        captured.push({ sql });
        return { rows: [] as [] };
      },
    }),
);
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: (tenantId: string, fn: never) => withTenant(tenantId, fn),
}));

vi.mock("@/lib/db", () => ({ default: { query: vi.fn(), end: vi.fn(), connect: vi.fn() } }));

describe("writeChunkRowsForNode shared-transaction hook", () => {
  beforeEach(() => {
    captured.length = 0;
    withTenant.mockClear();
  });

  it("uses the provided client and does not open withTenantContext even without deferEmbed", async () => {
    const { writeChunkRowsForNode } = await import("../node-knowledge-ingest");
    const clientSql: string[] = [];
    const client = {
      query: async (sql: string) => {
        clientSql.push(sql);
        return { rows: [] as [] };
      },
    };
    const n = await writeChunkRowsForNode(
      ["Fault ZX-451 — recalibrate the PT-7 pressure transducer."],
      {
        tenantId: "tenant-a",
        uploadId: "upload-1",
        nodeId: "node-1",
        unsPath: "inbox",
        filename: "note.pdf",
      },
      undefined,
      { client },
    );
    expect(n).toBe(1);
    // client implies deferEmbed: embedPendingNodeChunks uses withTenantContext,
    // so a leaked fire-and-forget embed would show up as a withTenant call.
    expect(withTenant).not.toHaveBeenCalled();
    expect(clientSql.some((s) => /INSERT INTO knowledge_entries/.test(s))).toBe(true);
    expect(clientSql.join(" ")).toMatch(/,\s*true\)/);
  });

  it("control: the default path still opens withTenantContext", async () => {
    const { writeChunkRowsForNode } = await import("../node-knowledge-ingest");
    const n = await writeChunkRowsForNode(
      ["Fault ZX-451 — recalibrate the PT-7 pressure transducer."],
      {
        tenantId: "tenant-a",
        uploadId: "upload-1",
        nodeId: "node-1",
        unsPath: "inbox",
        filename: "note.pdf",
      },
    );
    expect(n).toBe(1);
    expect(withTenant).toHaveBeenCalled();
    expect(captured.some((c) => /INSERT INTO knowledge_entries/.test(c.sql))).toBe(true);
  });
});
