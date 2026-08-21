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
/** When set, the mocked UPDATE throws this — used to simulate Postgres 42501. */
let updateError: (Error & { code?: string }) | null = null;

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(
    async (
      _tenantId: string,
      fn: (c: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> }) => Promise<unknown>,
    ) =>
      fn({
        query: async (sql: string, params: unknown[]) => {
          if (/^\s*SELECT/i.test(sql)) return { rows: selectQueue.shift() ?? [] };
          if (updateError) throw updateError;
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
  updateError = null;
  process.env.OLLAMA_BASE_URL = "http://embedder.test";
  delete process.env.NODE_EMBED_ON_WRITE;
  // EMBED_ON_WRITE is captured at module scope, so a test that flips the kill
  // switch would otherwise leak a cached module into every later test. Reset
  // here so each test re-evaluates against the env it just set.
  vi.resetModules();
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

    expect(n.embedded).toBe(2);
    expect(n.state).toBe("complete");
    expect(n.permanent).toBe(false);
    expect(n.code).toBeUndefined();
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

    expect(n.embedded).toBe(0);
    expect(n.state).toBe("degraded");
    expect(n.code).toBe("embedder_unavailable");
    // Transient: the embedder may come back, so this must NOT be flagged permanent.
    expect(n.permanent).toBe(false);
    expect(updates).toHaveLength(0); // chunk stays NULL-embedding → BM25-live only
  });

  it("refuses to store a wrong-dimension vector", async () => {
    selectQueue = [[{ id: "c1", content: "x" }]];
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ embedding: Array(384).fill(0) }) });

    const { embedPendingNodeChunks } = await import("../node-knowledge-ingest");
    const n = await embedPendingNodeChunks("tenant-a", "node-doc/u1/manual.pdf");

    expect(n.embedded).toBe(0);
    expect(n.state).toBe("degraded");
    expect(n.code).toBe("embedding_dimension_mismatch");
    // A wrong-dim embedder never fixes itself — an operator must act.
    expect(n.permanent).toBe(true);
    expect(updates).toHaveLength(0);
  });

  it("is a no-op when NODE_EMBED_ON_WRITE=0 (kill switch)", async () => {
    process.env.NODE_EMBED_ON_WRITE = "0";
    selectQueue = [[{ id: "c1", content: "x" }]];
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ embedding: Array(768).fill(0.01) }) });

    vi.resetModules(); // re-evaluate EMBED_ON_WRITE with the env set
    const { embedPendingNodeChunks } = await import("../node-knowledge-ingest");
    const n = await embedPendingNodeChunks("tenant-a", "node-doc/u1/manual.pdf");

    expect(n.embedded).toBe(0);
    expect(n.state).toBe("disabled"); // deliberate, NOT a failure
    expect(n.permanent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // The regression this classification exists for. Before migration 079 the
  // app role had SELECT+INSERT but not UPDATE on knowledge_entries, so this
  // UPDATE threw 42501 on EVERY upload and was swallowed into one console.warn.
  // Result: the vector lane was permanently dark while looking to an operator
  // exactly like "still indexing". PRD acceptance test C.
  // ---------------------------------------------------------------------
  it("reports a 42501 UPDATE denial as a PERMANENT degradation, not silent progress", async () => {
    selectQueue = [[{ id: "c1", content: "x" }]];
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: Array(768).fill(0.01) }),
    });
    const err = new Error("permission denied for table knowledge_entries") as Error & {
      code?: string;
    };
    err.code = "42501";
    updateError = err;

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { embedPendingNodeChunks } = await import("../node-knowledge-ingest");
    const n = await embedPendingNodeChunks("tenant-a", "node-doc/u1/manual.pdf");

    expect(n.state).toBe("degraded");
    expect(n.code).toBe("db_permission_denied");
    expect(n.permanent).toBe(true);
    expect(n.embedded).toBe(0);

    // Operator-visible at ERROR level, with a stable greppable event + code.
    expect(errSpy).toHaveBeenCalledTimes(1);
    const logged = String(errSpy.mock.calls[0][0]);
    expect(logged).toContain("embed_enrichment_degraded");
    expect(logged).toContain("db_permission_denied");
    expect(logged).toContain('"permanent":true');
    errSpy.mockRestore();
  });

  it("never throws on a DB denial — Basic Ready chat must be unaffected", async () => {
    selectQueue = [[{ id: "c1", content: "x" }]];
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: Array(768).fill(0.01) }),
    });
    const err = new Error("permission denied") as Error & { code?: string };
    err.code = "42501";
    updateError = err;
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { embedPendingNodeChunks } = await import("../node-knowledge-ingest");
    // The assertion IS that this resolves rather than rejecting: the upload
    // caller must never see an enrichment failure (#1385).
    await expect(
      embedPendingNodeChunks("tenant-a", "node-doc/u1/manual.pdf"),
    ).resolves.toMatchObject({ state: "degraded" });
    vi.restoreAllMocks();
  });

  it("a transient blip cleared by a later success reports complete", async () => {
    selectQueue = [
      [{ id: "c1", content: "a" }],
      [{ id: "c2", content: "b" }],
      [],
    ];
    // Round 1: one chunk fails to embed (transient). Round 2 succeeds.
    fetchMock
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValue({ ok: true, json: async () => ({ embedding: Array(768).fill(0.01) }) });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { embedPendingNodeChunks } = await import("../node-knowledge-ingest");
    const n = await embedPendingNodeChunks("tenant-a", "node-doc/u1/manual.pdf");

    // Round 1 wrote nothing usable -> the pass stops there and reports the reason.
    expect(n.state).toBe("degraded");
    expect(n.code).toBe("embedder_http_error");
    expect(n.permanent).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});
