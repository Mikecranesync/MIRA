/** #4632 New project setup: pure logic, write plan and controller. Fake fetch only; no DOM. */
import { describe, expect, it, vi } from "vitest";
import {
  applicabilityLine,
  createNewProjectSetup,
  findExistingProject,
  INDEXING_CAPPED,
  linkedDocsFrom,
  machinesFromTree,
  readinessView,
  resolveIndexing,
  resultRows,
  runCommit,
  STILL_PROCESSING,
  watchReadiness,
  workspaceDocsFrom,
  type SetupDeps,
} from "./new-project-setup-logic";
import type { HubNotebook } from "./notebook-tree";
import type { Machine } from "./ScopePicker";

type Call = { method: string; path: string; body?: unknown; form?: boolean };
type Reply = { status: number; body: Record<string, unknown> };

/** Routes by "METHOD path" prefix. Unknown routes fail the test loudly. */
function harness(routes: Record<string, Reply | ((call: Call) => Reply | Promise<Reply>)>) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^\/?/, "/").replace(/^\/\//, "/");
    const method = (init?.method ?? "GET").toUpperCase();
    const isForm = init?.body instanceof FormData;
    const body = !isForm && typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const call: Call = { method, path, body, form: isForm || undefined };
    calls.push(call);
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(" ");
      return m === method && path.startsWith(p!);
    });
    if (!key) throw new Error(`unexpected request ${method} ${path}`);
    const route = routes[key]!;
    const reply = typeof route === "function" ? await route(call) : route;
    return { status: reply.status, ok: reply.status >= 200 && reply.status < 300, json: async () => reply.body } as Response;
  });
  return { calls, fetch: fetchFn as unknown as typeof fetch };
}

const nonGet = (calls: Call[]) => calls.filter((c) => c.method !== "GET");
const machine: Machine = { id: "node-cv101", name: "Discharge Conveyor", tag: "CV-101", unsPath: "enterprise.a.b.cv101", manufacturer: null, model: null, location: "Line 4" };
const deps = (fetchImpl: typeof globalThis.fetch, extra: Partial<SetupDeps> = {}): SetupDeps => ({
  fetch: fetchImpl,
  apiBase: "",
  createNotebook: async () => "nb-general",
  sleep: async () => {},
  ...extra,
});
const noSleep = { intervalMs: 0, max: 3 };

describe("readiness mapping", () => {
  it("maps every ReadinessState; ready only for the four askable states", () => {
    const ready = ["chat_ready_basic", "enhancing", "chat_ready_enhanced", "enhancement_degraded"];
    for (const s of ready) expect(readinessView({ state: s }).tone).toBe("ready");
    expect(readinessView({ state: "stored" }).label).toBe("Processing");
    expect(readinessView({ state: "uploading" }).label).toBe("Uploading");
  });
  it("fails closed: failed and needs_ocr are Needs attention, never Ready", () => {
    expect(readinessView({ state: "failed" })).toEqual({ tone: "attention", label: "Needs attention" });
    expect(readinessView({ state: "needs_ocr" })).toEqual({ tone: "attention", label: "Needs attention" });
  });
  it("unknown, null, missing or malformed states are Needs attention", () => {
    for (const bad of [null, undefined, "chat_ready_basic", 42, {}, { state: "bogus" }, { state: 7 }, { state: null }]) {
      expect(readinessView(bad).label).toBe("Needs attention");
    }
  });
});

describe("applicability line", () => {
  it("maps each match state to its own sentence", () => {
    expect(applicabilityLine("verified")).toBe("Verified for this machine");
    expect(applicabilityLine("user_confirmed")).toBe("Added by you, not verified for this model");
    expect(applicabilityLine("candidate")).toBe("Suggested, not approved");
    expect(applicabilityLine("rejected")).toBe("Rejected, not used");
  });
  it("unknown or missing state reads as unknown, never as verified", () => {
    expect(applicabilityLine("unknown")).toBe("Applicability unknown");
    expect(applicabilityLine(undefined)).toBe("Applicability unknown");
    expect(applicabilityLine("verified ")).toBe("Applicability unknown");
  });
});

describe("duplicate pre-check", () => {
  const nb = (id: string, entityId: string | null): HubNotebook =>
    ({ id, displayName: `Project ${id}`, asset: entityId ? { entityId, name: null, assetTag: null, selectedVia: "asset_picker", confirmedBy: null, confirmedAt: null } : null }) as unknown as HubNotebook;
  it("finds the notebook already bound to the machine", () => {
    expect(findExistingProject("node-cv101", [nb("a", "other"), nb("b", "node-cv101")])?.id).toBe("b");
  });
  it("control: a machine with no bound notebook is not a duplicate", () => {
    expect(findExistingProject("node-cv101", [nb("a", "other"), nb("c", null)])).toBeNull();
    expect(findExistingProject("node-cv101", [])).toBeNull();
  });
});

describe("machine list from the namespace tree", () => {
  it("keeps asset and equipment nodes with their parent chain as location", () => {
    const tree = { nodes: [{ id: "s", name: "Plant", kind: "site", children: [
      { id: "l", name: "Line 4", kind: "line", children: [{ id: "m", name: "CV-101", kind: "asset", unsPath: "enterprise.p.l4.cv101", children: [] }] },
      { id: "x", name: "Area", kind: "area", children: [] },
    ] }] };
    const result = machinesFromTree(tree);
    expect(result.machines).toHaveLength(1);
    expect(result.machines[0]).toMatchObject({ id: "m", name: "CV-101", location: "Plant / Line 4", unsPath: "enterprise.p.l4.cv101" });
  });
  it("throws on a payload it cannot read rather than showing an empty list", () => {
    expect(() => machinesFromTree({ nodes: [{ name: 5, kind: "asset" }] })).toThrow("machine_list_unreadable");
    expect(() => machinesFromTree({})).toThrow("machine_list_unreadable");
  });
});

describe("document rows", () => {
  it("an upload-source row's id is its docId; an indexed direct row resolves through the workspace list", () => {
    const workspace = workspaceDocsFrom({ files: [{ id: "file-9", filename: "cv.pdf", uploadId: "up-9" }] });
    const rows = linkedDocsFrom({ files: [
      { id: "up-1", filename: "legacy.pdf", source: "upload", indexed: true },
      { id: "file-9", filename: "cv.pdf", source: "direct", indexed: true },
      { id: "file-7", filename: "scan.pdf", source: "direct", indexed: false },
    ] }, workspace);
    expect(rows[0]).toMatchObject({ docId: "up-1", reason: null });
    expect(rows[1]).toMatchObject({ docId: "up-9", reason: null });
    expect(rows[2]).toMatchObject({ docId: null, reason: "Not searchable yet" });
  });
  it("an indexed direct row with no workspace match is disabled, never given a guessed id", () => {
    const rows = linkedDocsFrom({ files: [{ id: "file-3", filename: "x.pdf", source: "direct", indexed: true }] }, []);
    expect(rows[0]!.docId).toBeNull();
    expect(rows[0]!.reason).toMatch(/Workspace documents/);
  });
  it("workspace files without an uploadId have no docId", () => {
    expect(workspaceDocsFrom({ files: [{ id: "f", filename: "a.pdf", uploadId: null }] })[0]!.docId).toBeNull();
  });
});

