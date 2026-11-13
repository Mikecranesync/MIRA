/** #5456: a manual saved switched off is shown on the v3 project screen with its one next step. Fake fetch only; no DOM. */
import { describe, expect, it, vi } from "vitest";
import { reloadIfStillSelected, type HubSelection } from "./hub-host-logic";
import type { SetupDeps } from "./new-project-setup-logic";
import { confirmedOn, parkedRows, REREAD_FAILED, turnOnAndReread, turnOnParkedSource, USE_FAILED, USE_GONE, USE_SIGNED_OUT, type ParkedSource } from "./parked-sources";

const src = (patch: Partial<ParkedSource>): ParkedSource => ({
  docId: "d-1", filename: "manual.pdf", fileId: "f-1", matchState: "candidate",
  searchable: false, searchableLabel: "Not searchable: not turned on", searchableFix: "use", ...patch,
});

function harness(status: number | "throw") {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ method: String(init?.method), path: String(input), body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    if (status === "throw") throw new Error("offline");
    return { status, ok: status >= 200 && status < 300, json: async () => (status === 200 ? { ok: true } : { error: "not_found" }) } as Response;
  });
  const deps: SetupDeps = { fetch: fetchFn as unknown as typeof fetch, apiBase: "/hub", createNotebook: async () => null, sleep: async () => {} };
  return { calls, deps };
}

describe("parkedRows: which sources the box lists", () => {
  it("lists a switched-off suggestion with the server's label and step", () => {
    expect(parkedRows([src({})])).toEqual([{ docId: "d-1", name: "manual.pdf", fileId: "f-1", label: "Not searchable: not turned on", fix: "use", needsApproval: true }]);
  });
  it("never lists a source that answers already use, even a partial one with a warning", () => {
    expect(parkedRows([src({ searchable: true, searchableFix: null, searchableLabel: "Ready to ask — partial manual", matchState: "user_confirmed" })])).toEqual([]);
  });
  it("a source the server says IS searchable is never listed, whatever step rides along", () => {
    expect(parkedRows([src({ searchable: true, searchableFix: "use" })])).toEqual([]);
  });
  it("never lists a rejected match", () => {
    expect(parkedRows([src({ matchState: "rejected", searchableFix: null }), src({ matchState: "rejected", searchableFix: "use" })])).toEqual([]);
  });
  it("a response without the projection lists nothing: unknown is not 'not in use'", () => {
    const old = { docId: "d-1", filename: "manual.pdf", fileId: "f-1", matchState: "candidate" } as unknown as ParkedSource;
    expect(parkedRows([old])).toEqual([]);
    expect(parkedRows([src({ searchableFix: undefined as unknown as null })])).toEqual([]);
  });
  it("carries the partial-manual and not-readable steps through unchanged", () => {
    const rows = parkedRows([src({ docId: "p", searchableFix: "full_manual" }), src({ docId: "w", searchableFix: "wait" })]);
    expect(rows.map((r) => [r.docId, r.fix])).toEqual([["p", "full_manual"], ["w", "wait"]]);
  });
  it("only a suggestion needs approving; a verified or confirmed source keeps its state", () => {
    expect(parkedRows([src({ matchState: "verified" }), src({ matchState: "user_confirmed" })]).map((r) => r.needsApproval)).toEqual([false, false]);
  });
  it("a nameless document still gets a row", () => {
    expect(parkedRows([src({ filename: null, fileId: null })])[0]).toMatchObject({ name: "Document", fileId: null });
  });
});

