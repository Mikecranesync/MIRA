/** #5302: a manual still being read when the setup sheet closes is not abandoned. Fake fetch only; no DOM. */
import { describe, expect, it, vi } from "vitest";
import { createNewProjectSetup, type SetupDeps } from "./new-project-setup-logic";
import { checkPendingManuals, pendingManuals } from "./pending-manuals";

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
const created = "2026-11-08T10:00:00.000Z";
const pdf = (patch: Record<string, unknown>) => ({ id: "f-202", filename: "manual.pdf", mime_type: "application/pdf", source: "direct", created_at: "2026-11-08T10:00:05.000Z", upload_id: null, ...patch });
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
  it("a PDF saved for this project and not yet read is 'reading'; once read and not a source it is 'readable'", () => {
    expect(pendingManuals({ files: [pdf({})] }, [], created)).toEqual([{ fileId: "f-202", filename: "manual.pdf", docId: null, state: "reading" }]);
    expect(pendingManuals({ files: [pdf({ upload_id: "up-1" })] }, [], created)).toEqual([{ fileId: "f-202", filename: "manual.pdf", docId: "up-1", state: "readable" }]);
  });

  it("a file that is already a source (by file id or doc id) is not pending", () => {
    expect(pendingManuals({ files: [pdf({ upload_id: "up-1" })] }, [{ docId: "up-1", fileId: null }], created)).toEqual([]);
    expect(pendingManuals({ files: [pdf({ upload_id: "up-1" })] }, [{ docId: "other", fileId: "f-202" }], created)).toEqual([]);
  });

  it("ignores files older than the project, non-PDFs and malformed rows", () => {
    const body = { files: [
      pdf({ created_at: "2026-11-08T09:00:00.000Z" }),
      pdf({ id: "img", mime_type: "image/jpeg" }),
      pdf({ id: "legacy", source: "upload" }),
      { id: 5 }, null,
    ] };
    expect(pendingManuals(body, [], created)).toEqual([]);
    expect(pendingManuals({ nope: true }, [], created)).toEqual([]);
  });
});