describe("write plan (runCommit)", () => {
  it("General: exactly one POST to /api/equipment-notebooks/ and no asset PUT", async () => {
    const h = harness({ "POST /api/equipment-notebooks/": { status: 201, body: { notebook: { id: "nb-1" } } } });
    const createNotebook = vi.fn(async (body: { displayName: string }) => {
      await h.fetch("/api/equipment-notebooks/", { method: "POST", body: JSON.stringify(body) });
      return "nb-1";
    });
    const outcome = await runCommit({ selected: { kind: "general" }, name: "Shift line", docs: [], pdfs: [] }, deps(h.fetch, { createNotebook }));
    expect(outcome.kind).toBe("created");
    expect(createNotebook).toHaveBeenCalledWith({ displayName: "Shift line", identitySourceType: "user" });
    expect(h.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/equipment-notebooks/"]);
  });

  it("machine: POST assets, PUT asset, GET verify, then one sources POST per selected doc, in order", async () => {
    const confirmed = "2026-11-08T10:00:00.000Z";
    const h = harness({
      "POST /api/assets/": { status: 201, body: { ok: true, created: true, notebook: { id: "nb-m", nodeId: "node-nb", displayName: "CV-101" } } },
      "PUT /api/equipment-notebooks/nb-m/asset/": { status: 200, body: { ok: true, notebook: { asset: { entityId: "ent-1" } } } },
      "GET /api/equipment-notebooks/nb-m/": { status: 200, body: { notebook: { asset: { entityId: "ent-1", confirmedAt: confirmed } } } },
      "POST /api/equipment-notebooks/nb-m/sources/": { status: 201, body: { ok: true } },
    });
    const outcome = await runCommit({ selected: { kind: "machine", machine }, name: "", docs: [{ docId: "d1", filename: "a.pdf" }, { docId: "d2", filename: "b.pdf" }], pdfs: [] }, deps(h.fetch));
    expect(outcome.kind).toBe("created");
    expect(h.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /api/assets/node-cv101/notebook/",
      "PUT /api/equipment-notebooks/nb-m/asset/",
      "GET /api/equipment-notebooks/nb-m/",
      "POST /api/equipment-notebooks/nb-m/sources/",
      "POST /api/equipment-notebooks/nb-m/sources/",
    ]);
    expect(h.calls[0]!.body).toEqual({ selectedVia: "asset_picker", displayName: "Discharge Conveyor" });
    expect(h.calls[1]!.body).toEqual({ assetRef: "node-cv101", selectedVia: "asset_picker" });
    expect(h.calls[3]!.body).toEqual({ docId: "d1", sourceRole: "manual" });
    if (outcome.kind === "created") expect(outcome.confirmed).toBe(true);
  });

  it("created:false stops after the first call: refusal, no PUT, no sources", async () => {
    const h = harness({ "POST /api/assets/": { status: 200, body: { ok: true, created: false, notebook: { id: "nb-old", nodeId: "n", displayName: "Old CV-101" } } } });
    const outcome = await runCommit({ selected: { kind: "machine", machine }, name: "", docs: [{ docId: "d1", filename: "a.pdf" }], pdfs: [] }, deps(h.fetch));
    expect(outcome).toMatchObject({ kind: "refused", notebookId: "nb-old" });
    expect(h.calls).toHaveLength(1);
  });

  it("asset_already_bound on the confirm PUT refuses with the bound notebook and no further writes", async () => {
    const h = harness({
      "POST /api/assets/": { status: 201, body: { ok: true, created: true, notebook: { id: "nb-m", nodeId: "n", displayName: "CV" } } },
      "PUT /api/equipment-notebooks/nb-m/asset/": { status: 409, body: { error: "taken", code: "asset_already_bound", boundNotebookId: "nb-other" } },
    });
    const outcome = await runCommit({ selected: { kind: "machine", machine }, name: "", docs: [{ docId: "d1", filename: "a.pdf" }], pdfs: [] }, deps(h.fetch));
    expect(outcome).toMatchObject({ kind: "refused", notebookId: "nb-other" });
    expect(nonGet(h.calls).map((c) => c.path)).toEqual(["/api/assets/node-cv101/notebook/", "/api/equipment-notebooks/nb-m/asset/"]);
  });

  it("an unconfirmed machine still opens the project, with the not-confirmed note", async () => {
    const h = harness({
      "POST /api/assets/": { status: 201, body: { ok: true, created: true, notebook: { id: "nb-m", nodeId: "n", displayName: "CV" } } },
      "PUT /api/equipment-notebooks/nb-m/asset/": { status: 500, body: { error: "boom" } },
    });
    const outcome = await runCommit({ selected: { kind: "machine", machine }, name: "", docs: [], pdfs: [] }, deps(h.fetch));
    expect(outcome.kind).toBe("created");
    if (outcome.kind === "created") {
      expect(outcome.confirmed).toBe(false);
      expect(outcome.notes[0]).toMatch(/not confirmed yet/);
    }
  });

  it("an upload that comes back indexed:false is a Needs attention row, and nothing is attached for it", async () => {
    const h = harness({
      "POST /api/assets/": { status: 201, body: { ok: true, created: true, notebook: { id: "nb-m", nodeId: "node-nb", displayName: "CV" } } },
      "PUT /api/equipment-notebooks/nb-m/asset/": { status: 200, body: { ok: true, notebook: { asset: { entityId: "e" } } } },
      "GET /api/equipment-notebooks/nb-m/": { status: 200, body: { notebook: { asset: { entityId: "e", confirmedAt: "2026-11-08T10:00:00Z" } } } },
      "POST /api/namespace/node/node-nb/files/": { status: 201, body: { ok: true, indexed: false, warning: "scanned", fileId: "f" } },
    });
    const pdf = new File(["%PDF"], "scan.pdf", { type: "application/pdf" });
    const outcome = await runCommit({ selected: { kind: "machine", machine }, name: "", docs: [], pdfs: [pdf] }, deps(h.fetch));
    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") return;
    expect(outcome.docs).toHaveLength(1);
    expect(outcome.docs[0]!.notIndexed).toBe(true);
    expect(h.calls.some((c) => c.path.includes("/sources/"))).toBe(false);
    const rows = resultRows(outcome.docs, [], false);
    expect(rows[0]!.readiness.label).toBe("Needs attention");
    expect(rows[0]!.readiness.tone).not.toBe("ready");
  });

  it("#5295 r2: an upload that returns 202 indexing:true keeps its fileId and shows Processing, not Needs attention", async () => {
    const h = harness({
      "POST /api/equipment-notebooks/": { status: 201, body: { notebook: { id: "nb-g", nodeId: "node-g" } } },
      "GET /api/equipment-notebooks/nb-g/": { status: 200, body: { notebook: { nodeId: "node-g" } } },
      "POST /api/namespace/node/node-g/files/": { status: 202, body: { ok: true, indexed: false, indexing: true, fileId: "f-202" } },
    });
    const pdf = new File(["%PDF"], "m.pdf", { type: "application/pdf" });
    const outcome = await runCommit({ selected: { kind: "general" }, name: "G", docs: [], pdfs: [pdf] }, deps(h.fetch, { createNotebook: async () => "nb-g" }));
    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") return;
    expect(outcome.docs[0]).toMatchObject({ key: "file:f-202", fileId: "f-202", indexing: true, notIndexed: false, docId: null });
    expect(h.calls.some((c) => c.path.includes("/sources/"))).toBe(false);
    const rows = resultRows(outcome.docs, [], false);
    expect(rows[0]!.readiness).toEqual({ tone: "processing", label: "Processing" });
  });

  it("control: a 202 without a fileId cannot be followed and is Needs attention", async () => {
    const h = harness({
      "POST /api/equipment-notebooks/": { status: 201, body: { notebook: { id: "nb-g", nodeId: "node-g" } } },
      "GET /api/equipment-notebooks/nb-g/": { status: 200, body: { notebook: { nodeId: "node-g" } } },
      "POST /api/namespace/node/node-g/files/": { status: 202, body: { ok: true, indexed: false, indexing: true } },
    });
    const pdf = new File(["%PDF"], "m.pdf", { type: "application/pdf" });
    const outcome = await runCommit({ selected: { kind: "general" }, name: "G", docs: [], pdfs: [pdf] }, deps(h.fetch, { createNotebook: async () => "nb-g" }));
    expect(outcome.kind === "created" && resultRows(outcome.docs, [], false)[0]!.readiness.label).toBe("Needs attention");
  });
});

