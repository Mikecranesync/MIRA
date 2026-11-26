// #5942: the app asks the Hub to email a single-use sign-in link. Mocked transport
// only: nothing here reaches a real Hub or sends real mail.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  data: new Map<string, string>(),
  httpRequest: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  registerPlugin: (name: string) =>
    name === "BuildConfig"
      ? {
          getApiBase: async () => ({ apiBase: "https://app.factorylm.com" }),
          getDeepLinkConfig: async () => ({ host: "app.factorylm.com", scheme: "factorylm" }),
        }
      : {},
  Capacitor: { isNativePlatform: () => true },
  CapacitorHttp: { request: state.httpRequest },
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: state.data.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      state.data.set(key, value);
    }),
  },
}));

import { clearAllLocalState } from "../../../api/client";
import { requestSignInLink } from "../sign-in-link";

beforeEach(async () => {
  state.data.clear();
  state.httpRequest.mockReset();
  await clearAllLocalState();
});

function answer(status: number, body: unknown) {
  state.httpRequest.mockResolvedValue({ status, data: JSON.stringify(body), headers: {} });
}

describe("requestSignInLink", () => {
  it("posts the trimmed email once to the Hub's sign-in-link route", async () => {
    answer(200, { ok: true });
    expect(await requestSignInLink("  tech@plant.example ")).toEqual({ ok: true });
    expect(state.httpRequest).toHaveBeenCalledTimes(1);
    const call = state.httpRequest.mock.calls[0][0];
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://app.factorylm.com/api/auth/magic-link/");
    expect(JSON.parse(call.data)).toEqual({ email: "tech@plant.example" });
  });

  it.each([
    [400, "invalid_email"],
    [429, "rate_limited"],
    [503, "unavailable"],
    [500, "server"],
  ])("HTTP %i is reported as %s", async (status, reason) => {
    answer(status, { error: "x" });
    expect(await requestSignInLink("tech@plant.example")).toEqual({ ok: false, reason });
    expect(state.httpRequest).toHaveBeenCalledTimes(1);
  });

  it("a transport failure is reported as network and never resent (one mail at most)", async () => {
    state.httpRequest.mockRejectedValue(new Error("offline"));
    expect(await requestSignInLink("tech@plant.example")).toEqual({ ok: false, reason: "network" });
    expect(state.httpRequest).toHaveBeenCalledTimes(1);
  });

  it("an empty email is refused without contacting the Hub", async () => {
    expect(await requestSignInLink("   ")).toEqual({ ok: false, reason: "invalid_email" });
    expect(state.httpRequest).not.toHaveBeenCalled();
  });
});
