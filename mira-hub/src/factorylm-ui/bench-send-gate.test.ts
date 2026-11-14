import { describe, expect, it, vi } from "vitest";
import {
  CHANGE_BLOCKED_MESSAGE,
  SEND_LOADING_MESSAGE,
  benchSendRefusal,
  changeSelection,
  createBenchSendGate,
  readBench,
  reconcileBench,
  riderFor,
  withComponentRider,
  type BenchState,
} from "./bench-components-logic";

/**
 * #5504 Codex r2: a question sent while a component change is still saving carried the version the
 * header read before it, and a change made while an answer streamed moved the header under it. These
 * drive the panel's real change path (`changeSelection`, which `BenchComponents.select` runs) with
 * held network calls, and the same gate the host's `send()` checks first.
 *
 * Run: npx vitest run src/factorylm-ui/bench-send-gate.test.ts
 */
const SEL = { notebookId: "nb-1", threadId: "th-1" };
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const state = (componentId: string, version: number) =>
  ({ selection: { componentId, revision: 1, selectedAt: "2026-11-14T04:00:00.000Z", version }, selectionVersion: version, components: [] }) as unknown as BenchState;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The host's send(): checks the gate before anything else, then builds the body from the rider it reads now. */
function hostSend(gate: ReturnType<typeof createBenchSendGate>, rider: () => ReturnType<typeof riderFor>, chat: (body: unknown) => void): boolean {
  if (benchSendRefusal(gate) !== null) return false;
  if (!gate.tryBeginSend()) return false;
  chat(withComponentRider({ message: "and its fuse size?", mode: "general" as const }, SEL, rider()));
  return true;
}

/** A gate whose conversation's checklist has already been read. */
function readGate() {
  const gate = createBenchSendGate();
  gate.markKnown();
  return gate;
}

const LIST = "/components?threadId=th-1";
const okState = (s: BenchState) => new Response(JSON.stringify(s), { status: 200 });
const wholeMachine = { selection: null, selectionVersion: 3, components: [] } as unknown as BenchState;

/** The panel's `load`: one real checklist read through `readBench`, answered by `get`. */
function panelLoad(gate: ReturnType<typeof createBenchSendGate>, get: () => Promise<Response>, apply: (s: BenchState | null) => void) {
  return () => readBench({ gate, fetch: () => get(), url: LIST, apply });
}

describe("a send never overlaps a component change", () => {
  it("A→B change still saving: Send is refused, then after the checklist re-read it carries B's new version", async () => {
    const gate = readGate();
    let bench = state(A, 3);
    const put = deferred<Response>();
    const reread = deferred<Response>();
    const fetch = vi.fn(() => put.promise);
    const chat = vi.fn();
    const change = changeSelection({
      gate, fetch, url: "/sel", load: panelLoad(gate, () => reread.promise, (s) => { bench = s as BenchState; }),
      body: { threadId: SEL.threadId, componentId: B, via: "picker", expectedVersion: 3, clientRequestId: "r1" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    // Pressed while the PUT is in flight, and again while the checklist is being re-read.
    expect(hostSend(gate, () => riderFor(bench, SEL), chat)).toBe(false);
    put.resolve(new Response("{}", { status: 200 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(hostSend(gate, () => riderFor(bench, SEL), chat)).toBe(false);
    expect(chat).not.toHaveBeenCalled();

    reread.resolve(okState(state(B, 4)));
    await expect(change).resolves.toEqual({ ok: true });
    expect(hostSend(gate, () => riderFor(bench, SEL), chat)).toBe(true);
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ componentSelection: { componentId: B, selectionVersion: 4 } }));
  });

  it("an answer still streaming: the change is refused without a request, and allowed once the answer ends", async () => {
    const gate = readGate();
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    const load = panelLoad(gate, async () => okState(state(B, 4)), () => undefined);
    const body = { threadId: SEL.threadId, componentId: B, via: "picker", expectedVersion: 3, clientRequestId: "r1" };
    expect(hostSend(gate, () => riderFor(state(A, 3), SEL), vi.fn())).toBe(true);

    await expect(changeSelection({ gate, fetch, url: "/sel", load, body })).resolves.toEqual({ ok: false, message: CHANGE_BLOCKED_MESSAGE });
    expect(fetch).not.toHaveBeenCalled();

    gate.endSend();
    await expect(changeSelection({ gate, fetch, url: "/sel", load, body })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("another screen moved it (409): the panel re-reads before Send is allowed, and the send carries the version it read", async () => {
    const gate = readGate();
    let bench = state(A, 3);
    const chat = vi.fn();
    const out = await changeSelection({
      gate,
      fetch: async () => new Response(JSON.stringify({ error: "selection_changed" }), { status: 409 }),
      url: "/sel",
      load: panelLoad(gate, async () => okState(state(B, 5)), (s) => { bench = s as BenchState; }),
      body: { threadId: SEL.threadId, componentId: B, via: "picker", expectedVersion: 3, clientRequestId: "r1" },
    });
    expect(out).toMatchObject({ ok: false });
    expect(hostSend(gate, () => riderFor(bench, SEL), chat)).toBe(true);
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ componentSelection: { componentId: B, selectionVersion: 5 } }));
  });

  it("a change lost on the network, then re-read: Send is released and carries what the server holds", async () => {
    const gate = readGate();
    let bench: BenchState | null = wholeMachine;
    const chat = vi.fn();
    const out = await changeSelection({
      gate, fetch: async () => { throw new TypeError("offline"); }, url: "/sel",
      load: panelLoad(gate, async () => okState(state(B, 4)), (s) => { bench = s; }),
      body: { threadId: SEL.threadId, componentId: B, via: "picker", expectedVersion: 3, clientRequestId: "r1" },
    });
    expect(out).toMatchObject({ ok: false });
    expect(gate.changing).toBe(false);
    expect(hostSend(gate, () => riderFor(bench, SEL), chat)).toBe(true);
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ componentSelection: { componentId: B, selectionVersion: 4 } }));
  });

  it("control: with nothing pending, Send and a change each go straight through", async () => {
    const gate = readGate();
    expect(hostSend(gate, () => null, vi.fn())).toBe(true);
    gate.endSend();
    await expect(changeSelection({
      gate, fetch: async () => new Response("{}", { status: 200 }), url: "/sel",
      load: panelLoad(gate, async () => okState(wholeMachine), () => undefined),
      body: { threadId: SEL.threadId, componentId: null, via: "picker", expectedVersion: 3, clientRequestId: "r1" },
    })).resolves.toEqual({ ok: true });
  });
});

