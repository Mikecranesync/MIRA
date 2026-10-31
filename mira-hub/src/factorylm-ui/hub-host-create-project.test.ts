/** Execute the real host callbacks with deferred network responses (#4650).
 * Uses the existing callback-harness approach, not a copy of production logic. */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { latestRequestGate } from "./hub-host-logic";
const source = readFileSync(new URL("./hub-host.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("hub-host.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name: string, deps: Record<string, unknown>) {
  let initializer = "";
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name) initializer = node.initializer!.getText(parsed);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  expect(initializer).not.toBe("");
  const compiled = ts.transpileModule(`const callback = ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(deps), "useCallback", `${compiled}\nreturn callback;`)(...Object.values(deps), (fn: unknown) => fn);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
type NotebookStub = {id:string;displayName?:string;nodeId?:string};
function setup(loadNotebooks: () => Promise<unknown>) {
  let notebooks: NotebookStub[] = [{ id: "existing" }];
  const created = { id: "created-project", displayName: "Conveyor 4", nodeId: "node-4" };
  const deps = {
    fetch: vi.fn(async () => ({ status: 201, ok: true, json: async () => ({ notebook: created }) })),
    API_BASE: "", loadNotebooks, setSignedOut: vi.fn(), errorMessageFor: () => "Creation failed",
    notebookGate: latestRequestGate(), setNotebooks: (update: NotebookStub[] | ((current: NotebookStub[]) => NotebookStub[])) => { notebooks = typeof update === "function" ? update(notebooks) : update; },
  };
  return { deps, created, read: () => notebooks, create: callback("createNotebook", deps) };
}
describe("project creation does not wait for sidebar refresh", () => {
  it("returns the created ID and shows it while list refresh is still pending", async () => {
    const list = deferred<unknown>();
    const env = setup(() => list.promise);
    let result: unknown;
    const pending = env.create({ displayName: "Conveyor 4" }).then((id: string) => { result = id; });
    try {
      for (let i = 0; i < 10; i++) await Promise.resolve();
      expect(result).toBe("created-project");
      expect(env.read()).toEqual([env.created, { id: "existing" }]);
    } finally { list.resolve([]); await pending; }
  });
  it("does not turn a successful creation into failure when refresh rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const env = setup(async () => { throw new Error("refresh offline"); });
      expect(await env.create({ displayName: "Conveyor 4" })).toBe("created-project");
      expect(env.read()[0]).toEqual(env.created);
    } finally { warn.mockRestore(); }
  });
  it("a list request started before creation cannot erase the newly created project", async () => {
    const stale = deferred<{status:number;data:{notebooks:NotebookStub[]}}>();
    const fresh = deferred<{status:number;data:{notebooks:NotebookStub[]}}>();
    const env = setup(() => fresh.promise);
    const load = callback("loadNotebooks", { ...env.deps, getJson: () => stale.promise,
      selectionRef: { current: { notebookId: "existing", threadId: "thread-1" } },
      syncThread: vi.fn(), setSelection: vi.fn(), readSearch: () => "", selectionFromSearch: vi.fn(), landingSelection: vi.fn(), writeSearch: vi.fn(), searchForSelection: vi.fn() });
    const old = load();
    const creating = env.create({ displayName: "Conveyor 4" });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    stale.resolve({ status: 200, data: { notebooks: [{ id: "existing" }] } });
    await old;
    try { expect(env.read()).toContainEqual(env.created); }
    finally { fresh.resolve([]); await creating; }
  });
  it("selects the created project from the real New project handler before refresh completes", async () => {
    const list = deferred<unknown>();
    const env = setup(() => list.promise);
    const select = vi.fn();
    const handler = callback("onCreateProject", { window: { prompt: () => "Conveyor 4" },
      createNotebook: env.create, select, newThreadId: () => "new-thread", dispatch: vi.fn() });
    handler();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    try { expect(select).toHaveBeenCalledWith({notebookId:"created-project",threadId:"new-thread"}); }
    finally { list.resolve([]); }
  });
  it("list hydration cannot restore an old URL after an explicit project selection", async () => {
    const selectionRef = {current:null};
    const noop = vi.fn();
    const setSelection = vi.fn();
    const select = callback("select", {selectionRef, abortRef:{current:null}, uploadAbortRef:{current:null},
      detailGate:latestRequestGate(), detailAbortRef:{current:null}, setDetail:noop, setLive:noop,
      setFailedBody:noop, manualSearchDriverRef:{current:null}, setFollow:noop, syncThread:noop,
      setSelection, writeSearch:noop, searchForSelection:()=>""});
    const chosen={notebookId:"created-project",threadId:"new-thread"};
    select(chosen);
    const load = callback("loadNotebooks", {notebookGate:latestRequestGate(),
      getJson:async()=>({status:200,data:{notebooks:[]}}),setSignedOut:noop,setNotebooks:noop,
      selectionRef,syncThread:noop,setSelection,readSearch:()=>"?notebook=old",
      selectionFromSearch:()=>({notebookId:"old",threadId:"old-thread"}),landingSelection:noop,
      writeSearch:noop,searchForSelection:()=>""});
    await load();
    expect(setSelection).toHaveBeenLastCalledWith(chosen);
  });

});