describe("#5295 r2: a document still being read by another upload", () => {
  const indexingDoc = { key: "file:f-202", filename: "m.pdf", docId: null, fileId: "f-202", indexing: true, attachFailed: false, notIndexed: false, message: null };
  const ready = (docId: string) => ({ docId, readiness: { state: "chat_ready_basic" }, matchState: "user_confirmed", enabledByDefault: true });

  it("delayed indexing: polls the file until it has an uploadId, attaches it once, then reads Ready", async () => {
    let fileReads = 0;
    const h = harness({
      "GET /api/files/f-202": () => { fileReads++; return { status: 200, body: { file: { id: "f-202", uploadId: fileReads < 3 ? null : "up-late", indexed: fileReads >= 3 } } }; },
      "POST /api/equipment-notebooks/nb/sources/": { status: 201, body: { ok: true } },
      "GET /api/equipment-notebooks/nb/": () => ({ status: 200, body: { sources: fileReads >= 3 ? [ready("up-late")] : [] } }),
    });
    const docs = [indexingDoc];
    const r = await watchReadiness("nb", [], deps(h.fetch), { intervalMs: 0, max: 6 }, { resolve: () => resolveIndexing("nb", docs, deps(h.fetch)) });
    expect(fileReads).toBe(3);
    expect(nonGet(h.calls)).toEqual([{ method: "POST", path: "/api/equipment-notebooks/nb/sources/", body: { docId: "up-late", sourceRole: "manual" } }]);
    expect(r.capped).toBe(false);
    expect(docs[0]).toMatchObject({ docId: "up-late", indexing: false, attachFailed: false });
    expect(resultRows(docs, r.sources, r.capped)[0]!.readiness.label).toBe("Ready to search");
  });

  it("cap reached with no uploadId: stays Processing with a recoverable note, never Ready, nothing attached", async () => {
    const h = harness({
      "GET /api/files/f-202": { status: 200, body: { file: { id: "f-202", uploadId: null, indexed: false } } },
      "GET /api/equipment-notebooks/nb/": { status: 200, body: { sources: [] } },
    });
    const docs = [indexingDoc];
    const r = await watchReadiness("nb", [], deps(h.fetch), noSleep, { resolve: () => resolveIndexing("nb", docs, deps(h.fetch)) });
    expect(r.capped).toBe(true);
    expect(nonGet(h.calls)).toEqual([]);
    const row = resultRows(docs, r.sources, r.capped)[0]!;
    expect(row.readiness).toEqual({ tone: "processing", label: "Processing" });
    expect(row.note).toBe(INDEXING_CAPPED);
  });

  it("error: the file is gone (404) is Needs attention and stops following it", async () => {
    const h = harness({
      "GET /api/files/f-202": { status: 404, body: { error: "not_found" } },
      "GET /api/equipment-notebooks/nb/": { status: 200, body: { sources: [] } },
    });
    const docs = [indexingDoc];
    const r = await watchReadiness("nb", [], deps(h.fetch), noSleep, { resolve: () => resolveIndexing("nb", docs, deps(h.fetch)) });
    expect(r.capped).toBe(false);
    expect(h.calls.filter((c) => c.path.startsWith("/api/files/"))).toHaveLength(1);
    expect(resultRows(docs, r.sources, r.capped)[0]!.readiness.label).toBe("Needs attention");
  });

  it("retry: a failed file read (500 or network) is retried on the next poll", async () => {
    let fileReads = 0;
    const h = harness({
      "GET /api/files/f-202": () => { fileReads++; return fileReads === 1 ? { status: 500, body: {} } : { status: 200, body: { file: { uploadId: "up-r" } } }; },
      "POST /api/equipment-notebooks/nb/sources/": { status: 201, body: { ok: true } },
      "GET /api/equipment-notebooks/nb/": () => ({ status: 200, body: { sources: fileReads >= 2 ? [ready("up-r")] : [] } }),
    });
    const docs = [indexingDoc];
    await watchReadiness("nb", [], deps(h.fetch), noSleep, { resolve: () => resolveIndexing("nb", docs, deps(h.fetch)) });
    expect(fileReads).toBe(2);
    expect(docs[0]!.docId).toBe("up-r");
  });

  it("a refused attach of the resolved document is Needs attention, not Ready", async () => {
    const h = harness({
      "GET /api/files/f-202": { status: 200, body: { file: { uploadId: "up-x" } } },
      "POST /api/equipment-notebooks/nb/sources/": { status: 404, body: { error: "doc_not_found" } },
      "GET /api/equipment-notebooks/nb/": { status: 200, body: { sources: [] } },
    });
    const docs = [indexingDoc];
    const r = await watchReadiness("nb", [], deps(h.fetch), noSleep, { resolve: () => resolveIndexing("nb", docs, deps(h.fetch)) });
    expect(docs[0]).toMatchObject({ attachFailed: true, indexing: false });
    expect(resultRows(docs, r.sources, r.capped)[0]!.readiness.label).toBe("Needs attention");
  });

  it("cancellation: closing the sheet while waiting stops polling and attaches nothing", async () => {
    let releaseSleep: () => void = () => {};
    let fileReads = 0;
    const h = harness({
      "GET /api/files/": (call) => {
        if (call.path.startsWith("/api/files/f-202")) { fileReads++; return { status: 200, body: { file: { uploadId: fileReads < 2 ? null : "up-late" } } }; }
        return { status: 200, body: { files: [] } };
      },
      "POST /api/equipment-notebooks/nb-general/sources/": { status: 201, body: { ok: true } },
      "GET /api/equipment-notebooks/nb-general/": { status: 200, body: { notebook: { nodeId: "node-g" }, sources: [] } },
      "POST /api/namespace/node/node-g/files/": { status: 202, body: { ok: true, indexed: false, indexing: true, fileId: "f-202" } },
    });
    const c = createNewProjectSetup({ ...deps(h.fetch, { sleep: () => new Promise<void>((r) => { releaseSleep = r; }) }), getNotebooks: () => [] });
    await c.choose({ kind: "general" });
    c.setName("Bench");
    await c.next();
    c.addPdfs([new File(["%PDF"], "m.pdf", { type: "application/pdf" })]);
    const committing = c.commit();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(c.getState().done).toBe(true);
    expect(c.getState().rows[0]?.readiness.label).toBe("Processing");
    expect(fileReads).toBe(1);
    expect(c.cancel()).toBe(true);
    releaseSleep();
    await committing;
    expect(fileReads).toBe(1);
    expect(h.calls.some((x) => x.path.includes("/sources/"))).toBe(false);
  });
});

describe("#5295 r2: Ready means chat will search it", () => {
  const doc = { key: "d1", filename: "a.pdf", docId: "d1", attachFailed: false, notIndexed: false, message: null };
  const src = (patch: Record<string, unknown>) => [{ docId: "d1", filename: "a.pdf", readiness: { state: "chat_ready_basic" }, matchState: "user_confirmed", enabledByDefault: true, ...patch }];
  it("a readable, confirmed, enabled source is Ready", () => {
    expect(resultRows([doc], src({}), false)[0]!.readiness.label).toBe("Ready to search");
    expect(resultRows([doc], src({ matchState: "verified" }), false)[0]!.readiness.label).toBe("Ready to search");
  });
  it("a readable but unapproved (candidate or rejected) source is never Ready", () => {
    for (const matchState of ["candidate", "rejected", undefined, "bogus"]) {
      expect(resultRows([doc], src({ matchState }), false)[0]!.readiness).toEqual({ tone: "attention", label: "Not searchable" });
    }
  });
  it("a readable source switched off for chat is never Ready", () => {
    for (const enabledByDefault of [false, undefined, "true"]) {
      expect(resultRows([doc], src({ enabledByDefault }), false)[0]!.readiness.label).toBe("Not searchable");
    }
  });
});

