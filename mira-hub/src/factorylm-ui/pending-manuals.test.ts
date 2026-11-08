/** #5302: a manual still being read when the setup sheet closes is not abandoned. Fake fetch only; no DOM. */
import { describe, expect, it, vi } from "vitest";
import { createNewProjectSetup, type SetupDeps } from "./new-project-setup-logic";
import { checkPendingManuals, filedManuals } from "./pending-manuals";

type Call = { method: string; path: string; body?: unknown };
type Reply = { status: number; body: Record<string, unknown> };

function harness(routes: Record<string, Reply | ((call: Call) => Reply)>) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const call = { method, path, body };
    calls.push(call);
    const key = Object.keys(routes).find((k) => { const [m, p] = k.split(" "); return m === method && path.startsWith(p!); });
    if (!key) throw new Error(`unexpected request ${method} ${path}`);
    const route = routes[key]!;
    const reply = typeof route === "function" ? route(call) : route;
    return { status: reply.status, ok: reply.status >= 200 && reply.status < 300, json: async () => reply.body } as Response;
  });
  return { calls, fetch: fetchFn as unknown as typeof fetch };
}
const deps = (f: typeof fetch): SetupDeps => ({ fetch: f, apiBase: "", createNotebook: async () => "nb-g", sleep: async () => {} });
// The real GET /api/namespace/node/{id}/files/ direct-row shape (route.ts strips upload_id).
const pdf = (patch: Record<string, unknown>) => ({ id: "f-202", filename: "manual.pdf", mime_type: "application/pdf", size_bytes: 1024, source: "direct", created_at: "2026-11-08T10:00:05.000Z", verified: false, indexed: false, ...patch });
// The real GET /api/files/{fileId} shape: the document id is file.uploadId.
const fileLookup = (id: string, uploadId: string | null): Reply => ({ status: 200, body: { file: { id, uploadId }, links: [] } });
const attaches = (calls: Call[]) => calls.filter((c) => c.method === "POST" && c.path.includes("/sources/"));

describe("#5302 setup hands a still-reading manual to the project", () => {
  it("CHARLIE's sequence: 202, Open before indexing, sheet disposed; the host learns which file to follow", async () => {
    const handed: Array<[string, string[]]> = [];
    const h = harness({
      "GET /api/equipment-notebooks/nb-g/": { status: 200, body: { notebook: { nodeId: "node-g" }, sources: [] } },
      "POST /api/namespace/node/node-g/files/": { status: 202, body: { ok: true, indexed: false, indexing: true, fileId: "f-202" } },
      "GET /api/files/f-202": { status: 200, body: { file: { id: "f-202", uploadId: null } } },
    });
    const c = createNewProjectSetup({ ...deps(h.fetch), getNotebooks: () => [], onPendingManuals: (nb, ids) => handed.push([nb, ids]) });
    await c.choose({ kind: "general" });
    c.setName("Bench");
    await c.next();
    c.addPdfs([new File(["%PDF"], "manual.pdf", { type: "application/pdf" })]);
    const committing = c.commit();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(c.getState().rows[0]?.readiness.label).toBe("Processing");
    expect(c.openProjectId()).toBe("nb-g");
    c.dispose(); // Open project closes the sheet
    await committing;
    expect(handed).toEqual([["nb-g", ["f-202"]]]);
    // The sheet itself still writes nothing after it closed.
    expect(attaches(h.calls)).toHaveLength(0);
  });

  it("control: a commit with no still-reading file hands nothing over", async () => {
    const handed: unknown[] = [];
    const h = harness({
      "GET /api/equipment-notebooks/nb-g/": { status: 200, body: { notebook: { nodeId: "node-g" }, sources: [] } },
    });
    const c = createNewProjectSetup({ ...deps(h.fetch), getNotebooks: () => [], onPendingManuals: (nb, ids) => handed.push([nb, ids]) });
    await c.choose({ kind: "general" });
    c.setName("Bench");
    await c.next();
    await c.commit();
    expect(handed).toEqual([]);
  });
});

describe("#5302 pending manuals derived from the project's own files", () => {
  it("contract: real node-file rows carry no upload_id; a filed PDF that is not a source is listed by filing", () => {
    expect(pdf({})).not.toHaveProperty("upload_id");
    expect(filedManuals({ files: [pdf({}), pdf({ id: "f-2", indexed: true })] }, [])).toEqual([
      { fileId: "f-202", filename: "manual.pdf", indexed: false },
      { fileId: "f-2", filename: "manual.pdf", indexed: true },
    ]);
  });

  it("a file already a source by file id is not listed", () => {
    expect(filedManuals({ files: [pdf({ indexed: true })] }, [{ docId: "other", fileId: "f-202" }])).toEqual([]);
  });

  it("an older stored file filed on this project is still listed (identical bytes reuse an older file)", () => {
    expect(filedManuals({ files: [pdf({ created_at: "2025-01-01T00:00:00.000Z" })] }, [])).toHaveLength(1);
  });

  it("ignores non-PDFs, legacy upload rows and malformed rows", () => {
    const body = { files: [pdf({ id: "img", mime_type: "image/jpeg" }), pdf({ id: "legacy", source: "upload" }), { id: 5 }, null] };
    expect(filedManuals(body, [])).toEqual([]);
    expect(filedManuals({ nope: true }, [])).toEqual([]);
  });
});

