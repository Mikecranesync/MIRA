import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  acquire: vi.fn(), release: vi.fn(), sources: vi.fn(), query: vi.fn(), chunks: vi.fn(),
  open: vi.fn(), extract: vi.fn(), destroy: vi.fn(), page: vi.fn(), png: vi.fn(),
  order: [] as string[], cleanups: [] as ReturnType<typeof vi.fn>[],
}));
vi.mock("@/lib/node-knowledge-ingest", () => ({ acquireIngestSlot: m.acquire }));
vi.mock("@/lib/equipment-notebooks", () => ({ listSources: m.sources }));
vi.mock("@/lib/db", () => ({ default: { query: m.chunks } }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: async (_tenant: string, fn: (c: unknown) => unknown) => fn({ query: m.query }) }));
vi.mock("unpdf", () => ({ getDocumentProxy: m.open, extractText: m.extract, getResolvedPDFJS: async () => ({ OPS: {} }) }));
vi.mock("../pdf-figure-lines", () => ({
  imageBoxesFromOps: () => [{ name: "image", x0: 0, x1: 10, y0: 0, y1: 10 }],
  figureLinesForPage: () => new Set(["retained caption"]),
  figuresForPage: () => [{ box: { name: "image" }, caption: ["retained caption"] }],
}));
vi.mock("../pdf-image-png", () => ({ decodedImageToPng: m.png }));

import { loadNotebookDocTexts, pdfDocPages } from "../document-text";

const FILE = "52890000-0000-4000-8000-000000000001";
const DOC = "52890000-0000-4000-8000-000000000002";
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function outcome<T>(promise: Promise<T>) {
  return promise.then((value) => ({ value, error: null }), (error) => ({ value: null, error }));
}
beforeEach(() => {
  vi.clearAllMocks(); m.order.length = 0; m.cleanups.length = 0;
  m.acquire.mockResolvedValue(m.release);
  m.release.mockImplementation(() => m.order.push("slot:release"));
  m.sources.mockResolvedValue([{ docId: DOC, fileId: FILE, filename: "full.pdf", enabledByDefault: true, matchState: "user_confirmed" }]);
  m.query.mockImplementation(async () => { m.order.push("bytes:read"); return { rows: [{ content: Buffer.from("PDF") }] }; });
  m.chunks.mockResolvedValue({ rows: [] });
  m.extract.mockResolvedValue({ text: ["PAGE ONE", "PAGE TWO"] });
  m.destroy.mockImplementation(async () => { m.order.push("pdf:destroy"); });
  m.open.mockImplementation(async () => ({ getPage: m.page, destroy: m.destroy }));
  m.png.mockImplementation(() => { m.order.push("image:captured"); return "data:image/png;base64,retained"; });
  m.page.mockImplementation(async (n: number) => {
    m.order.push(`page:${n}:open`);
    const cleanup = vi.fn(() => { m.order.push(`page:${n}:cleanup`); return true; });
    m.cleanups.push(cleanup);
    const objs = { get: (_name: string, cb: (v: unknown) => void) => cb({ data: new Uint8Array([1]), width: 1, height: 1, kind: 2 }) };
    return { cleanup, objs, commonObjs: objs, getTextContent: async () => ({ items: [] }), getOperatorList: async () => ({ fnArray: [], argsArray: [] }) };
  });
});