describe("#5296: a refusal never outlives the selection it was for", () => {
  const treeReply = { status: 200, body: { nodes: [
    { id: "node-a", name: "Machine A", kind: "asset", unsPath: "enterprise.a", children: [] },
    { id: "node-b", name: "Machine B", kind: "asset", unsPath: "enterprise.b", children: [] },
  ] } };
  const machineA: Machine = { id: "node-a", name: "Machine A", tag: "A", unsPath: "enterprise.a", manufacturer: null, model: null, location: null };
  const machineB: Machine = { id: "node-b", name: "Machine B", tag: "B", unsPath: "enterprise.b", manufacturer: null, model: null, location: null };
  const existingB = [{ id: "nb-b", displayName: "Machine B project", asset: { entityId: "node-b" } } as unknown as HubNotebook];
  const routes = {
    "GET /api/namespace/tree/": treeReply,
    "GET /api/files/": { status: 200, body: { files: [] } },
    "GET /api/namespace/node/": { status: 200, body: { files: [] } },
    "POST /api/assets/node-a/notebook/": { status: 200, body: { ok: true, created: false, notebook: { id: "nb-a", nodeId: "n-a", displayName: "Machine A project" } } },
  };
  const refuseA = async () => {
    const h = harness(routes);
    const c = createNewProjectSetup({ ...deps(h.fetch), getNotebooks: () => existingB });
    await c.start();
    await c.choose({ kind: "machine", machine: machineA });
    await c.next();
    await c.next();
    await c.commit();
    expect(c.getState().refusal?.notebookId).toBe("nb-a");
    expect(c.openProjectId()).toBe("nb-a");
    return { c, h };
  };

  it("refuse A, go back, choose B (which has a project): Open opens B, never A", async () => {
    const { c, h } = await refuseA();
    c.back();
    c.back();
    expect(c.getState().step).toBe(1);
    await c.choose({ kind: "machine", machine: machineB });
    expect(c.getState().refusal).toBeNull();
    expect(c.getState().duplicate).toEqual({ notebookId: "nb-b", name: "Machine B project" });
    expect(c.openProjectId()).toBe("nb-b");
    expect(nonGet(h.calls).map((x) => x.path)).toEqual(["/api/assets/node-a/notebook/"]);
  });

  it("choosing another machine clears the refusal by itself (no Back needed)", async () => {
    const { c } = await refuseA();
    await c.choose({ kind: "machine", machine: machineB });
    expect(c.getState().refusal).toBeNull();
    expect(c.openProjectId()).toBe("nb-b");
  });

  it("refuse A, then choose General: no project to open until General is created", async () => {
    const { c } = await refuseA();
    await c.choose({ kind: "general" });
    expect(c.getState().refusal).toBeNull();
    expect(c.openProjectId()).toBeNull();
  });

  it("going back from the refusal clears it, so the refusal message does not linger", async () => {
    const { c } = await refuseA();
    c.back();
    expect(c.getState().refusal).toBeNull();
  });
});

describe("readiness watch", () => {
  it("stops as soon as every watched document has left uploading and stored", async () => {
    let n = 0;
    const h = harness({ "GET /api/equipment-notebooks/nb/": () => { n++; return { status: 200, body: { sources: [{ docId: "d1", readiness: { state: n < 2 ? "stored" : "chat_ready_basic" }, matchState: "user_confirmed" }] } }; } });
    const r = await watchReadiness("nb", ["d1"], deps(h.fetch), noSleep);
    expect(r.capped).toBe(false);
    expect(h.calls).toHaveLength(2);
  });
  it("after the cap the item stays processing and the row says so", async () => {
    const h = harness({ "GET /api/equipment-notebooks/nb/": { status: 200, body: { sources: [{ docId: "d1", readiness: { state: "stored" }, matchState: "user_confirmed" }] } } });
    const r = await watchReadiness("nb", ["d1"], deps(h.fetch), noSleep);
    expect(r.capped).toBe(true);
    expect(h.calls).toHaveLength(3);
    const rows = resultRows([{ key: "d1", filename: "a.pdf", docId: "d1", attachFailed: false, notIndexed: false, message: null }], r.sources, true);
    expect(rows[0]!.readiness.label).toBe("Processing");
    expect(rows[0]!.note).toBe(STILL_PROCESSING);
  });
  it("a failed index is shown as Needs attention with its applicability on its own line", () => {
    const rows = resultRows(
      [{ key: "d1", filename: "a.pdf", docId: "d1", attachFailed: false, notIndexed: false, message: null }],
      [{ docId: "d1", filename: "a.pdf", readiness: { state: "failed" }, matchState: "verified" }],
      false,
    );
    expect(rows[0]!.readiness.label).toBe("Needs attention");
    expect(rows[0]!.applicability).toBe("Verified for this machine");
  });
});

describe("controller", () => {
  const notebooks: HubNotebook[] = [];
  const treeReply = { status: 200, body: { nodes: [{ id: "node-cv101", name: "Discharge Conveyor", kind: "asset", unsPath: "enterprise.a.cv101", children: [] }] } };
  const wsReply = { status: 200, body: { files: [{ id: "f1", filename: "manual.pdf", uploadId: "up-1" }, { id: "f2", filename: "scan.pdf", uploadId: null }] } };
  const linkedReply = { status: 200, body: { files: [{ id: "up-1", filename: "manual.pdf", source: "upload", indexed: true }] } };

  it("cancel and back before the commit click make zero non-GET requests", async () => {
    const h = harness({ "GET /api/namespace/tree/": treeReply, "GET /api/files/": wsReply, "GET /api/namespace/node/": linkedReply, "POST ": { status: 500, body: {} }, "PUT ": { status: 500, body: {} } });
    const c = createNewProjectSetup({ ...deps(h.fetch), getNotebooks: () => notebooks });
    await c.start();
    await c.choose({ kind: "machine", machine });
    await c.next();
    c.back();
    expect(c.cancel()).toBe(true);
    expect(nonGet(h.calls)).toEqual([]);
  });

  it("control: committing does issue writes", async () => {
    const h = harness({
      "GET /api/namespace/tree/": treeReply,
      "GET /api/files/": wsReply,
      "GET /api/namespace/node/": linkedReply,
      "POST /api/assets/": { status: 201, body: { ok: true, created: true, notebook: { id: "nb-m", nodeId: "n", displayName: "CV" } } },
      "PUT /api/equipment-notebooks/nb-m/asset/": { status: 200, body: { ok: true, notebook: { asset: { entityId: "e" } } } },
      "GET /api/equipment-notebooks/nb-m/": { status: 200, body: { notebook: { asset: { entityId: "e", confirmedAt: "2026-11-08T10:00:00Z" } }, sources: [{ docId: "up-1", readiness: { state: "chat_ready_basic" }, matchState: "user_confirmed" }] } },
      "POST /api/equipment-notebooks/nb-m/sources/": { status: 201, body: { ok: true } },
    });
    const c = createNewProjectSetup({ ...deps(h.fetch), getNotebooks: () => notebooks });
    await c.start();
    await c.choose({ kind: "machine", machine });
    await c.next();
    await c.commit();
    expect(nonGet(h.calls).length).toBeGreaterThan(0);
    const s = c.getState();
    expect(s.done).toBe(true);
    expect(s.rows[0]).toMatchObject({ key: "up-1", applicability: "Added by you, not verified for this model" });
    expect(c.openProjectId()).toBe("nb-m");
  });

  it("a machine with an existing project is refused before any write; Next and Commit do nothing", async () => {
    const h = harness({ "GET /api/namespace/tree/": treeReply, "GET /api/files/": wsReply, "POST ": { status: 500, body: {} }, "PUT ": { status: 500, body: {} } });
    const existing = [{ id: "nb-existing", displayName: "CV-101 line", asset: { entityId: "node-cv101" } } as unknown as HubNotebook];
    const c = createNewProjectSetup({ ...deps(h.fetch), getNotebooks: () => existing });
    await c.start();
    await c.choose({ kind: "machine", machine });
    expect(c.getState().duplicate).toEqual({ notebookId: "nb-existing", name: "CV-101 line" });
    await c.next();
    expect(c.getState().step).toBe(1);
    await c.commit();
    expect(nonGet(h.calls)).toEqual([]);
    expect(c.openProjectId()).toBe("nb-existing");
  });

  it("General needs a name before Next", async () => {
    const h = harness({ "GET /api/files/": wsReply });
    const c = createNewProjectSetup({ ...deps(h.fetch), getNotebooks: () => notebooks });
    await c.choose({ kind: "general" });
    await c.next();
    expect(c.getState().step).toBe(1);
    expect(c.getState().error).toMatch(/Name/);
    c.setName("Shift line");
    await c.next();
    expect(c.getState().step).toBe(2);
  });

  it("PDF intake refuses non-PDFs and files over the limit, without writing", () => {
    const h = harness({});
    const c = createNewProjectSetup({ ...deps(h.fetch), getNotebooks: () => notebooks, maxPdfBytes: 10 });
    c.addPdfs([new File(["x"], "photo.png", { type: "image/png" }), new File(["%PDF-1.4 long enough"], "big.pdf", { type: "application/pdf" }), new File(["%PDF"], "ok.pdf", { type: "application/pdf" })]);
    const s = c.getState();
    expect(s.pdfs.map((f) => f.name)).toEqual(["ok.pdf"]);
    expect(s.pdfError).toMatch(/over the/);
  });

  it("a rejected commit keeps the technician in place with the message and no notebook", async () => {
    const h = harness({
      "GET /api/namespace/tree/": treeReply,
      "GET /api/files/": wsReply,
      "GET /api/namespace/node/": linkedReply,
      "POST /api/assets/": { status: 422, body: { error: "That asset hasn't been approved yet.", code: "asset_not_verified" } },
    });
    const c = createNewProjectSetup({ ...deps(h.fetch), getNotebooks: () => notebooks });
    await c.start();
    await c.choose({ kind: "machine", machine });
    await c.next();
    await c.commit();
    expect(c.getState().error).toBe("That asset hasn't been approved yet.");
    expect(c.getState().done).toBe(false);
    expect(c.openProjectId()).toBeNull();
  });
});

