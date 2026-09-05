// STRM-1 / STRM-2 transport seam: `requestStream` delivers body chunks as
// they arrive and honors AbortSignal. Dev-browser branch (fetch + vite
// proxy); the native branch differs only in the Cookie header.
//
// Run: cd mira-mobile && bunx vitest run src/lib/__tests__/request-stream

import { describe, it, expect, vi, beforeEach } from "vitest";

const { nativePlatform } = vi.hoisted(() => ({ nativePlatform: { value: false } }));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => nativePlatform.value },
  CapacitorHttp: { request: vi.fn() },
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: vi.fn(async () => ({ value: null })), set: vi.fn(async () => {}) },
}));

import { requestStream, ApiError, canCancelChatTransport } from "../../api/client";

function streamOf(chunks: string[], opts: { status?: number; gate?: () => Promise<void> } = {}) {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(c) {
      for (const ch of chunks) {
        if (opts.gate) await opts.gate();
        c.enqueue(enc.encode(ch));
      }
      c.close();
    },
  });
  return new Response(body, { status: opts.status ?? 200, headers: { "content-type": "text/event-stream" } });
}

describe("requestStream", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    nativePlatform.value = false;
  });

  it("only advertises real cancellation on the browser streaming transport", () => {
    expect(canCancelChatTransport()).toBe(true);
    nativePlatform.value = true;
    expect(canCancelChatTransport()).toBe(false);
  });

  it("calls onChunk per body chunk, in order, and returns the whole text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(streamOf(["a\n\n", "b\n\n", "c"]));
    const seen: string[] = [];
    const r = await requestStream("/api/x", { json: { q: 1 }, onChunk: (c) => seen.push(c) });
    expect(seen).toEqual(["a\n\n", "b\n\n", "c"]);
    expect(r.text).toBe("a\n\nb\n\nc");
    expect(r.status).toBe(200);
    const [, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ q: 1 }));
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("non-2xx throws the typed ApiError (no partial body leaks as an answer)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "bad gateway" }), { status: 502 }),
    );
    const onChunk = vi.fn();
    await expect(requestStream("/api/x", { json: {}, onChunk })).rejects.toMatchObject({
      kind: "server",
      status: 502,
    });
    expect(onChunk).not.toHaveBeenCalled();
  });

  it("transport failure → ApiError(network)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(requestStream("/api/x", { json: {}, onChunk: () => {} })).rejects.toBeInstanceOf(ApiError);
  });

  it("abort mid-stream rejects with an AbortError after the chunks already delivered", async () => {
    const ctl = new AbortController();
    let release: () => void = () => {};
    let n = 0;
    const gate = () =>
      new Promise<void>((res) => {
        n++;
        if (n === 1) res();
        else release = res;
      });
    // The mock body does NOT reject on abort (that is what a buffered
    // Capacitor Response looks like) — the seam must stop delivery itself.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(streamOf(["first\n\n", "second\n\n"], { gate }));
    const seen: string[] = [];
    const p = requestStream("/api/x", { json: {}, onChunk: (c) => seen.push(c), signal: ctl.signal });
    await vi.waitFor(() => expect(seen).toEqual(["first\n\n"]));
    ctl.abort(new DOMException("Stopped", "AbortError"));
    release();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(seen).toEqual(["first\n\n"]);
  });
});
