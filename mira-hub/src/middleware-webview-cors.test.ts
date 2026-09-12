import { afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";
import middleware from "./middleware";

// #3453 — the native app's WebView (https://localhost on Android) calls the
// notebook routes cross-origin once mobile stops using the CapacitorHttp
// fetch patch for the chat SSE. These pin the Hub half: env-driven allowlist,
// exact-origin echo (never *), credentials on, preflight answered before the
// session gate, and — most important — flag off ⇒ headers byte-identical.
//
// No session cookie is set, so the core middleware returns its 401 JSON for
// /api/* — which is exactly the response the app must be able to READ.

const CHAT = "/api/equipment-notebooks/22222222-2222-4222-8222-222222222222/chat/";
const APP = "https://localhost";

function call(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  const req = new NextRequest(new URL(`http://hub.test${path}`), {
    method: init.method ?? "GET",
    headers: init.headers,
  });
  return middleware(req, {} as NextFetchEvent);
}

afterEach(() => vi.unstubAllEnvs());

describe("middleware — WebView CORS flag OFF (default)", () => {
  it("OPTIONS preflight from the app origin is NOT answered — existing 401, no ACAO", async () => {
    vi.stubEnv("MOBILE_WEBVIEW_ORIGINS", "");
    const res = await call(CHAT, {
      method: "OPTIONS",
      headers: { origin: APP, "access-control-request-method": "POST" },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("POST from the app origin gets no CORS headers (unchanged)", async () => {
    const res = await call(CHAT, { method: "POST", headers: { origin: APP } });
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBeNull();
    // Security headers still applied, as before.
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
  });
});

describe("middleware — WebView CORS flag ON", () => {
  it("answers the chat preflight with the exact origin, credentials, Vary and the asked headers", async () => {
    vi.stubEnv("MOBILE_WEBVIEW_ORIGINS", "https://localhost,capacitor://localhost");
    const res = await call(CHAT, {
      method: "OPTIONS",
      headers: {
        origin: APP,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(APP);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("vary")).toBe("Origin");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toBe("content-type");
    // The preflight still carries the site security headers.
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
  });

  it("echoes the origin on the actual response (here the unauthenticated 401) so the app can read it", async () => {
    vi.stubEnv("MOBILE_WEBVIEW_ORIGINS", "https://localhost");
    const res = await call(CHAT, { method: "POST", headers: { origin: APP } });
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe(APP);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("covers the other notebook routes the app calls (list, sources, passage)", async () => {
    vi.stubEnv("MOBILE_WEBVIEW_ORIGINS", "https://localhost");
    for (const p of [
      "/api/equipment-notebooks/",
      "/api/equipment-notebooks/x/sources/",
      "/api/equipment-notebooks/x/sources/y/passage/",
    ]) {
      const res = await call(p, { method: "OPTIONS", headers: { origin: APP } });
      expect(res.status, p).toBe(204);
      expect(res.headers.get("access-control-allow-origin"), p).toBe(APP);
    }
  });

  it("a disallowed origin gets NO ACAO header and the normal 401 (preflight and real request)", async () => {
    vi.stubEnv("MOBILE_WEBVIEW_ORIGINS", "https://localhost");
    for (const method of ["OPTIONS", "POST"]) {
      const res = await call(CHAT, { method, headers: { origin: "https://evil.example" } });
      expect(res.status, method).toBe(401);
      expect(res.headers.get("access-control-allow-origin"), method).toBeNull();
      expect(res.headers.get("access-control-allow-credentials"), method).toBeNull();
    }
  });

  it("a request with no Origin header gets no CORS headers", async () => {
    vi.stubEnv("MOBILE_WEBVIEW_ORIGINS", "https://localhost");
    const res = await call(CHAT, { method: "POST" });
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("an allowed origin outside the notebook routes gets no CORS headers", async () => {
    vi.stubEnv("MOBILE_WEBVIEW_ORIGINS", "https://localhost");
    for (const p of ["/api/assets/", "/api/files/abc/", "/feed/"]) {
      const res = await call(p, { method: "OPTIONS", headers: { origin: APP } });
      expect(res.headers.get("access-control-allow-origin"), p).toBeNull();
    }
  });

  it("never grants a wildcard — MOBILE_WEBVIEW_ORIGINS=* is ignored", async () => {
    vi.stubEnv("MOBILE_WEBVIEW_ORIGINS", "*");
    const res = await call(CHAT, { method: "OPTIONS", headers: { origin: APP } });
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