describe("Codex #5295 r1: slow manuals and closing mid-commit", () => {
  const treeReply = { status: 200, body: { nodes: [{ id: "node-cv101", name: "Discharge Conveyor", kind: "asset", unsPath: "enterprise.a.cv101", children: [] }] } };
  const wsReply = { status: 200, body: { files: [{ id: "f1", filename: "manual.pdf", uploadId: "up-1" }, { id: "f3", filename: "wiring.pdf", uploadId: "up-3" }] } };
  const linkedReply = { status: 200, body: { files: [{ id: "up-1", filename: "manual.pdf", source: "upload", indexed: true }] } };
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const later = () => {
    let release: (r: Reply) => void = () => {};
    const promise = new Promise<Reply>((r) => { release = r; });
    return { route: () => promise, release: (r: Reply) => release(r) };
  };
  const createdRoutes = {
    "POST /api/assets/": { status: 201, body: { ok: true, created: true, notebook: { id: "nb-m", nodeId: "n", displayName: "CV" } } },
    "PUT /api/equipment-notebooks/nb-m/asset/": { status: 200, body: { ok: true } },
    "GET /api/equipment-notebooks/nb-m/": { status: 200, body: { notebook: { asset: { entityId: "e", confirmedAt: "2026-11-08T10:00:00Z" } }, sources: [] } },
    "POST /api/equipment-notebooks/nb-m/sources/": { status: 201, body: { ok: true } },
  };

  it("Next and Create wait for the machine's manuals; once they load, Next works and the defaults apply", async () => {
    const linked = later();
    const h = harness({ "GET /api/namespace/tree/": treeReply, "GET /api/files/": wsReply, "GET /api/namespace/node/": linked.route, ...createdRoutes });
    const c = createNewProjectSetup({ ...deps(h.fetch), getNotebooks: () => [] });
    await c.start();
    const choosing = c.choose({ kind: "machine", machine });
    await flush();
    expect(c.getState().linked).toBeNull();
    await c.next();
    expect(c.getState().step).toBe(1);
    await c.commit();
    expect(nonGet(h.calls)).toEqual([]);
    linked.release(linkedReply);
    await choosing;
    expect(c.getState().chosenDocIds).toEqual(["up-1"]);
    await c.next();
    expect(c.getState().step).toBe(2);
  });

  it("a manuals answer that arrives after the technician moved on changes nothing", async () => {
    const linked = later();
    const h = harness({ "GET /api/namespace/tree/": treeReply, "GET /api/files/": wsReply, "GET /api/namespace/node/": linked.route });
    const c = createNewProjectSetup({ ...deps(h.fetch), getNotebooks: () => [] });
    await c.start();
    const choosing = c.choose({ kind: "machine", machine });
    await flush();
    await c.choose({ kind: "general" });
    c.setName("Shift line");
    await c.next();
    c.toggleDoc("up-3");
    linked.release(linkedReply);
    await choosing;
    expect(c.getState().step).toBe(2);
    expect(c.getState().selected).toEqual({ kind: "general" });
    expect(c.getState().chosenDocIds).toEqual(["up-3"]);
  });

  it("closing the sheet mid-commit still tells the host about the saved project, exactly once", async () => {
    const create = later();
    const onWritten = vi.fn();
    const h = harness({ "GET /api/namespace/tree/": treeReply, "GET /api/files/": wsReply, "GET /api/namespace/node/": linkedReply, ...createdRoutes, "POST /api/assets/": create.route });
    const c = createNewProjectSetup({ ...deps(h.fetch), onWritten, getNotebooks: () => [] });
    await c.start();
    await c.choose({ kind: "machine", machine });
    await c.next();
    const committing = c.commit();
    await flush();
    c.dispose();
    create.release(createdRoutes["POST /api/assets/"]);
    await committing;
    expect(nonGet(h.calls).map((x) => `${x.method} ${x.path}`)).toContain("PUT /api/equipment-notebooks/nb-m/asset/");
    expect(onWritten).toHaveBeenCalledTimes(1);
  });

  it("a project created but returned without its node id still refreshes the host", async () => {
    const onWritten = vi.fn();
    const h = harness({ "GET /api/namespace/tree/": treeReply, "GET /api/files/": wsReply, "GET /api/namespace/node/": linkedReply, "POST /api/assets/": { status: 201, body: { ok: true, created: true, notebook: { id: "nb-m" } } } });
    const c = createNewProjectSetup({ ...deps(h.fetch), onWritten, getNotebooks: () => [] });
    await c.start();
    await c.choose({ kind: "machine", machine });
    await c.next();
    await c.commit();
    expect(c.getState().error).toMatch(/created but could not be opened/);
    expect(onWritten).toHaveBeenCalledTimes(1);
  });

  it("control: a refused or failed-before-write commit does not refresh the host", async () => {
    const onWritten = vi.fn();
    const h = harness({ "GET /api/namespace/tree/": treeReply, "GET /api/files/": wsReply, "GET /api/namespace/node/": linkedReply, "POST /api/assets/": { status: 422, body: { error: "nope", code: "asset_not_verified" } } });
    const c = createNewProjectSetup({ ...deps(h.fetch), onWritten, getNotebooks: () => [] });
    await c.start();
    await c.choose({ kind: "machine", machine });
    await c.next();
    await c.commit();
    expect(c.getState().error).toBe("nope");
    expect(onWritten).not.toHaveBeenCalled();
  });
});