describe("#5302 following a pending manual after the sheet closed", () => {
  const input = (approved: string[], sources: Array<{ docId: string; fileId: string | null }> = []) => ({ notebookId: "nb-g", nodeId: "node-g", sources, approved: new Set(approved) });
  const NODE = "GET /api/namespace/node/node-g/files/";
  const SRC = "POST /api/equipment-notebooks/nb-g/sources/";

  it("eventual attachment: reading first, then resolved through the file lookup and attached exactly once", async () => {
    let reads = 0;
    const h = harness({
      [NODE]: () => { reads++; return { status: 200, body: { files: [pdf({ indexed: reads >= 2 })] } }; },
      "GET /api/files/f-202": fileLookup("f-202", "up-late"),
      [SRC]: { status: 201, body: { ok: true } },
    });
    const first = await checkPendingManuals(input(["f-202"]), deps(h.fetch));
    expect(first).toMatchObject({ ok: true, attached: [], pending: [{ state: "reading" }] });
    expect(attaches(h.calls)).toHaveLength(0);
    const second = await checkPendingManuals(input(["f-202"]), deps(h.fetch));
    expect(second.attached).toEqual(["f-202"]);
    expect(second.pending).toEqual([]);
    expect(attaches(h.calls)).toEqual([{ method: "POST", path: "/api/equipment-notebooks/nb-g/sources/", body: { docId: "up-late", sourceRole: "manual" } }]);
  });

  it("indexed but not yet linked: the file lookup says uploadId null, so it stays reading and nothing is written", async () => {
    const h = harness({ [NODE]: { status: 200, body: { files: [pdf({ indexed: true })] } }, "GET /api/files/f-202": fileLookup("f-202", null) });
    const r = await checkPendingManuals(input(["f-202"]), deps(h.fetch));
    expect(r.pending).toEqual([{ fileId: "f-202", filename: "manual.pdf", docId: null, state: "reading" }]);
    expect(attaches(h.calls)).toHaveLength(0);
  });

  it("reused older file (F2): approved this session, stored before the project, attached once indexing finishes", async () => {
    const h = harness({
      [NODE]: { status: 200, body: { files: [pdf({ created_at: "2025-01-01T00:00:00.000Z", indexed: true })] } },
      "GET /api/files/f-202": fileLookup("f-202", "up-old"),
      [SRC]: { status: 201, body: { ok: true } },
    });
    const r = await checkPendingManuals(input(["f-202"]), deps(h.fetch));
    expect(r.attached).toEqual(["f-202"]);
    expect(attaches(h.calls)).toHaveLength(1);
  });

  it("reused older file after a reload: offered for an explicit Add, never attached", async () => {
    const h = harness({
      [NODE]: { status: 200, body: { files: [pdf({ created_at: "2025-01-01T00:00:00.000Z", indexed: true })] } },
      "GET /api/files/f-202": fileLookup("f-202", "up-old"),
    });
    const r = await checkPendingManuals(input([]), deps(h.fetch));
    expect(r.pending).toEqual([{ fileId: "f-202", filename: "manual.pdf", docId: "up-old", state: "readable" }]);
    expect(attaches(h.calls)).toHaveLength(0);
  });

  it("a file whose document is already a source is not pending", async () => {
    const h = harness({ [NODE]: { status: 200, body: { files: [pdf({ indexed: true })] } }, "GET /api/files/f-202": fileLookup("f-202", "up-1") });
    const r = await checkPendingManuals(input(["f-202"], [{ docId: "up-1", fileId: null }]), deps(h.fetch));
    expect(r.pending).toEqual([]);
    expect(attaches(h.calls)).toHaveLength(0);
  });

  it("a file deleted since (lookup 404) is dropped; a failed lookup keeps it reading", async () => {
    const gone = harness({ [NODE]: { status: 200, body: { files: [pdf({ indexed: true })] } }, "GET /api/files/f-202": { status: 404, body: { error: "not_found" } } });
    expect((await checkPendingManuals(input(["f-202"]), deps(gone.fetch))).pending).toEqual([]);
    const busy = harness({ [NODE]: { status: 200, body: { files: [pdf({ indexed: true })] } }, "GET /api/files/f-202": { status: 503, body: {} } });
    const r = await checkPendingManuals(input(["f-202"]), deps(busy.fetch));
    expect(r).toMatchObject({ ok: true, pending: [{ state: "reading", docId: null }] });
    expect(attaches(busy.calls)).toHaveLength(0);
  });

  it("explicit approval: a readable file the technician never approved is offered, never attached", async () => {
    const h = harness({ [NODE]: { status: 200, body: { files: [pdf({ indexed: true })] } }, "GET /api/files/f-202": fileLookup("f-202", "up-1") });
    const r = await checkPendingManuals(input([]), deps(h.fetch));
    expect(r.pending).toEqual([{ fileId: "f-202", filename: "manual.pdf", docId: "up-1", state: "readable" }]);
    expect(attaches(h.calls)).toHaveLength(0);
  });

  it("a refused attach stays pending with a reason, not silently dropped", async () => {
    const h = harness({
      [NODE]: { status: 200, body: { files: [pdf({ indexed: true })] } },
      "GET /api/files/f-202": fileLookup("f-202", "up-1"),
      [SRC]: { status: 404, body: { error: "doc_not_found" } },
    });
    const r = await checkPendingManuals(input(["f-202"]), deps(h.fetch));
    expect(r.attached).toEqual([]);
    expect(r.failed).toEqual([{ fileId: "f-202", message: "Couldn't be added as a source. Try again." }]);
    expect(r.pending).toEqual([{ fileId: "f-202", filename: "manual.pdf", docId: "up-1", state: "readable" }]);
  });

  it("retry: a refused attach is tried again on the next check and lands exactly once", async () => {
    let posts = 0;
    const h = harness({
      [NODE]: { status: 200, body: { files: [pdf({ indexed: true })] } },
      "GET /api/files/f-202": fileLookup("f-202", "up-1"),
      [SRC]: () => (++posts === 1 ? { status: 503, body: { error: "busy" } } : { status: 201, body: { ok: true } }),
    });
    const first = await checkPendingManuals(input(["f-202"]), deps(h.fetch));
    expect(first.failed).toHaveLength(1);
    const second = await checkPendingManuals(input(["f-202"]), deps(h.fetch));
    expect(second).toMatchObject({ ok: true, attached: ["f-202"], failed: [] });
    expect(attaches(h.calls)).toHaveLength(2);
  });

  it("wrong project: a file approved for another project is not attached here", async () => {
    const h = harness({ [NODE]: { status: 200, body: { files: [pdf({ id: "f-mine", indexed: true })] } }, "GET /api/files/f-mine": fileLookup("f-mine", "up-mine") });
    const r = await checkPendingManuals(input(["f-202"]), deps(h.fetch));
    expect(r.pending.map((p) => p.fileId)).toEqual(["f-mine"]);
    expect(attaches(h.calls)).toHaveLength(0);
  });

  it("an interrupted network read reports not-ok and writes nothing", async () => {
    const h = harness({ [NODE]: () => { throw new TypeError("Failed to fetch"); } });
    const r = await checkPendingManuals(input(["f-202"]), deps(h.fetch));
    expect(r).toMatchObject({ ok: false, attached: [] });
    expect(attaches(h.calls)).toHaveLength(0);
  });

  it("a stale check stops before writing once the project is no longer open", async () => {
    const h = harness({ [NODE]: { status: 200, body: { files: [pdf({ indexed: true })] } }, "GET /api/files/f-202": fileLookup("f-202", "up-1"), [SRC]: { status: 201, body: { ok: true } } });
    const r = await checkPendingManuals(input(["f-202"]), deps(h.fetch), () => true);
    expect(r.ok).toBe(false);
    expect(attaches(h.calls)).toHaveLength(0);
  });

  it("a project switched away during a file lookup reads no further files and writes nothing", async () => {
    let switched = false;
    const h = harness({
      [NODE]: { status: 200, body: { files: [pdf({ indexed: true }), pdf({ id: "f-2", indexed: true })] } },
      "GET /api/files/f-202": () => { switched = true; return fileLookup("f-202", "up-1"); },
      "GET /api/files/f-2": fileLookup("f-2", "up-2"),
      [SRC]: { status: 201, body: { ok: true } },
    });
    const r = await checkPendingManuals(input(["f-202", "f-2"]), deps(h.fetch), () => switched);
    expect(h.calls.filter((c) => c.path.startsWith("/api/files/")).map((c) => c.path)).toEqual(["/api/files/f-202"]);
    expect(r.ok).toBe(false);
    expect(attaches(h.calls)).toHaveLength(0);
  });

  it("a project switched away after the lookup, but before the attach, gets no write", async () => {
    const h = harness({ [NODE]: { status: 200, body: { files: [pdf({ indexed: true })] } }, "GET /api/files/f-202": fileLookup("f-202", "up-1"), [SRC]: { status: 201, body: { ok: true } } });
    let checks = 0;
    const r = await checkPendingManuals(input(["f-202"]), deps(h.fetch), () => ++checks > 2);
    expect(checks).toBeGreaterThan(2);
    expect(r.ok).toBe(false);
    expect(attaches(h.calls)).toHaveLength(0);
  });

  it("control: a project still open is attached", async () => {
    const h = harness({ [NODE]: { status: 200, body: { files: [pdf({ indexed: true })] } }, "GET /api/files/f-202": fileLookup("f-202", "up-1"), [SRC]: { status: 201, body: { ok: true } } });
    const r = await checkPendingManuals(input(["f-202"]), deps(h.fetch), () => false);
    expect(r).toMatchObject({ ok: true, attached: ["f-202"] });
    expect(r.filenames).toEqual({ "f-202": "manual.pdf" });
    expect(attaches(h.calls)).toHaveLength(1);
  });
});
