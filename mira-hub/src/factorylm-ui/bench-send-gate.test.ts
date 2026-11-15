import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHANGE_BLOCKED_MESSAGE,
  SEND_LOADING_MESSAGE,
  SEND_UNRESOLVED_MESSAGE,
  benchSendRefusal,
  changeSelection,
  createBenchSendGate,
  expectsComponentFrame,
  isScopeRefusalCode,
  readBench,
  reconcileBench,
  prepareChatSend,
  recordBenchScope,
  type BenchScopes,
  type BenchState,
  withoutScope,
} from "./bench-components-logic";
import { NotebookHttpError } from "@/components/equipment/notebook-chat-utils";
import { livePartsWhileRunning } from "./to-interaction";

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

/** What the panel has read for each conversation — the host's map; reset per test. */
let scopes: BenchScopes = new Map();
beforeEach(() => {
  scopes = new Map();
});
/** The panel's `apply` (the host's onBenchState): records what it read for SEL's conversation. */
const record = (s: BenchState | null) => recordBenchScope(scopes, SEL, s);

/** The host's send(): the same prepareChatSend it runs before opening the chat request. */
function hostSend(gate: ReturnType<typeof createBenchSendGate>, chat: (body: unknown) => void): boolean {
  const prepared = prepareChatSend({ gate, forThisGate: true, sel: SEL, scopes, body: { message: "and its fuse size?", mode: "general" as const } });
  if (!prepared.ok) return false;
  if (!gate.tryBeginSend()) return false;
  chat(prepared.body);
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
    record(state(A, 3));
    const put = deferred<Response>();
    const reread = deferred<Response>();
    const fetch = vi.fn(() => put.promise);
    const chat = vi.fn();
    const change = changeSelection({
      gate, fetch, url: "/sel", load: panelLoad(gate, () => reread.promise, record),
      body: { threadId: SEL.threadId, componentId: B, via: "picker", expectedVersion: 3, clientRequestId: "r1" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    // Pressed while the PUT is in flight, and again while the checklist is being re-read.
    expect(hostSend(gate, chat)).toBe(false);
    put.resolve(new Response("{}", { status: 200 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(hostSend(gate, chat)).toBe(false);
    expect(chat).not.toHaveBeenCalled();

    reread.resolve(okState(state(B, 4)));
    await expect(change).resolves.toEqual({ ok: true });
    expect(hostSend(gate, chat)).toBe(true);
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ componentSelection: { threadId: "th-1", componentId: B, selectionVersion: 4 } }));
  });

  it("an answer still streaming: the change is refused without a request, and allowed once the answer ends", async () => {
    const gate = readGate();
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    const load = panelLoad(gate, async () => okState(state(B, 4)), () => undefined);
    const body = { threadId: SEL.threadId, componentId: B, via: "picker", expectedVersion: 3, clientRequestId: "r1" };
    record(state(A, 3));
    expect(hostSend(gate, vi.fn())).toBe(true);

    await expect(changeSelection({ gate, fetch, url: "/sel", load, body })).resolves.toEqual({ ok: false, message: CHANGE_BLOCKED_MESSAGE });
    expect(fetch).not.toHaveBeenCalled();

    gate.endSend();
    await expect(changeSelection({ gate, fetch, url: "/sel", load, body })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("another screen moved it (409): the panel re-reads before Send is allowed, and the send carries the version it read", async () => {
    const gate = readGate();
    record(state(A, 3));
    const chat = vi.fn();
    const out = await changeSelection({
      gate,
      fetch: async () => new Response(JSON.stringify({ error: "selection_changed" }), { status: 409 }),
      url: "/sel",
      load: panelLoad(gate, async () => okState(state(B, 5)), record),
      body: { threadId: SEL.threadId, componentId: B, via: "picker", expectedVersion: 3, clientRequestId: "r1" },
    });
    expect(out).toMatchObject({ ok: false });
    expect(hostSend(gate, chat)).toBe(true);
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ componentSelection: { threadId: "th-1", componentId: B, selectionVersion: 5 } }));
  });

  it("a change lost on the network: a successful checklist read does NOT release Send; re-sending the same request does", async () => {
    const gate = readGate();
    record(wholeMachine);
    const chat = vi.fn();
    let online = false;
    const puts: string[] = [];
    const out = await changeSelection({
      gate,
      fetch: async (_url, init) => {
        puts.push(String(init.body));
        if (!online) throw new TypeError("offline");
        return new Response("{}", { status: 200 });
      },
      url: "/sel",
      load: panelLoad(gate, async () => okState(state(B, 4)), record),
      body: { threadId: SEL.threadId, componentId: B, via: "picker", expectedVersion: 3, clientRequestId: "r1" },
    });
    expect(out).toMatchObject({ ok: false });
    expect(gate.changing).toBe(false);
    expect(gate.pending).not.toBeNull();
    // A read while the network is still down does not settle the write, however it answers.
    await expect(panelLoad(gate, async () => okState(wholeMachine), record)()).resolves.toEqual({ kind: "failed" });
    expect(hostSend(gate, chat)).toBe(false);
    online = true;
    await expect(panelLoad(gate, async () => okState(state(B, 4)), record)()).resolves.toMatchObject({ kind: "loaded" });
    expect(gate.pending).toBeNull();
    // Every attempt was the same request: same body, same request id.
    expect(new Set(puts).size).toBe(1);
    expect(JSON.parse(puts[0]!)).toMatchObject({ clientRequestId: "r1", componentId: B });
    expect(hostSend(gate, chat)).toBe(true);
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ componentSelection: { threadId: "th-1", componentId: B, selectionVersion: 4 } }));
  });

  it("control: with nothing pending, Send and a change each go straight through", async () => {
    const gate = readGate();
    expect((record(wholeMachine), hostSend(gate, vi.fn()))).toBe(true);
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
        const get = deferred<Response>();
    const chat = vi.fn();
    const read = readBench({ gate, fetch: () => get.promise, url: URL, apply: record });

    expect(benchSendRefusal(gate)).toBe(SEND_LOADING_MESSAGE);
    expect(hostSend(gate, chat)).toBe(false);
    expect(chat).not.toHaveBeenCalled();

    get.resolve(okState(state(B, 4)));
    await expect(read).resolves.toMatchObject({ kind: "loaded" });
    expect(hostSend(gate, chat)).toBe(true);
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ componentSelection: { threadId: "th-1", componentId: B, selectionVersion: 4 } }));
  });

  it("the first read fails on the network: Send stays refused (never whole-machine) until a read succeeds", async () => {
    const gate = createBenchSendGate();
        const chat = vi.fn();
    await expect(readBench({ gate, fetch: async () => { throw new TypeError("offline"); }, url: URL, apply: record }))
      .resolves.toEqual({ kind: "failed" });
    expect(hostSend(gate, chat)).toBe(false);
    await expect(readBench({ gate, fetch: async () => new Response("", { status: 500 }), url: URL, apply: record }))
      .resolves.toEqual({ kind: "failed" });
    expect(hostSend(gate, chat)).toBe(false);
    expect(chat).not.toHaveBeenCalled();

    await readBench({ gate, fetch: async () => okState(state(B, 4)), url: URL, apply: record });
    expect(hostSend(gate, chat)).toBe(true);
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ componentSelection: { threadId: "th-1", componentId: B, selectionVersion: 4 } }));
  });

  it("control: the checklist is not available (503, before migration 115): Send goes through with no component", async () => {
    const gate = createBenchSendGate();
    record(state(A, 3));
    const chat = vi.fn();
    await expect(readBench({ gate, fetch: async () => new Response("", { status: 503 }), url: URL, apply: record }))
      .resolves.toEqual({ kind: "unavailable" });
    expect(hostSend(gate, chat)).toBe(true);
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

  it("pick B, the PUT's reply is lost and the re-read fails: Send is refused, then carries B once the PUT is answered", async () => {
    const gate = readGate();
    record(wholeMachine);
    let server: Response | null = null; // what a checklist read returns; null = the read fails
    let online = false;
    const chat = vi.fn();
    const load = panelLoad(gate, async () => { if (!server) throw new TypeError("offline"); return server; }, record);
    const put = async () => { if (!online) throw new TypeError("reply lost"); return new Response("{}", { status: 200 }); };

    const out = await changeSelection({ gate, fetch: put, url: "/sel", load, body });
    expect(out).toMatchObject({ ok: false });
    expect(gate.changing).toBe(false);
    expect(benchSendRefusal(gate)).toBe(SEND_UNRESOLVED_MESSAGE);
    expect(hostSend(gate, chat)).toBe(false);
    expect(chat).not.toHaveBeenCalled();

    online = true;
    server = okState(state(B, 4)); // the host's refresh, once the connection is back
    await load();
    expect(hostSend(gate, chat)).toBe(true);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ componentSelection: { threadId: "th-1", componentId: B, selectionVersion: 4 } }));
  });

  it("pick B, the PUT succeeds but the re-read gets a 500: the change reports failure and Send is refused", async () => {
    const gate = readGate();
    record(wholeMachine);
    const chat = vi.fn();
    const out = await changeSelection({
      gate, fetch: async () => new Response("{}", { status: 200 }), url: "/sel",
      load: panelLoad(gate, async () => new Response("", { status: 500 }), record), body,
    });
    expect(out).toMatchObject({ ok: false });
    expect(hostSend(gate, chat)).toBe(false);
    expect(chat).not.toHaveBeenCalled();
  });

  it("a read that began before the change and answers after it cannot reopen Send with the old state", async () => {
    const gate = readGate();
    record(wholeMachine);
    const chat = vi.fn();
    const early = deferred<Response>();
    const put = deferred<Response>();
    const change = changeSelection({
      gate, fetch: () => put.promise, url: "/sel",
      load: panelLoad(gate, async () => new Response("", { status: 500 }), record), body,
    });
    // A refresh fired while the PUT is saving reads the server before the PUT commits.
    const before = readBench({ gate, fetch: () => early.promise, url: LIST, apply: record });
    put.resolve(new Response("{}", { status: 200 }));
    await expect(change).resolves.toMatchObject({ ok: false });
    early.resolve(okState(wholeMachine));
    await expect(before).resolves.toEqual({ kind: "stale" });
    expect(hostSend(gate, chat)).toBe(false);
    expect(chat).not.toHaveBeenCalled();
  });

  it("an identity revision whose reply is lost reconciles the same way", async () => {
    const gate = readGate();
    record(state(B, 4));
    const chat = vi.fn();
    // The panel's saveCard: begin, invalidate, POST lost, reconcile.
    expect(gate.tryBeginChange()).toBe(true);
    await expect(reconcileBench(gate, panelLoad(gate, async () => { throw new TypeError("offline"); }, record))).resolves.toBe(false);
    gate.endChange();
    expect(hostSend(gate, chat)).toBe(false);
    await expect(reconcileBench(gate, panelLoad(gate, async () => okState(state(B, 5)), record))).resolves.toBe(true);
    expect(hostSend(gate, chat)).toBe(true);
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ componentSelection: { threadId: "th-1", componentId: B, selectionVersion: 5 } }));
  });

  it("control: a change that answers and re-reads cleanly releases Send at once", async () => {
    const gate = readGate();
    record(wholeMachine);
    const chat = vi.fn();
    await expect(changeSelection({
      gate, fetch: async () => new Response("{}", { status: 200 }), url: "/sel",
      load: panelLoad(gate, async () => okState(state(B, 4)), record), body,
    })).resolves.toEqual({ ok: true });
    expect(hostSend(gate, chat)).toBe(true);
  });
});

