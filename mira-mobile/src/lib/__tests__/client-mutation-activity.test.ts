import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
  CapacitorHttp: { request: vi.fn() },
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async () => ({ value: null })),
    set: vi.fn(async () => undefined),
  },
}));

import {
  hasActiveApiMutations,
  request,
  requestStream,
  uploadMultipart,
} from "../../api/client";

function deferredResponse(response: Response) {
  let release!: () => void;
  const promise = new Promise<Response>((resolve) => {
    release = () => resolve(response);
  });
  return { promise, release };
}

describe("API mutation activity", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("tracks an ordinary mutation until its response settles", async () => {
    const gate = deferredResponse(new Response("{}", { status: 200 }));
    vi.spyOn(globalThis, "fetch").mockReturnValue(gate.promise);

    const pending = request("/api/work-orders/", { method: "POST", json: { title: "jam" } });
    await vi.waitFor(() => expect(hasActiveApiMutations()).toBe(true));

    gate.release();
    await pending;
    expect(hasActiveApiMutations()).toBe(false);
  });

  it("tracks multipart uploads until their response settles", async () => {
    const gate = deferredResponse(new Response("{}", { status: 200 }));
    vi.spyOn(globalThis, "fetch").mockReturnValue(gate.promise);

    const pending = uploadMultipart("/api/files/", new FormData());
    await vi.waitFor(() => expect(hasActiveApiMutations()).toBe(true));

    gate.release();
    await pending;
    expect(hasActiveApiMutations()).toBe(false);
  });

  it("tracks chat streams until the body has finished", async () => {
    let close!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("first"));
        close = () => controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status: 200 }));

    const pending = requestStream("/api/chat/", { json: {}, onChunk: () => {} });
    await vi.waitFor(() => expect(hasActiveApiMutations()).toBe(true));

    close();
    await pending;
    expect(hasActiveApiMutations()).toBe(false);
  });
});
