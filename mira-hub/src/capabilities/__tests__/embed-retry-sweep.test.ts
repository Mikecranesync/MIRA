import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { embedRetryAllPending } from "../embed-retry-sweep";

// Mock the pool module
vi.mock("@/lib/db", () => ({
  default: {
    query: vi.fn(),
  },
}));

describe("embed-retry-sweep", () => {
  let poolMock: any;

  beforeEach(() => {
    poolMock = require("@/lib/db").default;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe("embedRetryAllPending", () => {
    it("returns early when embedder produces no writable vectors", async () => {
      // Setup: no chunks to embed (empty result)
      poolMock.query.mockResolvedValueOnce({ rows: [] });

      const embedFn = vi.fn(async () => ({ vec: [0.1, 0.2] }));
      const result = await embedRetryAllPending(embedFn);

      // With no chunks, sweep completes without attempting embeds
      expect(result.chunks_attempted).toBe(0);
      expect(result.chunks_embedded).toBe(0);
      expect(result.circuit_broken_reason).toBeUndefined();
    });

    it("stops sweeping when the embedder is unavailable", async () => {
      // Setup: one chunk to embed
      poolMock.query.mockResolvedValueOnce({
        rows: [{ id: "chunk-1", content: "test content" }],
      });

      const embedFn = vi.fn(async () => ({
        code: "embedder_unavailable",
      }));

      const result = await embedRetryAllPending(embedFn);

      // Should have attempted the chunk but gotten no writable vector
      // Circuit break because zero writable vectors
      expect(result.chunks_attempted).toBe(1);
      expect(result.chunks_embedded).toBe(0);
      expect(result.circuit_broken_reason).toBe("embedder_unavailable");
    });

    it("successfully embeds chunks and updates the database", async () => {
      // Setup: two chunks, both embed successfully
      poolMock.query
        .mockResolvedValueOnce({
          rows: [
            { id: "chunk-1", content: "text 1" },
            { id: "chunk-2", content: "text 2" },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }); // next batch is empty

      const embedFn = vi.fn(async () => ({ vec: [0.1, 0.2, 0.3] }));
      const result = await embedRetryAllPending(embedFn);

      // Should have embedded both chunks
      expect(result.chunks_attempted).toBe(2);
      expect(result.chunks_embedded).toBe(2);
      expect(result.circuit_broken_reason).toBeUndefined();
      expect(embedFn).toHaveBeenCalledTimes(2);
    });

    it("respects the single-flight guarantee", async () => {
      // Setup: slow first query to test single-flight
      let resolveQuery: any;
      const queryPromise = new Promise((resolve) => {
        resolveQuery = resolve;
      });
      poolMock.query.mockReturnValueOnce(queryPromise);

      const embedFn = vi.fn();
      const promise1 = embedRetryAllPending(embedFn);
      const promise2 = embedRetryAllPending(embedFn);

      // Second call should return immediately with in-flight result
      expect(promise1).toBe(promise2);

      // Resolve the query and wait
      resolveQuery({ rows: [] });
      const result = await promise1;

      // Both calls got the same result
      expect(result.chunks_attempted).toBe(0);
    });
  });
});