describe("#5302 following a pending manual after the sheet closed", () => {
  const input = (approved: string[]) => ({ notebookId: "nb-g", nodeId: "node-g", createdAt: created, sources: [], approved: new Set(approved) });

  it("eventual attachment: reading first, then attached exactly once to the project it was uploaded for", async () => {
    let reads = 0;
    const h = harness({
      "GET /api/namespace/node/node-g/files/": () => { reads++; return { status: 200, body: { files: [pdf({ upload_id: reads < 2 ? null : "up-late" })] } }; },
      "POST /api/equipment-notebooks/nb-g/sources/": { status: 201, body: { ok: true } },
    });
    const first = await checkPendingManuals(input(["f-202"]), deps(h.fetch));
    expect(first).toMatchObject({ ok: true, attached: [], pending: [{ state: "reading" }] });
    expect(attaches(h.calls)).toHaveLength(0);
    const second = await checkPendingManuals(input(["f-202"]), deps(h.fetch));
    expect(second.attached).toEqual(["f-202"]);
    expect(second.pending).toEqual([]);
    expect(attaches(h.calls)).toEqual([{ method: "POST", path: "/api/equipment-notebooks/nb-g/sources/", body: { docId: "up-late", sourceRole: "manual" } }]);
  });

  it("explicit approval: a readable file the technician never approved is offered, never attached", async () => {
    const h = harness({ "GET /api/namespace/node/node-g/files/": { status: 200, body: { files: [pdf({ upload_id: "up-1" })] } } });
    const r = await checkPendingManuals(input([]), deps(h.fetch));
    expect(r.pending).toEqual([{ fileId: "f-202", filename: "manual.pdf", docId: "up-1", state: "readable" }]);
    expect(attaches(h.calls)).toHaveLength(0);
  });

  it("a refused attach stays pending with a reason, not silently dropped", async () => {
    const h = harness({
      "GET /api/namespace/node/node-g/files/": { status: 200, body: { files: [pdf({ upload_id: "up-1" })] } },
      "POST /api/equipment-notebooks/nb-g/sources/": { status: 404, body: { error: "doc_not_found" } },
    });
    const r = await checkPendingManuals(input(["f-202"]), deps(h.fetch));
    expect(r.attached).toEqual([]);
    expect(r.failed).toEqual([{ fileId: "f-202", message: "Couldn't be added as a source. Try again." }]);
    expect(r.pending).toEqual([{ fileId: "f-202", filename: "manual.pdf", docId: "up-1", state: "readable" }]);
  });

  it("retry: a refused attach is tried again on the next check and lands exactly once", async () => {
    let posts = 0;
    const h = harness({
      "GET /api/namespace/node/node-g/files/": { status: 200, body: { files: [pdf({ upload_id: "up-1" })] } },
      "POST /api/equipment-notebooks/nb-g/sources/": () => (++posts === 1 ? { status: 503, body: { error: "busy" } } : { status: 201, body: { ok: true } }),
    });
    const first = await checkPendingManuals(input(["f-202"]), deps(h.fetch));
    expect(first.failed).toHaveLength(1);
    const second = await checkPendingManuals(input(["f-202"]), deps(h.fetch));
    expect(second).toMatchObject({ ok: true, attached: ["f-202"], failed: [] });
    expect(attaches(h.calls)).toHaveLength(2);
  });

  it("wrong project: a file approved for another project is not attached here", async () => {
    const h = harness({
      "GET /api/namespace/node/node-g/files/": { status: 200, body: { files: [pdf({ id: "f-mine", upload_id: "up-mine" })] } },
    });
    const r = await checkPendingManuals(input(["f-202"]), deps(h.fetch)); // f-202 belongs to another project
    expect(r.pending.map((p) => p.fileId)).toEqual(["f-mine"]);
    expect(attaches(h.calls)).toHaveLength(0);
  });

  it("an interrupted network read reports not-ok and writes nothing", async () => {
    const h = harness({ "GET /api/namespace/node/node-g/files/": () => { throw new TypeError("Failed to fetch"); } });
    const r = await checkPendingManuals(input(["f-202"]), deps(h.fetch));
    expect(r).toMatchObject({ ok: false, attached: [] });
    expect(attaches(h.calls)).toHaveLength(0);
  });

  it("a stale check stops before writing once the project is no longer open", async () => {
    const h = harness({
      "GET /api/namespace/node/node-g/files/": { status: 200, body: { files: [pdf({ upload_id: "up-1" })] } },
      "POST /api/equipment-notebooks/nb-g/sources/": { status: 201, body: { ok: true } },
    });
    const r = await checkPendingManuals(input(["f-202"]), deps(h.fetch), () => true);
    expect(r.ok).toBe(false);
    expect(attaches(h.calls)).toHaveLength(0);
  });

  it("a project switched away after the read, but before the attach, gets no write", async () => {
    const h = harness({
      "GET /api/namespace/node/node-g/files/": { status: 200, body: { files: [pdf({ upload_id: "up-1" })] } },
      "POST /api/equipment-notebooks/nb-g/sources/": { status: 201, body: { ok: true } },
    });
    let checks = 0;
    const r = await checkPendingManuals(input(["f-202"]), deps(h.fetch), () => ++checks > 1);
    expect(checks).toBeGreaterThan(1); // precondition: it was re-checked after the read
    expect(r.ok).toBe(false);
    expect(attaches(h.calls)).toHaveLength(0);
  });

  it("control: a project still open is attached", async () => {
    const h = harness({
      "GET /api/namespace/node/node-g/files/": { status: 200, body: { files: [pdf({ upload_id: "up-1" })] } },
      "POST /api/equipment-notebooks/nb-g/sources/": { status: 201, body: { ok: true } },
    });
    const r = await checkPendingManuals(input(["f-202"]), deps(h.fetch), () => false);
    expect(r).toMatchObject({ ok: true, attached: ["f-202"] });
    // Attached on the first check (after a reload or switch): its name is still reported.
    expect(r.filenames).toEqual({ "f-202": "manual.pdf" });
    expect(attaches(h.calls)).toHaveLength(1);
  });
});
