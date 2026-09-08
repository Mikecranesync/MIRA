import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  data: new Map<string, string>(),
  httpRequest: vi.fn(),
  beforePreferenceSet: null as null | ((key: string, value: string) => Promise<void>),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  CapacitorHttp: { request: state.httpRequest },
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: state.data.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      await state.beforePreferenceSet?.(key, value);
      state.data.set(key, value);
    }),
  },
}));

import {
  clearAllLocalState,
  request,
  requestBinary,
  requestStream,
} from "../../api/client";

const JAR_KEY = "flm.cookiejar.v1";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  state.data.clear();
  state.httpRequest.mockReset();
  state.beforePreferenceSet = null;
  vi.restoreAllMocks();
  await clearAllLocalState();
});

describe("native session-cookie purge barrier", () => {
  it("does not let a delayed native request restore a cookie after sign-out", async () => {
    const response = deferred<{
      status: number;
      data: string;
      headers: Record<string, string>;
    }>();
    state.httpRequest.mockReturnValueOnce(response.promise);

    const pending = request("/api/delayed/");
    await vi.waitFor(() => expect(state.httpRequest).toHaveBeenCalledTimes(1));
    await clearAllLocalState();
    response.resolve({
      status: 200,
      data: "{}",
      headers: { "Set-Cookie": "session-token=late; Path=/" },
    });

    await pending;
    expect(JSON.parse(state.data.get(JAR_KEY) ?? "null")).toEqual({});
  });

  it("does not let delayed native streamed headers restore a cookie after sign-out", async () => {
    const response = deferred<Response>();
    vi.spyOn(globalThis, "fetch").mockReturnValueOnce(response.promise);

    const pending = requestStream("/api/delayed-stream/", {
      json: {},
      onChunk: () => {},
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await clearAllLocalState();
    response.resolve(new Response("done", {
      status: 200,
      headers: { "Set-Cookie": "session-token=late; Path=/" },
    }));

    await pending;
    expect(JSON.parse(state.data.get(JAR_KEY) ?? "null")).toEqual({});
  });

  it("does not let a delayed native binary response restore a cookie after sign-out", async () => {
    const response = deferred<{
      status: number;
      data: string;
      headers: Record<string, string>;
    }>();
    state.httpRequest.mockReturnValueOnce(response.promise);

    const pending = requestBinary("/api/delayed-file/");
    await vi.waitFor(() => expect(state.httpRequest).toHaveBeenCalledTimes(1));
    await clearAllLocalState();
    response.resolve({
      status: 200,
      data: "AQI=",
      headers: {
        "Content-Type": "application/octet-stream",
        "Set-Cookie": "session-token=late; Path=/",
      },
    });

    await pending;
    expect(JSON.parse(state.data.get(JAR_KEY) ?? "null")).toEqual({});
  });

  it("serializes a purge behind a cookie save that was already writing", async () => {
    const writeStarted = deferred<void>();
    const releaseWrite = deferred<void>();
    state.beforePreferenceSet = async (key, value) => {
      if (key === JAR_KEY && value.includes("late")) {
        writeStarted.resolve();
        await releaseWrite.promise;
      }
    };
    state.httpRequest.mockResolvedValueOnce({
      status: 200,
      data: "{}",
      headers: { "Set-Cookie": "session-token=late; Path=/" },
    });

    const requestFinishing = request("/api/late-save/");
    await writeStarted.promise;
    const purge = clearAllLocalState();
    releaseWrite.resolve();

    await requestFinishing;
    await purge;
    expect(JSON.parse(state.data.get(JAR_KEY) ?? "null")).toEqual({});
  });
});