describe("slow indexing does not lock the sheet", () => {
  it("unlocks after the first readiness read while a document is still processing, and stops polling on close", async () => {
    let polls = 0;
    let releaseSleep: () => void = () => {};
    const h = harness({
      "POST /api/equipment-notebooks/nb-general/sources/": { status: 201, body: { ok: true } },
      "GET /api/equipment-notebooks/nb-general/": () => { polls++; return { status: 200, body: { sources: [{ docId: "up-1", readiness: { state: "stored" }, matchState: "user_confirmed" }] } }; },
      "GET /api/files/": { status: 200, body: { files: [{ id: "f1", filename: "manual.pdf", uploadId: "up-1" }] } },
    });
    const c = createNewProjectSetup({
      ...deps(h.fetch, { sleep: () => new Promise<void>((r) => { releaseSleep = r; }) }),
      getNotebooks: () => [],
    });
    await c.choose({ kind: "general" });
    c.setName("Bench test");
    await c.next();
    c.toggleDoc("up-1");
    const committing = c.commit();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    const s = c.getState();
    expect(polls).toBe(1);
    expect(s.committing).toBe(false);
    expect(s.done).toBe(true);
    expect(s.rows[0]?.readiness.label).toBe("Processing");
    expect(c.cancel()).toBe(true);
    releaseSleep();
    await committing;
    expect(polls).toBe(1);
  });
});