describe("#5289 PDF resource lifetime and byte admission", () => {
  it("captures every page/figure before cleanup and destroys the PDF before releasing its slot", async () => {
    const docs = await loadNotebookDocTexts("tenant", "notebook");
    expect(docs[0].via).toBe("file");
    expect(docs[0].pages.map((p) => p.text)).toEqual(["PAGE ONE", "PAGE TWO"]);
    expect(docs[0].pages.every((p) => p.figures?.[0].image === "data:image/png;base64,retained" && p.figures[0].caption.join(" ") === "retained caption")).toBe(true);
    expect(m.cleanups).toHaveLength(2);
    m.cleanups.forEach((cleanup) => expect(cleanup).toHaveBeenCalledTimes(1));
    expect(m.order.indexOf("page:1:cleanup")).toBeGreaterThan(m.order.indexOf("image:captured"));
    expect(m.order.indexOf("page:1:cleanup")).toBeLessThan(m.order.indexOf("page:2:open"));
    expect(m.order.indexOf("pdf:destroy")).toBeLessThan(m.order.indexOf("slot:release"));
    expect(m.destroy).toHaveBeenCalledTimes(1);
  });

  it("does not acquire original bytes until the shared parse slot is admitted", async () => {
    const slot = deferred<() => void>(); m.acquire.mockReturnValue(slot.promise);
    const result = outcome(loadNotebookDocTexts("tenant", "notebook"));
    let readsWhileQueued: number;
    try { await flush(); readsWhileQueued = m.query.mock.calls.length; }
    finally { slot.resolve(m.release); }
    const out = await result;
    expect(readsWhileQueued!).toBe(0);
    expect(out.error).toBeNull();
    expect(m.query).toHaveBeenCalledTimes(1);
    expect(m.release).toHaveBeenCalledTimes(1);
  });

  it("releases the PDF on extraction failure before passing the error to its caller", async () => {
    m.extract.mockRejectedValue(new Error("bad extraction"));
    await expect(pdfDocPages(new Uint8Array([1]))).rejects.toThrow("bad extraction");
    expect(m.destroy).toHaveBeenCalledTimes(1);
    expect(m.order.slice(-2)).toEqual(["pdf:destroy", "slot:release"]);
  });

  it("cleans a page after optional layout failure while preserving all page text", async () => {
    m.page.mockImplementationOnce(async () => {
      const cleanup = vi.fn(() => true); m.cleanups.push(cleanup);
      return { cleanup, getTextContent: async () => { throw new Error("layout unavailable"); } };
    });
    const pages = await pdfDocPages(new Uint8Array([1]));
    expect(pages.map((p) => p.text)).toEqual(["PAGE ONE", "PAGE TWO"]);
    expect(m.cleanups[0]).toHaveBeenCalledTimes(1);
    expect(m.destroy).toHaveBeenCalledTimes(1);
  });

  it("an already-cancelled load does no source, byte or parser work", async () => {
    const c = new AbortController(); c.abort();
    await expect(loadNotebookDocTexts("tenant", "notebook", { signal: c.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(m.sources).not.toHaveBeenCalled(); expect(m.query).not.toHaveBeenCalled(); expect(m.open).not.toHaveBeenCalled();
  });

  it.each(["bytes", "open"])("keeps admission during cancelled %s acquisition until the owned operation resolves", async (phase) => {
    const c = new AbortController();
    const pending = deferred<unknown>();
    if (phase === "bytes") m.query.mockReturnValueOnce(pending.promise);
    else m.open.mockReturnValueOnce(pending.promise);
    const result = outcome(loadNotebookDocTexts("tenant", "notebook", { signal: c.signal }));
    await flush(); c.abort(); await flush();
    expect(m.release).not.toHaveBeenCalled();
    if (phase === "bytes") pending.resolve({ rows: [{ content: Buffer.from("PDF") }] });
    else pending.resolve({ getPage: m.page, destroy: m.destroy });
    expect((await result).error).toMatchObject({ name: "AbortError" });
    expect(m.release).toHaveBeenCalledTimes(1);
    expect(m.extract).not.toHaveBeenCalled();
    expect(m.chunks).not.toHaveBeenCalled();
    expect(m.destroy).toHaveBeenCalledTimes(phase === "open" ? 1 : 0);
  });

  it("does not release the parse slot before asynchronous PDF destruction finishes", async () => {
    const teardown = deferred<void>(); m.destroy.mockReturnValueOnce(teardown.promise);
    const result = outcome(pdfDocPages(new Uint8Array([1])));
    await flush();
    expect(m.destroy).toHaveBeenCalledTimes(1);
    expect(m.release).not.toHaveBeenCalled();
    teardown.resolve();
    expect((await result).error).toBeNull();
    expect(m.release).toHaveBeenCalledTimes(1);
  });

  it("cancels while queued without bytes, then gives back a subsequently granted slot exactly once", async () => {
    const c = new AbortController(); const slot = deferred<() => void>(); m.acquire.mockReturnValue(slot.promise);
    const result = outcome(loadNotebookDocTexts("tenant", "notebook", { signal: c.signal }));
    let early: Awaited<typeof result> | null = null;
    try {
      await flush(); c.abort();
      early = await Promise.race([result, new Promise<null>((r) => setTimeout(() => r(null), 25))]);
    } finally { slot.resolve(m.release); }
    await result; await flush();
    expect(early?.error).toMatchObject({ name: "AbortError" });
    expect(m.query).not.toHaveBeenCalled(); expect(m.open).not.toHaveBeenCalled();
    expect(m.release).toHaveBeenCalledTimes(1); expect(m.chunks).not.toHaveBeenCalled();
  });

  it.each(["text", "operators", "image"])("cancels during %s without serving a chunk fallback", async (phase) => {
    const c = new AbortController(); const pending = deferred<unknown>();
    m.extract.mockResolvedValue({ text: ["PAGE ONE"] });
    let imageCallback: ((v: unknown) => void) | null = null;
    if (phase === "text") m.extract.mockReturnValue(pending.promise);
    if (phase === "operators") m.page.mockImplementation(async () => ({
      cleanup: vi.fn(() => true), getTextContent: async () => ({ items: [] }), getOperatorList: () => pending.promise,
    }));
    if (phase === "image") m.page.mockImplementation(async () => ({
      cleanup: vi.fn(() => true), getTextContent: async () => ({ items: [] }), getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
      objs: { get: (_name: string, cb: (v: unknown) => void) => { imageCallback = cb; } },
    }));
    m.destroy.mockImplementation(async () => { m.order.push("pdf:destroy"); if (phase !== "image") pending.reject(new Error("destroyed")); });
    const result = outcome(loadNotebookDocTexts("tenant", "notebook", { signal: c.signal }));
    let early: Awaited<typeof result> | null = null;
    try {
      await flush(); await flush(); c.abort();
      early = await Promise.race([result, new Promise<null>((r) => setTimeout(() => r(null), 25))]);
    } finally {
      pending.resolve(phase === "text" ? { text: ["PAGE ONE"] } : { fnArray: [], argsArray: [] });
      (imageCallback as ((v: unknown) => void) | null)?.({ data: new Uint8Array([1]) });
    }
    await result;
    expect(early?.error).toMatchObject({ name: "AbortError" });
    expect(m.destroy).toHaveBeenCalledTimes(1); expect(m.release).toHaveBeenCalledTimes(1);
    expect(m.chunks).not.toHaveBeenCalled();
  });
});