describe("turnOnParkedSource: one write", () => {
  it("approves and switches on a suggestion in the same request", async () => {
    const h = harness(200);
    expect(await turnOnParkedSource("nb 1", { docId: "d/1", fix: "use", needsApproval: true }, h.deps)).toEqual({ ok: true });
    expect(h.calls).toEqual([{ method: "PATCH", path: "/hub/api/equipment-notebooks/nb%201/sources/d%2F1/", body: { enabledByDefault: true, matchState: "user_confirmed" } }]);
  });
  it("does not rewrite the trust state of a source the server already verified", async () => {
    const h = harness(200);
    await turnOnParkedSource("nb", { docId: "d", fix: "use", needsApproval: false }, h.deps);
    expect(h.calls[0]!.body).toEqual({ enabledByDefault: true });
  });
  it("sends nothing for a partial manual or an unreadable document", async () => {
    for (const fix of ["full_manual", "wait"] as const) {
      const h = harness(200);
      expect((await turnOnParkedSource("nb", { docId: "d", fix, needsApproval: true }, h.deps)).ok).toBe(false);
      expect(h.calls).toEqual([]);
    }
  });
  it("says what happened in words, never a server error code", async () => {
    expect(await turnOnParkedSource("nb", { docId: "d", fix: "use", needsApproval: true }, harness(404).deps)).toEqual({ ok: false, message: USE_GONE });
    expect(await turnOnParkedSource("nb", { docId: "d", fix: "use", needsApproval: true }, harness(401).deps)).toEqual({ ok: false, message: USE_SIGNED_OUT });
    expect(await turnOnParkedSource("nb", { docId: "d", fix: "use", needsApproval: true }, harness(500).deps)).toEqual({ ok: false, message: USE_FAILED });
    expect(await turnOnParkedSource("nb", { docId: "d", fix: "use", needsApproval: true }, harness("throw").deps)).toEqual({ ok: false, message: USE_FAILED });
  });
});

describe("confirmedOn: 'now used' is said only when the server's list says chat searches it", () => {
  const on = [{ docId: "a", name: "a.pdf" }, { docId: "b", name: "b.pdf" }];
  it("confirms a source the refreshed list marks searchable", () => {
    expect(confirmedOn(on, [{ docId: "a", searchable: true }, { docId: "b", searchable: true }])).toEqual(["a.pdf", "b.pdf"]);
  });
  it("a source removed from the project is not confirmed", () => {
    expect(confirmedOn(on, [])).toEqual([]);
    expect(confirmedOn(on, [{ docId: "b", searchable: true }])).toEqual(["b.pdf"]);
  });
  it("a source rejected or switched off again is not confirmed", () => {
    expect(confirmedOn(on, [{ docId: "a", searchable: false }, { docId: "b", searchable: true }])).toEqual(["b.pdf"]);
  });
  it("a list without the projection confirms nothing", () => {
    expect(confirmedOn(on, [{ docId: "a" } as unknown as { docId: string; searchable: boolean }])).toEqual([]);
  });
});