// #5504 Codex r3 F6: a send before the checklist has been read went out as whole-machine
// even when a component was saved for the conversation.
describe("nothing is sent until the conversation's component selection has been read", () => {
  const URL = LIST;

  it("checklist still loading: Send is refused, then it carries the saved component B and its version", async () => {
    const gate = createBenchSendGate();
    let bench: BenchState | null = null;
    const get = deferred<Response>();
    const chat = vi.fn();
    const read = readBench({ gate, fetch: () => get.promise, url: URL, apply: (s) => { bench = s; } });

    expect(benchSendRefusal(gate)).toBe(SEND_LOADING_MESSAGE);
    expect(hostSend(gate, () => riderFor(bench, SEL), chat)).toBe(false);
    expect(chat).not.toHaveBeenCalled();

    get.resolve(okState(state(B, 4)));
    await expect(read).resolves.toMatchObject({ kind: "loaded" });
    expect(hostSend(gate, () => riderFor(bench, SEL), chat)).toBe(true);
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ componentSelection: { componentId: B, selectionVersion: 4 } }));
  });

  it("the first read fails on the network: Send stays refused (never whole-machine) until a read succeeds", async () => {
    const gate = createBenchSendGate();
    let bench: BenchState | null = null;
    const chat = vi.fn();
    await expect(readBench({ gate, fetch: async () => { throw new TypeError("offline"); }, url: URL, apply: (s) => { bench = s; } }))
      .resolves.toEqual({ kind: "failed" });
    expect(hostSend(gate, () => riderFor(bench, SEL), chat)).toBe(false);
    await expect(readBench({ gate, fetch: async () => new Response("", { status: 500 }), url: URL, apply: (s) => { bench = s; } }))
      .resolves.toEqual({ kind: "failed" });
    expect(hostSend(gate, () => riderFor(bench, SEL), chat)).toBe(false);
    expect(chat).not.toHaveBeenCalled();

    await readBench({ gate, fetch: async () => okState(state(B, 4)), url: URL, apply: (s) => { bench = s; } });
    expect(hostSend(gate, () => riderFor(bench, SEL), chat)).toBe(true);
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ componentSelection: { componentId: B, selectionVersion: 4 } }));
  });

  it("control: the checklist is not available (503, before migration 115): Send goes through with no component", async () => {
    const gate = createBenchSendGate();
    let bench: BenchState | null = state(A, 3);
    const chat = vi.fn();
    await expect(readBench({ gate, fetch: async () => new Response("", { status: 503 }), url: URL, apply: (s) => { bench = s; } }))
      .resolves.toEqual({ kind: "unavailable" });
    expect(hostSend(gate, () => riderFor(bench, SEL), chat)).toBe(true);
    expect(chat).toHaveBeenCalledWith({ message: "and its fuse size?", mode: "general" });
  });

  it("a new conversation starts unread, whatever the previous one knew", () => {
    expect(readGate().known).toBe(true);
    expect(benchSendRefusal(createBenchSendGate())).toBe(SEND_LOADING_MESSAGE);
  });
});