describe("#5504 Codex post-cap 3: a gateway error never settles an uncertain change (F13, #5535)", () => {
  const body = { threadId: SEL.threadId, componentId: B, via: "picker", expectedVersion: 3, clientRequestId: "r9" };

  it("pick B, the reply is lost, the re-send gets a 504 while the list still shows the old state: Send stays refused", async () => {
    const gate = readGate();
    record(wholeMachine);
    const chat = vi.fn();
    let mode: "offline" | "gateway" | "answered" = "offline";
    const put = async () => {
      if (mode === "offline") throw new TypeError("offline");
      if (mode === "gateway") return new Response("upstream timeout", { status: 504 });
      return new Response("{}", { status: 200 });
    };
    const out = await changeSelection({ gate, fetch: put, url: "/sel", load: panelLoad(gate, async () => okState(state(B, 4)), record), body });
    expect(out).toMatchObject({ ok: false });
    expect(gate.pending).not.toBeNull();
    mode = "gateway";
    // The re-send answers 504 and the list still reads the old whole-machine state.
    await expect(panelLoad(gate, async () => okState(wholeMachine), record)()).resolves.toEqual({ kind: "failed" });
    expect(gate.pending).not.toBeNull();
    expect(benchSendRefusal(gate)).toBe(SEND_UNRESOLVED_MESSAGE);
    expect(hostSend(gate, chat)).toBe(false);
    expect(chat).not.toHaveBeenCalled();
    // The same request finally gets the app's answer: then Send carries B.
    mode = "answered";
    await expect(panelLoad(gate, async () => okState(state(B, 4)), record)()).resolves.toMatchObject({ kind: "loaded" });
    expect(gate.pending).toBeNull();
    expect(hostSend(gate, chat)).toBe(true);
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ componentSelection: { threadId: "th-1", componentId: B, selectionVersion: 4 } }));
  });

  it("pick B and every attempt gets a 502: the change is left pending, never settled by the old list", async () => {
    const gate = readGate();
    record(wholeMachine);
    const chat = vi.fn();
    const put = vi.fn(async () => new Response("bad gateway", { status: 502 }));
    const out = await changeSelection({ gate, fetch: put, url: "/sel", load: panelLoad(gate, async () => okState(wholeMachine), record), body });
    expect(out).toMatchObject({ ok: false });
    expect(put).toHaveBeenCalledTimes(3);
    expect(gate.pending).not.toBeNull();
    expect(hostSend(gate, chat)).toBe(false);
  });

  it("control: a definite app refusal (409) on the re-send does settle it, and the re-read decides", async () => {
    const gate = readGate();
    record(wholeMachine);
    const chat = vi.fn();
    let online = false;
    const put = async () => {
      if (!online) throw new TypeError("offline");
      return new Response(JSON.stringify({ error: "selection_changed" }), { status: 409 });
    };
    await changeSelection({ gate, fetch: put, url: "/sel", load: panelLoad(gate, async () => okState(wholeMachine), record), body });
    online = true;
    await expect(panelLoad(gate, async () => okState(state(A, 5)), record)()).resolves.toMatchObject({ kind: "loaded" });
    expect(gate.pending).toBeNull();
    expect(hostSend(gate, chat)).toBe(true);
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ componentSelection: { threadId: "th-1", componentId: A, selectionVersion: 5 } }));
  });
});