describe("turnOnAndReread: one tap, start to finish", () => {
  const row = { docId: "d", fix: "use" as const, needsApproval: true };
  function gate() { let open!: (v: boolean) => void; const p = new Promise<boolean>((r) => { open = r; }); return { p, open }; }

  it("a second tap while the first is in flight sends nothing", async () => {
    const h = harness(200);
    const g = gate();
    const inFlight = new Set<string>();
    const io = { deps: h.deps, reread: () => g.p, onBusy: vi.fn() };
    const first = turnOnAndReread("nb", row, inFlight, io);
    expect(await turnOnAndReread("nb", row, inFlight, io)).toBeNull();
    g.open(true);
    expect(await first).toEqual({ kind: "on" });
    expect(h.calls).toHaveLength(1);
  });
  it("the row stays busy until the project re-read settles, then is released", async () => {
    const h = harness(200);
    const g = gate();
    const inFlight = new Set<string>();
    const seen: boolean[] = [];
    const run = turnOnAndReread("nb", row, inFlight, { deps: h.deps, reread: () => { seen.push(inFlight.has("d")); return g.p; }, onBusy: vi.fn() });
    await vi.waitFor(() => expect(seen).toEqual([true]));
    expect(inFlight.has("d")).toBe(true);
    g.open(true);
    await run;
    expect(inFlight.has("d")).toBe(false);
  });
  it("another document is not blocked by one in flight", async () => {
    const h = harness(200);
    const g = gate();
    const inFlight = new Set<string>();
    const first = turnOnAndReread("nb", row, inFlight, { deps: h.deps, reread: () => g.p, onBusy: vi.fn() });
    expect(await turnOnAndReread("nb", { ...row, docId: "e" }, inFlight, { deps: h.deps, reread: async () => true, onBusy: vi.fn() })).toEqual({ kind: "on" });
    g.open(true);
    await first;
  });
  it("an accepted write whose re-read fails or throws says so, and a second tap can repeat it", async () => {
    const h = harness(200);
    const inFlight = new Set<string>();
    expect(await turnOnAndReread("nb", row, inFlight, { deps: h.deps, reread: async () => false, onBusy: vi.fn() })).toEqual({ kind: "failed", message: REREAD_FAILED });
    expect(await turnOnAndReread("nb", row, inFlight, { deps: h.deps, reread: async () => { throw new Error("offline"); }, onBusy: vi.fn() })).toEqual({ kind: "failed", message: REREAD_FAILED });
    expect(await turnOnAndReread("nb", row, inFlight, { deps: h.deps, reread: async () => true, onBusy: vi.fn() })).toEqual({ kind: "on" });
    expect(h.calls).toHaveLength(3);
    expect(inFlight.size).toBe(0);
  });
  it("a refused write is never followed by a re-read, and the row is released", async () => {
    const h = harness(500);
    const reread = vi.fn(async () => true);
    const inFlight = new Set<string>();
    expect(await turnOnAndReread("nb", row, inFlight, { deps: h.deps, reread, onBusy: vi.fn() })).toEqual({ kind: "failed", message: USE_FAILED });
    expect(reread).not.toHaveBeenCalled();
    expect(inFlight.size).toBe(0);
  });
  it("tells the screen each time the busy set changed", async () => {
    const onBusy = vi.fn();
    await turnOnAndReread("nb", row, new Set(), { deps: harness(200).deps, reread: async () => true, onBusy });
    expect(onBusy).toHaveBeenCalledTimes(2);
  });
});

describe("#5488 r1 F1: a tap that finishes after the technician left the project", () => {
  const A: HubSelection = { notebookId: "A", threadId: "t1" } as HubSelection;
  const row = { docId: "d", fix: "use" as const, needsApproval: true };
  function heldPatch() {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const fetchFn = vi.fn(async () => { await held; return { status: 200, ok: true, json: async () => ({ ok: true }) } as Response; });
    const deps: SetupDeps = { fetch: fetchFn as unknown as typeof fetch, apiBase: "", createNotebook: async () => null, sleep: async () => {} };
    return { deps, release };
  }
  it.each([
    ["another project", { notebookId: "B", threadId: "t9" }],
    ["another thread of the same project", { notebookId: "A", threadId: "t2" }],
    ["nothing (host gone)", null],
  ])("never re-reads project A once the screen shows %s", async (_n, now) => {
    const h = heldPatch();
    let current: { notebookId: string; threadId: string } | null = A;
    const loads: string[] = [];
    const load = async (sel: HubSelection) => { loads.push(sel.notebookId); return true; };
    const run = turnOnAndReread("A", row, new Set(), { deps: h.deps, reread: () => reloadIfStillSelected(current, A, load), onBusy: vi.fn() });
    current = now;
    h.release();
    expect(await run).toEqual({ kind: "failed", message: REREAD_FAILED });
    expect(loads).toEqual([]);
  });
  it("control: still on project A, the re-read runs and the tap succeeds", async () => {
    const h = heldPatch();
    const loads: string[] = [];
    const run = turnOnAndReread("A", row, new Set(), { deps: h.deps, reread: () => reloadIfStillSelected(A, A, async (sel) => { loads.push(sel.notebookId); return true; }), onBusy: vi.fn() });
    h.release();
    expect(await run).toEqual({ kind: "on" });
    expect(loads).toEqual(["A"]);
  });
});
