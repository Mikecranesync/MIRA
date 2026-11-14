import { describe, expect, it, vi } from "vitest";
import {
  CHANGE_BLOCKED_MESSAGE,
  changeSelection,
  createBenchSendGate,
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
  if (!gate.tryBeginSend()) return false;
  chat(withComponentRider({ message: "and its fuse size?", mode: "general" as const }, SEL, rider()));
  return true;
}

describe("a send never overlaps a component change", () => {
  it("A→B change still saving: Send is refused, then after the checklist re-read it carries B's new version", async () => {
    const gate = createBenchSendGate();
    let bench = state(A, 3);
    const put = deferred<Response>();
    const reread = deferred<void>();
    const fetch = vi.fn(() => put.promise);
    const chat = vi.fn();
    const change = changeSelection({
      gate, fetch, url: "/sel", load: async () => { await reread.promise; bench = state(B, 4); },
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

    reread.resolve();
    await expect(change).resolves.toEqual({ ok: true });
    expect(hostSend(gate, () => riderFor(bench, SEL), chat)).toBe(true);
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ componentSelection: { componentId: B, selectionVersion: 4 } }));
  });

  it("an answer still streaming: the change is refused without a request, and allowed once the answer ends", async () => {
    const gate = createBenchSendGate();
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    const load = vi.fn(async () => undefined);
    const body = { threadId: SEL.threadId, componentId: B, via: "picker", expectedVersion: 3, clientRequestId: "r1" };
    expect(hostSend(gate, () => riderFor(state(A, 3), SEL), vi.fn())).toBe(true);

    await expect(changeSelection({ gate, fetch, url: "/sel", load, body })).resolves.toEqual({ ok: false, message: CHANGE_BLOCKED_MESSAGE });
    expect(fetch).not.toHaveBeenCalled();

    gate.endSend();
    await expect(changeSelection({ gate, fetch, url: "/sel", load, body })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("another screen moved it (409): the panel re-reads before Send is allowed, and the send carries the version it read", async () => {
    const gate = createBenchSendGate();
    let bench = state(A, 3);
    const chat = vi.fn();
    const out = await changeSelection({
      gate,
      fetch: async () => new Response(JSON.stringify({ error: "selection_changed" }), { status: 409 }),
      url: "/sel",
      load: async () => { bench = state(B, 5); },
      body: { threadId: SEL.threadId, componentId: B, via: "picker", expectedVersion: 3, clientRequestId: "r1" },
    });
    expect(out).toMatchObject({ ok: false });
    expect(hostSend(gate, () => riderFor(bench, SEL), chat)).toBe(true);
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ componentSelection: { componentId: B, selectionVersion: 5 } }));
  });

  it("a change that fails on the network still releases Send", async () => {
    const gate = createBenchSendGate();
    const out = await changeSelection({
      gate, fetch: async () => { throw new TypeError("offline"); }, url: "/sel", load: async () => undefined,
      body: { threadId: SEL.threadId, componentId: B, via: "picker", expectedVersion: 3, clientRequestId: "r1" },
    });
    expect(out).toMatchObject({ ok: false });
    expect(gate.changing).toBe(false);
    expect(hostSend(gate, () => null, vi.fn())).toBe(true);
  });

  it("control: with nothing pending, Send and a change each go straight through", async () => {
    const gate = createBenchSendGate();
    expect(hostSend(gate, () => null, vi.fn())).toBe(true);
    gate.endSend();
    await expect(changeSelection({
      gate, fetch: async () => new Response("{}", { status: 200 }), url: "/sel", load: async () => undefined,
      body: { threadId: SEL.threadId, componentId: null, via: "picker", expectedVersion: 3, clientRequestId: "r1" },
    })).resolves.toEqual({ ok: true });
  });
});