// #5504 post-cap F9: a change whose reply was lost, or whose re-read failed, left Send
// open with the whole-machine state read before it, so the next question skipped the
// component the server had saved.
describe("after an uncertain change, nothing is sent until a fresh read succeeds", () => {
  const body = { threadId: SEL.threadId, componentId: B, via: "picker", expectedVersion: 3, clientRequestId: "r1" };

  it("pick B, the PUT commits but its reply is lost and the re-read fails: Send is refused, then carries B", async () => {
    const gate = readGate();
    let bench: BenchState | null = wholeMachine;
    let server: Response | null = null; // what a checklist read returns; null = the read fails
    const chat = vi.fn();
    const load = panelLoad(gate, async () => { if (!server) throw new TypeError("offline"); return server; }, (s) => { bench = s; });

    const out = await changeSelection({ gate, fetch: async () => { throw new TypeError("reply lost"); }, url: "/sel", load, body });
    expect(out).toMatchObject({ ok: false });
    expect(gate.changing).toBe(false);
    expect(benchSendRefusal(gate)).toBe(SEND_LOADING_MESSAGE);
    expect(hostSend(gate, () => riderFor(bench, SEL), chat)).toBe(false);
    expect(chat).not.toHaveBeenCalled();

    server = okState(state(B, 4)); // the host's refresh, once the connection is back
    await load();
    expect(hostSend(gate, () => riderFor(bench, SEL), chat)).toBe(true);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ componentSelection: { componentId: B, selectionVersion: 4 } }));
  });

  it("pick B, the PUT succeeds but the re-read gets a 500: the change reports failure and Send is refused", async () => {
    const gate = readGate();
    let bench: BenchState | null = wholeMachine;
    const chat = vi.fn();
    const out = await changeSelection({
      gate, fetch: async () => new Response("{}", { status: 200 }), url: "/sel",
      load: panelLoad(gate, async () => new Response("", { status: 500 }), (s) => { bench = s; }), body,
    });
    expect(out).toMatchObject({ ok: false });
    expect(hostSend(gate, () => riderFor(bench, SEL), chat)).toBe(false);
    expect(chat).not.toHaveBeenCalled();
  });

  it("a read that began before the change and answers after it cannot reopen Send with the old state", async () => {
    const gate = readGate();
    let bench: BenchState | null = wholeMachine;
    const chat = vi.fn();
    const early = deferred<Response>();
    const put = deferred<Response>();
    const change = changeSelection({
      gate, fetch: () => put.promise, url: "/sel",
      load: panelLoad(gate, async () => new Response("", { status: 500 }), (s) => { bench = s; }), body,
    });
    // A refresh fired while the PUT is saving reads the server before the PUT commits.
    const before = readBench({ gate, fetch: () => early.promise, url: LIST, apply: (s) => { bench = s; } });
    put.resolve(new Response("{}", { status: 200 }));
    await expect(change).resolves.toMatchObject({ ok: false });
    early.resolve(okState(wholeMachine));
    await expect(before).resolves.toEqual({ kind: "stale" });
    expect(hostSend(gate, () => riderFor(bench, SEL), chat)).toBe(false);
    expect(chat).not.toHaveBeenCalled();
  });

  it("an identity revision whose reply is lost reconciles the same way", async () => {
    const gate = readGate();
    let bench: BenchState | null = state(B, 4);
    const chat = vi.fn();
    // The panel's saveCard: begin, invalidate, POST lost, reconcile.
    expect(gate.tryBeginChange()).toBe(true);
    await expect(reconcileBench(gate, panelLoad(gate, async () => { throw new TypeError("offline"); }, (s) => { bench = s; }))).resolves.toBe(false);
    gate.endChange();
    expect(hostSend(gate, () => riderFor(bench, SEL), chat)).toBe(false);
    await expect(reconcileBench(gate, panelLoad(gate, async () => okState(state(B, 5)), (s) => { bench = s; }))).resolves.toBe(true);
    expect(hostSend(gate, () => riderFor(bench, SEL), chat)).toBe(true);
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ componentSelection: { componentId: B, selectionVersion: 5 } }));
  });

  it("control: a change that answers and re-reads cleanly releases Send at once", async () => {
    const gate = readGate();
    let bench: BenchState | null = wholeMachine;
    const chat = vi.fn();
    await expect(changeSelection({
      gate, fetch: async () => new Response("{}", { status: 200 }), url: "/sel",
      load: panelLoad(gate, async () => okState(state(B, 4)), (s) => { bench = s; }), body,
    })).resolves.toEqual({ ok: true });
    expect(hostSend(gate, () => riderFor(bench, SEL), chat)).toBe(true);
  });
});