describe("#5504 Codex post-cap 3: whole-machine answers stream as they arrive (F11, #5533)", () => {
  it("a whole-machine send does not hold its text for a component frame; a component send does", () => {
    const gate = readGate();
    record(wholeMachine);
    const bodies: object[] = [];
    expect(hostSend(gate, (b) => bodies.push(b as object))).toBe(true);
    gate.endSend();
    expect(bodies[0]).toMatchObject({ componentSelection: { componentId: null } });
    // What the host's send() puts on the live turn, and what the live render shows mid-stream.
    const wholeExpected = expectsComponentFrame(bodies[0]!);
    expect(wholeExpected).toBe(false);
    expect(livePartsWhileRunning("Rated current is 4.2 A", undefined, { expected: wholeExpected, label: null })).toEqual([
      { type: "text", text: "Rated current is 4.2 A" },
    ]);
    record(state(B, 4));
    expect(hostSend(gate, (b) => bodies.push(b as object))).toBe(true);
    const componentExpected = expectsComponentFrame(bodies[1]!);
    expect(componentExpected).toBe(true);
    expect(livePartsWhileRunning("Rated current is 4.2 A", undefined, { expected: componentExpected, label: null })).toEqual([]);
  });
});

describe("#5504 Codex post-cap 3: a scope refusal inside the progress stream re-scopes the retry (F12, #5534)", () => {
  it("selection_changed delivered as a stream error: the retry is asked again under what the header shows now", () => {
    const gate = readGate();
    record(state(A, 1));
    const bodies: object[] = [];
    expect(hostSend(gate, (b) => bodies.push(b as object))).toBe(true);
    gate.endSend();
    const sent = bodies[0]!;
    // The host's catch: the refusal arrives as a NotebookHttpError from the progress stream.
    const caught: unknown = new NotebookHttpError(409, "selection_changed");
    const scopeRefused = caught instanceof NotebookHttpError && isScopeRefusalCode(caught.code);
    expect(scopeRefused).toBe(true);
    const failed = scopeRefused ? withoutScope(sent) : sent;
    // The checklist re-read now shows B; Retry re-scopes the kept body from the header.
    record(state(B, 2));
    const retried = prepareChatSend({ gate, forThisGate: true, sel: SEL, scopes, body: failed as { message: string } });
    expect(retried).toMatchObject({ ok: true, body: { componentSelection: { threadId: "th-1", componentId: B, selectionVersion: 2 } } });
  });

  it("control: other stream errors are not scope refusals, so the retry keeps the scope it was asked under", () => {
    expect(isScopeRefusalCode("provider_unavailable")).toBe(false);
    expect(isScopeRefusalCode("component_selection_thread_mismatch")).toBe(true);
  });
});
