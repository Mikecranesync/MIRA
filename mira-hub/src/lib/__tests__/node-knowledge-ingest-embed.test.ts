import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * embedPendingNodeChunks (#2099) — best-effort embed-on-write for node-attachment
 * chunks so they reach the KB vector ranker, with the #1385 resilience guarantee:
 * a down/wrong embedder leaves chunks BM25-only and NEVER throws.
 *
 * The DB is mocked: SELECTs are served from a per-test queue; UPDATEs are captured.
 * The embedder (global fetch) is mocked per test.
 */

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

let selectQueue: Array<Array<{ id: string; content: string }>> = [];
const updates: { sql: string; params: unknown[] }[] = [];

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(
    async (
      _tenantId: string,
      fn: (c: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> }) => Promise<unknown>,
    ) =>
      fn({
        query: async (sql: string, params: unknown[]) => {
          if (/^\s*SELECT/i.test(sql)) return { rows: selectQueue.shift() ?? [] };
          updates.push({ sql, params });
          return { rows: [] };
        },
      }),
  ),
}));

beforeEach(() => {
  fetchMock.mockReset();
  updates.length = 0;
  selectQueue = [];
  process.env.OLLAMA_BASE_URL = "http://embedder.test";
  delete process.env.NODE_EMBED_ON_WRITE;
});

describe("embedPendingNodeChunks", () => {
  it("embeds pending chunks and UPDATEs a 768-dim vector", async () => {
    selectQueue = [
      [
        { id: "c1", content: "press fault note" },
        { id: "c2", content: "wiring diagram" },
      ],
      [], // second round terminates the loop
    ];
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: Array(768).fill(0.01) }),
    });

    const { embedPendingNodeChunks } = await import("../node-knowledge-ingest");
    const n = await embedPendingNodeChunks("tenant-a", "node-doc/u1/manual.pdf");

    expect(n).toBe(2);
    expect(updates).toHaveLength(2);
    expect(updates[0].sql).toMatch(/UPDATE knowledge_entries SET embedding/);
    const vecParam = updates[0].params[1] as string;
    expect(vecParam.startsWith("[")).toBe(true);
    expect(vecParam.split(",")).toHaveLength(768);
  });

  it("never throws and writes nothing when the embedder is unreachable (#1385 resilience)", async () => {
    selectQueue = [[{ id: "c1", content: "x" }]];
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const { embedPendingNodeChunks } = await import("../node-knowledge-ingest");
    const n = await embedPendingNodeChunks("tenant-a", "node-doc/u1/manual.pdf");

    expect(n).toBe(0);
    expect(updates).toHaveLength(0); // chunk stays NULL-embedding → BM25-live only
  });

  it("refuses to store a wrong-dimension vector", async () => {
    selectQueue = [[{ id: "c1", content: "x" }]];
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ embedding: Array(384).fill(0) }) });

    const { embedPendingNodeChunks } = await import("../node-knowledge-ingest");
    const n = await embedPendingNodeChunks("tenant-a", "node-doc/u1/manual.pdf");

    expect(n).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("is a no-op when NODE_EMBED_ON_WRITE=0 (kill switch)", async () => {
    process.env.NODE_EMBED_ON_WRITE = "0";
    selectQueue = [[{ id: "c1", content: "x" }]];
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ embedding: Array(768).fill(0.01) }) });

    vi.resetModules(); // re-evaluate EMBED_ON_WRITE with the env set
    const { embedPendingNodeChunks } = await import("../node-knowledge-ingest");
    const n = await embedPendingNodeChunks("tenant-a", "node-doc/u1/manual.pdf");

    expect(n).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
