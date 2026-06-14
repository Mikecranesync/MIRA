import { describe, it, expect, vi } from "vitest";

/**
 * Slice 1 concurrency guard — with the default NODE_INGEST_CONCURRENCY=1, a
 * second writePdfChunksForNode must NOT begin parsing (the in-memory PDF peak)
 * until the first releases its slot. This is what actually contains the dominant
 * memory term on the 8 GB VPS; per-page batching does not.
 *
 * We gate extractText on a manually-resolved promise to observe ordering: the
 * second call's extractText must not fire while the first is still parsing.
 */

let extractCalls = 0;
const gates: Array<() => void> = [];

vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({})),
  extractText: vi.fn(async () => {
    extractCalls++;
    await new Promise<void>((resolve) => gates.push(resolve)); // block until released
    return { text: ["one chunk only"] };
  }),
}));

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(
    async (_tenantId: string, fn: (c: { query: () => Promise<{ rows: [] }> }) => Promise<unknown>) =>
      fn({ query: async () => ({ rows: [] as [] }) }),
  ),
}));

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("writePdfChunksForNode serializes parses (NODE_INGEST_CONCURRENCY=1)", () => {
  it("does not start the second parse until the first releases", async () => {
    const { writePdfChunksForNode } = await import("../node-knowledge-ingest");
    const args = (id: string) => ({
      tenantId: "t",
      uploadId: id,
      nodeId: "n",
      unsPath: null,
      filename: `${id}.pdf`,
      buffer: Buffer.from("x"),
    });

    const p1 = writePdfChunksForNode(args("u1"));
    const p2 = writePdfChunksForNode(args("u2"));

    await tick();
    expect(extractCalls).toBe(1); // second is blocked on the semaphore

    gates.shift()!(); // release the first parse
    await tick();
    expect(extractCalls).toBe(2); // now the second proceeds

    gates.shift()!(); // release the second
    await expect(Promise.all([p1, p2])).resolves.toEqual([1, 1]);
  });
});
