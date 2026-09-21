// Staging isolation (Mike, 2026-09-21): a native build whose BuildConfig
// bridge fails must NEVER silently route API traffic, OTA checks, or deep-link
// trust to production. These tests drive the REAL client/tags/live-update code
// with a Capacitor mock whose BuildConfig plugin (a) rejects, (b) answers
// staging, (c) answers production, and assert what each reaches.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Flavor = "reject" | "staging" | "production" | "malformed";
const flavor = { current: "reject" as Flavor };

const httpRequest = vi.fn(async (_opts: { url: string }) => ({ status: 200, headers: {}, data: { ok: true } }));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" },
  CapacitorHttp: { request: (opts: { url: string }) => httpRequest(opts) },
  registerPlugin: (name: string) =>
    name === "BuildConfig"
      ? {
          getApiBase: async () => {
            if (flavor.current === "reject") throw new Error('"BuildConfig" plugin is not implemented on android');
            if (flavor.current === "malformed") return { apiBase: "" };
            return {
              apiBase:
                flavor.current === "staging" ? "https://app-staging.factorylm.com" : "https://app.factorylm.com",
            };
          },
          getDeepLinkConfig: async () => {
            if (flavor.current === "reject") throw new Error('"BuildConfig" plugin is not implemented on android');
            if (flavor.current === "malformed") return { host: "", scheme: "" };
            return flavor.current === "staging"
              ? { host: "app-staging.factorylm.com", scheme: "factorylmstaging" }
              : { host: "app.factorylm.com", scheme: "factorylm" };
          },
        }
      : {},
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: async () => ({ value: null }), set: async () => {}, remove: async () => {} },
}));

const globalFetch = vi.fn(async (_input: RequestInfo | URL) => new Response("{}", { status: 200 }));
vi.stubGlobal("fetch", globalFetch);

import { BuildConfigUnavailableError, resolveApiBase, resolveDeepLinkConfig } from "../build-config";
import { ApiError, __resetApiBaseForTests, request } from "../../api/client";
import { __resetTagParserForTests, extractAssetTag, initTagParser, isTrustedDeepLink } from "../../lib/tags";

function reachedProduction(): boolean {
  const urls = [
    ...httpRequest.mock.calls.map((c) => String(c[0]?.url ?? "")),
    ...globalFetch.mock.calls.map((c) => String(c[0])),
  ];
  return urls.some((u) => u.includes("app.factorylm.com"));
}

beforeEach(() => {
  httpRequest.mockClear();
  globalFetch.mockClear();
  __resetApiBaseForTests();
  __resetTagParserForTests();
});

describe("resolver contract", () => {
  it("rejects with BuildConfigUnavailableError when the native bridge fails — no fallback value", async () => {
    flavor.current = "reject";
    await expect(resolveApiBase()).rejects.toBeInstanceOf(BuildConfigUnavailableError);
    await expect(resolveDeepLinkConfig()).rejects.toBeInstanceOf(BuildConfigUnavailableError);
  });
  it("rejects a malformed answer instead of trusting it", async () => {
    flavor.current = "malformed";
    await expect(resolveApiBase()).rejects.toBeInstanceOf(BuildConfigUnavailableError);
    await expect(resolveDeepLinkConfig()).rejects.toBeInstanceOf(BuildConfigUnavailableError);
  });
  it("staging flavor resolves staging", async () => {
    flavor.current = "staging";
    await expect(resolveApiBase()).resolves.toBe("https://app-staging.factorylm.com");
    await expect(resolveDeepLinkConfig()).resolves.toEqual({ host: "app-staging.factorylm.com", scheme: "factorylmstaging" });
  });
  it("production flavor resolves production", async () => {
    flavor.current = "production";
    await expect(resolveApiBase()).resolves.toBe("https://app.factorylm.com");
    await expect(resolveDeepLinkConfig()).resolves.toEqual({ host: "app.factorylm.com", scheme: "factorylm" });
  });
});

describe("API client on native", () => {
  it("a failed bridge makes every request fail with a typed network error and reaches NO host", async () => {
    flavor.current = "reject";
    const err = await request("/api/me/").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe("network");
    expect(httpRequest).not.toHaveBeenCalled();
    expect(globalFetch).not.toHaveBeenCalled();
    expect(reachedProduction()).toBe(false);
  });
  it("retries resolution on the next request once the bridge answers", async () => {
    flavor.current = "reject";
    await request("/api/me/").catch(() => undefined);
    flavor.current = "staging";
    await request("/api/me/").catch(() => undefined);
    expect(httpRequest).toHaveBeenCalled();
    const url = String(httpRequest.mock.calls[0]?.[0]?.url);
    expect(url.startsWith("https://app-staging.factorylm.com/")).toBe(true);
    expect(reachedProduction()).toBe(false);
  });
  it("staging flavor requests go to staging only", async () => {
    flavor.current = "staging";
    await request("/api/me/").catch(() => undefined);
    expect(String(httpRequest.mock.calls[0]?.[0]?.url)).toMatch(/^https:\/\/app-staging\.factorylm\.com\//);
    expect(reachedProduction()).toBe(false);
  });
  it("production flavor requests go to production", async () => {
    flavor.current = "production";
    await request("/api/me/").catch(() => undefined);
    expect(String(httpRequest.mock.calls[0]?.[0]?.url)).toMatch(/^https:\/\/app\.factorylm\.com\//);
  });
});

describe("deep-link trust on native", () => {
  it("a failed bridge trusts NOTHING — not production, not staging, not the custom schemes", async () => {
    flavor.current = "reject";
    await initTagParser();
    expect(isTrustedDeepLink("https://app.factorylm.com/m/ROCK-1")).toBe(false);
    expect(isTrustedDeepLink("https://app-staging.factorylm.com/m/ROCK-1")).toBe(false);
    expect(extractAssetTag("factorylm://m/ROCK-1")).toBeNull();
    expect(extractAssetTag("factorylmstaging://m/ROCK-1")).toBeNull();
  });
  it("staging flavor trusts only staging origins", async () => {
    flavor.current = "staging";
    await initTagParser();
    expect(isTrustedDeepLink("https://app-staging.factorylm.com/m/ROCK-1")).toBe(true);
    expect(isTrustedDeepLink("https://app.factorylm.com/m/ROCK-1")).toBe(false);
    expect(extractAssetTag("factorylmstaging://m/ROCK-1")).toBe("ROCK-1");
    expect(extractAssetTag("factorylm://m/ROCK-1")).toBeNull();
  });
  it("production flavor trusts only production origins", async () => {
    flavor.current = "production";
    await initTagParser();
    expect(isTrustedDeepLink("https://app.factorylm.com/m/ROCK-1")).toBe(true);
    expect(isTrustedDeepLink("https://app-staging.factorylm.com/m/ROCK-1")).toBe(false);
    expect(extractAssetTag("factorylm://m/ROCK-1")).toBe("ROCK-1");
  });
});

describe("source guard", () => {
  it("no runtime module carries a production-origin fallback literal", () => {
    for (const f of ["src/api/client.ts", "src/lib/tags.ts", "src/lib/live-update.ts", "src/plugins/build-config.ts"]) {
      const src = readFileSync(resolve(__dirname, "../../..", f), "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
        .join("\n");
      expect(src, f).not.toMatch(/https?:\/\/app\.factorylm\.com/);
    }
  });
});