describe("S16: a PDF that never reached the project can be sent again from the sheet", () => {
  const pdf = new File(["%PDF"], "manual.pdf", { type: "application/pdf" });
  const setup = (files: (call: Call) => Reply) => {
    let sourceCalls = 0;
    const h = harness({
      "GET /api/namespace/tree/": { status: 200, body: { nodes: [] } },
      "GET /api/files/": { status: 200, body: { files: [] } },
      "POST /api/namespace/node/node-g/files/": files,
      // The project record lists the manual as a source only once it has been attached.
      "GET /api/equipment-notebooks/nb-general/": () => ({ status: 200, body: { notebook: { nodeId: "node-g" }, sources: sourceCalls ? [{ docId: "doc-1", filename: "manual.pdf", readiness: { state: "chat_ready_basic" }, matchState: "user_confirmed", enabledByDefault: true }] : [] } }),
      "POST /api/equipment-notebooks/nb-general/sources/": () => { sourceCalls += 1; return { status: 201, body: { ok: true } }; },
    });
    const c = createNewProjectSetup({ ...deps(h.fetch), getNotebooks: () => [] });
    return { c, h, sources: () => sourceCalls };
  };
  const toCommit = async (c: ReturnType<typeof createNewProjectSetup>) => {
    await c.start();
    await c.choose({ kind: "general" });
    c.setName("Upload retry test");
    await c.next();
    c.addPdfs([pdf]);
    await c.next();
    await c.commit();
  };

  it("a failed save is Needs attention, keeps the file, and offers Try again; nothing is attached", async () => {
    const { c, sources } = setup(() => { throw new TypeError("Failed to fetch"); });
    await toCommit(c);
    const row = c.getState().rows[0]!;
    expect(row.readiness.label).toBe("Needs attention");
    expect(row.retry).toBe(true);
    expect(row.note).toMatch(/Try again/);
    expect(c.getState().pdfs).toHaveLength(1);
    expect(sources()).toBe(0);
  });

  it("Try again sends the same file once, attaches it once and the row reads Ready", async () => {
    let n = 0;
    const { c, h, sources } = setup(() => (++n === 1 ? { status: 503, body: { error: "offline" } } : { status: 201, body: { ok: true, indexed: true, uploadId: "doc-1", fileId: "f-1" } }));
    await toCommit(c);
    const key = c.getState().rows[0]!.key;
    await c.retryUpload(key);
    const files = h.calls.filter((x) => x.method === "POST" && x.path.endsWith("/files/"));
    expect(files).toHaveLength(2);
    expect(sources()).toBe(1);
    const row = c.getState().rows[0]!;
    expect(row.readiness.label).toBe("Ready to search");
    expect(row.retry).toBeFalsy();
    expect(c.getState().rows).toHaveLength(1);
  });

  it("control: an upload saved but unreadable (indexed:false) offers no Try again", async () => {
    const { c } = setup(() => ({ status: 201, body: { ok: true, indexed: false, warning: "scanned", fileId: "f" } }));
    await toCommit(c);
    expect(c.getState().rows[0]!.retry).toBeFalsy();
  });

  it("Codex #5353 r2 F4: retrying a second copy of an already-saved PDF leaves one row for that document", async () => {
    const uploaded: string[] = [];
    const attached: string[] = [];
    let copies = 0;
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const reply = (status: number, body: Record<string, unknown>) =>
        ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;
      if (method === "GET" && path.startsWith("/api/namespace/tree/")) return reply(200, { nodes: [] });
      if (method === "GET" && path.startsWith("/api/files/")) return reply(200, { files: [] });
      if (method === "POST" && path.startsWith("/api/namespace/node/node-g/files/")) {
        const bytes = await ((init!.body as FormData).get("file") as File).text();
        uploaded.push(bytes);
        copies++;
        if (copies === 2) return reply(503, { error: "offline" });
        // content dedup: the same bytes always come back as the same document
        return reply(201, { ok: true, indexed: true, uploadId: `doc-${bytes}`, fileId: `f-${bytes}` });
      }
      if (method === "POST" && path.startsWith("/api/equipment-notebooks/nb-general/sources/")) {
        const docId = String(JSON.parse(String(init!.body)).docId);
        if (!attached.includes(docId)) attached.push(docId);
        return reply(201, { ok: true });
      }
      if (method === "GET" && path.startsWith("/api/equipment-notebooks/nb-general/")) {
        return reply(200, {
          notebook: { nodeId: "node-g" },
          sources: attached.map((docId) => ({ docId, filename: "manual.pdf", readiness: { state: "chat_ready_basic" }, matchState: "user_confirmed", enabledByDefault: true })),
        });
      }
      throw new Error(`unexpected request ${method} ${path}`);
    });
    const c = createNewProjectSetup({ ...deps(fetchFn as unknown as typeof fetch), getNotebooks: () => [] });
    await c.start();
    await c.choose({ kind: "general" });
    c.setName("Duplicate retry");
    await c.next();
    c.addPdfs([new File(["A"], "manual.pdf", { type: "application/pdf" }), new File(["A"], "manual.pdf", { type: "application/pdf" })]);
    await c.next();
    await c.commit();
    const failed = c.getState().rows.find((r) => r.retry)!;
    expect(failed).toBeDefined();
    await c.retryUpload(failed.key);
    expect(uploaded).toEqual(["A", "A", "A"]);
    expect(attached).toEqual(["doc-A"]);
    const rows = c.getState().rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.retry).toBeFalsy();
    expect(rows[0]!.readiness.label).toBe("Ready to search");
  });

  it("Codex #5353 r3 F5: a deduplicated retry that attaches clears the first copy's earlier attach failure", async () => {
    const attached: string[] = [];
    let copies = 0;
    let attachCalls = 0;
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const reply = (status: number, body: Record<string, unknown>) =>
        ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;
      if (method === "GET" && path.startsWith("/api/namespace/tree/")) return reply(200, { nodes: [] });
      if (method === "GET" && path.startsWith("/api/files/")) return reply(200, { files: [] });
      if (method === "POST" && path.startsWith("/api/namespace/node/node-g/files/")) {
        const bytes = await ((init!.body as FormData).get("file") as File).text();
        copies++;
        if (copies === 2) return reply(503, { error: "offline" });
        return reply(201, { ok: true, indexed: true, uploadId: `doc-${bytes}`, fileId: `f-${bytes}` });
      }
      if (method === "POST" && path.startsWith("/api/equipment-notebooks/nb-general/sources/")) {
        attachCalls++;
        // the first copy's attach fails; the retry's attach succeeds
        if (attachCalls === 1) return reply(503, { error: "attach offline" });
        const docId = String(JSON.parse(String(init!.body)).docId);
        if (!attached.includes(docId)) attached.push(docId);
        return reply(201, { ok: true });
      }
      if (method === "GET" && path.startsWith("/api/equipment-notebooks/nb-general/")) {
        return reply(200, {
          notebook: { nodeId: "node-g" },
          sources: attached.map((docId) => ({ docId, filename: "manual.pdf", readiness: { state: "chat_ready_basic" }, matchState: "user_confirmed", enabledByDefault: true })),
        });
      }
      throw new Error(`unexpected request ${method} ${path}`);
    });
    const c = createNewProjectSetup({ ...deps(fetchFn as unknown as typeof fetch), getNotebooks: () => [] });
    await c.start();
    await c.choose({ kind: "general" });
    c.setName("Duplicate retry after attach failure");
    await c.next();
    c.addPdfs([new File(["A"], "manual.pdf", { type: "application/pdf" }), new File(["A"], "manual.pdf", { type: "application/pdf" })]);
    await c.next();
    await c.commit();
    const failed = c.getState().rows.find((r) => r.retry)!;
    expect(failed).toBeDefined();
    await c.retryUpload(failed.key);
    expect(attached).toEqual(["doc-A"]);
    const rows = c.getState().rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.retry).toBeFalsy();
    expect(rows[0]!.readiness.label).toBe("Ready to search");
    expect(rows[0]!.note ?? "").not.toMatch(/attach offline|Couldn't be added/);
  });

  it("Codex #5353 r5 F6: a retry that removes a row while an older attach is in flight does not overwrite another file's failed row", async () => {
    const attached: string[] = [];
    const uploads: Record<string, number> = {};
    let bReads = 0;
    let bAttaches = 0;
    let releaseB: () => void = () => {};
    const bGate = new Promise<void>((r) => { releaseB = r; });
    let bRequested: () => void = () => {};
    const bInFlight = new Promise<void>((r) => { bRequested = r; });
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const reply = (status: number, body: Record<string, unknown>) =>
        ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;
      if (method === "GET" && path.startsWith("/api/namespace/tree/")) return reply(200, { nodes: [] });
      if (method === "GET" && path.startsWith("/api/files/f-B")) { bReads++; return reply(200, { file: { id: "f-B", uploadId: bReads < 2 ? null : "doc-B" } }); }
      if (method === "GET" && path.startsWith("/api/files/")) return reply(200, { files: [] });
      if (method === "POST" && path.startsWith("/api/namespace/node/node-g/files/")) {
        const bytes = await ((init!.body as FormData).get("file") as File).text();
        uploads[bytes] = (uploads[bytes] ?? 0) + 1;
        if (bytes === "B") return reply(202, { ok: true, indexed: false, indexing: true, fileId: "f-B" });
        // the first A copy and C fail; the second A copy and every retry save
        if ((bytes === "A" || bytes === "C") && uploads[bytes] === 1) return reply(503, { error: "offline" });
        return reply(201, { ok: true, indexed: true, uploadId: `doc-${bytes}`, fileId: `f-${bytes}` });
      }
      if (method === "POST" && path.startsWith("/api/equipment-notebooks/nb-general/sources/")) {
        const docId = String(JSON.parse(String(init!.body)).docId);
        if (docId === "doc-B" && ++bAttaches === 1) { bRequested(); await bGate; }
        if (!attached.includes(docId)) attached.push(docId);
        return reply(201, { ok: true });
      }
      if (method === "GET" && path.startsWith("/api/equipment-notebooks/nb-general/")) {
        return reply(200, {
          notebook: { nodeId: "node-g" },
          sources: attached.map((docId) => ({ docId, filename: `${docId}.pdf`, readiness: { state: "chat_ready_basic" }, matchState: "user_confirmed", enabledByDefault: true })),
        });
      }
      throw new Error(`unexpected request ${method} ${path}`);
    });
    const c = createNewProjectSetup({ ...deps(fetchFn as unknown as typeof fetch), getNotebooks: () => [] });
    await c.start();
    await c.choose({ kind: "general" });
    c.setName("Retry during an in-flight attach");
    await c.next();
    const pdf = (bytes: string, name: string) => new File([bytes], name, { type: "application/pdf" });
    c.addPdfs([pdf("A", "a.pdf"), pdf("A", "a.pdf"), pdf("B", "b.pdf"), pdf("C", "c.pdf")]);
    await c.next();
    const commitDone = c.commit();
    // the first poll unlocked the sheet; the next poll is attaching B and waits
    await bInFlight;
    expect(c.getState().committing).toBe(false);
    const aRetry = c.getState().rows.find((r) => r.retry && r.filename === "a.pdf")!;
    expect(aRetry).toBeDefined();
    await c.retryUpload(aRetry.key); // deduplicates into the saved A copy and removes its row
    releaseB(); // the retired attach completes after the rows shifted
    await commitDone;
    const cRetry = c.getState().rows.find((r) => r.retry && r.filename === "c.pdf");
    expect(cRetry).toBeDefined();
    await c.retryUpload(cRetry!.key);
    expect(uploads.C).toBe(2);
    const rows = c.getState().rows;
    expect(rows.map((r) => r.filename)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    expect(rows.map((r) => r.readiness.label)).toEqual(["Ready to search", "Ready to search", "Ready to search"]);
  });

  it("Codex #5353 r5 F6: the resolver writes back to its own row by identity, and leaves a row a retry replaced", async () => {
    const indexingDoc = { key: "file:f-202", filename: "m.pdf", docId: null, fileId: "f-202", indexing: true, attachFailed: false, notIndexed: false, message: null };
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    let requested: () => void = () => {};
    const inFlight = new Promise<void>((r) => { requested = r; });
    const h = harness({
      "GET /api/files/f-202": { status: 200, body: { file: { uploadId: "up-b" } } },
      "POST /api/equipment-notebooks/nb/sources/": async () => { requested(); await gate; return { status: 201, body: { ok: true } }; },
    });
    const failed = (name: string) => ({ key: `pdf:${name}`, filename: name, docId: null, attachFailed: false, notIndexed: true, retryUpload: true as const, message: "Couldn't upload." });
    const docs: Parameters<typeof resolveIndexing>[1] = [failed("a.pdf"), { ...indexingDoc }, failed("c.pdf")];
    const run = resolveIndexing("nb", docs, deps(h.fetch));
    await inFlight;
    docs.splice(0, 1); // a deduplicated retry removed the first row
    release();
    await run;
    expect(docs.map((d) => d.filename)).toEqual(["m.pdf", "c.pdf"]);
    expect(docs[0]).toMatchObject({ docId: "up-b", indexing: false, attachFailed: false });
    expect(docs[1]).toMatchObject({ filename: "c.pdf", retryUpload: true, notIndexed: true });

    let release2: () => void = () => {};
    const gate2 = new Promise<void>((r) => { release2 = r; });
    let requested2: () => void = () => {};
    const inFlight2 = new Promise<void>((r) => { requested2 = r; });
    const h2 = harness({
      "GET /api/files/f-202": { status: 200, body: { file: { uploadId: "up-b" } } },
      "POST /api/equipment-notebooks/nb/sources/": async () => { requested2(); await gate2; return { status: 503, body: { error: "late" } }; },
    });
    const docs2: Parameters<typeof resolveIndexing>[1] = [{ ...indexingDoc }];
    const run2 = resolveIndexing("nb", docs2, deps(h2.fetch));
    await inFlight2;
    const replaced = { ...indexingDoc, key: "doc:up-b", docId: "up-b", indexing: false };
    docs2[0] = replaced; // a newer write already settled this row
    release2();
    await run2;
    expect(docs2[0]).toBe(replaced);
  });

  it("Codex #5353 r3 F5 control: a deduplicated retry whose attach fails never overwrites the first copy's good row", async () => {
    const attached: string[] = [];
    let copies = 0;
    let attachCalls = 0;
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const reply = (status: number, body: Record<string, unknown>) =>
        ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;
      if (method === "GET" && path.startsWith("/api/namespace/tree/")) return reply(200, { nodes: [] });
      if (method === "GET" && path.startsWith("/api/files/")) return reply(200, { files: [] });
      if (method === "POST" && path.startsWith("/api/namespace/node/node-g/files/")) {
        const bytes = await ((init!.body as FormData).get("file") as File).text();
        copies++;
        if (copies === 2) return reply(503, { error: "offline" });
        return reply(201, { ok: true, indexed: true, uploadId: `doc-${bytes}`, fileId: `f-${bytes}` });
      }
      if (method === "POST" && path.startsWith("/api/equipment-notebooks/nb-general/sources/")) {
        attachCalls++;
        // the first copy attaches; the retry's attach fails
        if (attachCalls > 1) return reply(503, { error: "attach offline" });
        const docId = String(JSON.parse(String(init!.body)).docId);
        if (!attached.includes(docId)) attached.push(docId);
        return reply(201, { ok: true });
      }
      if (method === "GET" && path.startsWith("/api/equipment-notebooks/nb-general/")) {
        return reply(200, {
          notebook: { nodeId: "node-g" },
          sources: attached.map((docId) => ({ docId, filename: "manual.pdf", readiness: { state: "chat_ready_basic" }, matchState: "user_confirmed", enabledByDefault: true })),
        });
      }
      throw new Error(`unexpected request ${method} ${path}`);
    });
    const c = createNewProjectSetup({ ...deps(fetchFn as unknown as typeof fetch), getNotebooks: () => [] });
    await c.start();
    await c.choose({ kind: "general" });
    c.setName("Duplicate retry attach fails");
    await c.next();
    c.addPdfs([new File(["A"], "manual.pdf", { type: "application/pdf" }), new File(["A"], "manual.pdf", { type: "application/pdf" })]);
    await c.next();
    await c.commit();
    const failed = c.getState().rows.find((r) => r.retry)!;
    await c.retryUpload(failed.key);
    const rows = c.getState().rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.readiness.label).toBe("Ready to search");
  });

  it("Codex #5353 F1: two different files with the same name — Try again sends the failed file's own bytes", async () => {
    const uploaded: string[] = [];
    const attached: string[] = [];
    let bFailed = false;
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const reply = (status: number, body: Record<string, unknown>) =>
        ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;
      if (method === "GET" && path.startsWith("/api/namespace/tree/")) return reply(200, { nodes: [] });
      if (method === "GET" && path.startsWith("/api/files/")) return reply(200, { files: [] });
      if (method === "POST" && path.startsWith("/api/namespace/node/node-g/files/")) {
        const bytes = await ((init!.body as FormData).get("file") as File).text();
        uploaded.push(bytes);
        if (bytes === "B" && !bFailed) { bFailed = true; return reply(503, { error: "offline" }); }
        return reply(201, { ok: true, indexed: true, uploadId: `doc-${bytes}`, fileId: `f-${bytes}` });
      }
      if (method === "POST" && path.startsWith("/api/equipment-notebooks/nb-general/sources/")) {
        attached.push(String(JSON.parse(String(init!.body)).docId));
        return reply(201, { ok: true });
      }
      if (method === "GET" && path.startsWith("/api/equipment-notebooks/nb-general/")) {
        return reply(200, {
          notebook: { nodeId: "node-g" },
          sources: attached.map((docId) => ({ docId, filename: "manual.pdf", readiness: { state: "chat_ready_basic" }, matchState: "user_confirmed", enabledByDefault: true })),
        });
      }
      throw new Error(`unexpected request ${method} ${path}`);
    });
    const c = createNewProjectSetup({ ...deps(fetchFn as unknown as typeof fetch), getNotebooks: () => [] });
    await c.start();
    await c.choose({ kind: "general" });
    c.setName("Same-name retry");
    await c.next();
    c.addPdfs([new File(["A"], "manual.pdf", { type: "application/pdf" }), new File(["B"], "manual.pdf", { type: "application/pdf" })]);
    await c.next();
    await c.commit();
    const failed = c.getState().rows.find((r) => r.retry)!;
    expect(failed).toBeDefined();
    await c.retryUpload(failed.key);
    expect(uploaded).toEqual(["A", "B", "B"]);
    expect(attached.sort()).toEqual(["doc-A", "doc-B"]);
    const rows = c.getState().rows;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
    expect(rows.every((r) => r.readiness.label === "Ready to search" && !r.retry)).toBe(true);
  });

  it("Codex #5353 F2: an older readiness poll that wakes during a retry does not unlock the sheet", async () => {
    let releaseOldPoll: () => void = () => {};
    let sleeps = 0;
    let releasePost: (r: Reply) => void = () => {};
    let n = 0;
    const h = harness({
      "GET /api/namespace/tree/": { status: 200, body: { nodes: [] } },
      "GET /api/files/": { status: 200, body: { files: [{ id: "f1", filename: "slow.pdf", uploadId: "up-1" }] } },
      "POST /api/namespace/node/node-g/files/": () =>
        ++n === 1 ? { status: 503, body: { error: "offline" } } : new Promise<Reply>((r) => { releasePost = r; }),
      "GET /api/equipment-notebooks/nb-general/": { status: 200, body: { notebook: { nodeId: "node-g" }, sources: [{ docId: "up-1", readiness: { state: "stored" }, matchState: "user_confirmed" }] } },
      "POST /api/equipment-notebooks/nb-general/sources/": { status: 201, body: { ok: true } },
    });
    const c = createNewProjectSetup({
      // The commit's watch sleeps until released; later sleeps never resolve (the test ends first).
      ...deps(h.fetch, { sleep: () => new Promise<void>((r) => { if (++sleeps === 1) releaseOldPoll = r; }) }),
      getNotebooks: () => [],
    });
    await c.start();
    await c.choose({ kind: "general" });
    c.setName("Stale poll");
    await c.next();
    c.toggleDoc("up-1");
    c.addPdfs([new File(["%PDF"], "manual.pdf", { type: "application/pdf" })]);
    await c.next();
    void c.commit();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(c.getState().committing).toBe(false); // the commit's watch unlocked after its first read
    const key = c.getState().rows.find((r) => r.retry)!.key;
    void c.retryUpload(key);
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(c.getState().committing).toBe(true); // retry POST is pending
    releaseOldPoll();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(c.getState().committing).toBe(true);
    expect(c.cancel()).toBe(false);
    const postsBefore = h.calls.filter((x) => x.method === "POST" && x.path.endsWith("/files/")).length;
    await c.retryUpload(key);
    expect(h.calls.filter((x) => x.method === "POST" && x.path.endsWith("/files/")).length).toBe(postsBefore);
    releasePost({ status: 201, body: { ok: true, indexed: true, uploadId: "doc-1", fileId: "f-1" } });
    c.dispose();
  });

  it("control: Try again on a saved-but-unreadable file writes nothing (it is on the project already)", async () => {
    const { c, h } = setup(() => ({ status: 201, body: { ok: true, indexed: false, warning: "scanned", fileId: "f" } }));
    await toCommit(c);
    const before = nonGet(h.calls).length;
    await c.retryUpload(c.getState().rows[0]!.key);
    expect(nonGet(h.calls).length).toBe(before);
  });
});
