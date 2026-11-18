import { describe, it, expect, vi } from "vitest";
import { encode } from "next-auth/jwt";
import { NextRequest, type NextFetchEvent } from "next/server";
import middleware from "./middleware";

// Next strips the `/hub` basePath before invoking middleware, so the paths the
// middleware actually sees are basePath-relative ("/" for the bare /hub root,
// "/feed/" for /hub/feed/). We construct requests with those stripped paths.
// No session cookie is set → the unauthenticated branch returns before any JWE
// decode, so these tests need no AUTH_SECRET / jose work.
function unauth(path: string) {
  const req = new NextRequest(new URL(`http://localhost${path}`));
  return middleware(req, {} as NextFetchEvent);
}

function callbackOf(res: Response) {
  const loc = res.headers.get("location");
  if (!loc) throw new Error("expected a redirect Location header");
  const url = new URL(loc);
  // Strip the optional trailing slash (trailingSlash: true) so "/login" and
  // "/login/" compare equal — only the callbackUrl value matters for this bug.
  return { pathname: url.pathname.replace(/\/$/, "") || "/", callbackUrl: url.searchParams.get("callbackUrl") };
}

describe("middleware — unauthenticated callback preservation (#1952)", () => {
  it("preserves the basepath root as the callback instead of /feed", async () => {
    const res = await unauth("/");
    const { pathname, callbackUrl } = callbackOf(res);
    expect(pathname).toBe("/login");
    // The bug: root was pre-redirected to /feed, so the callback became /feed.
    expect(callbackUrl).toBe("/");
    expect(callbackUrl).not.toBe("/feed");
    expect(callbackUrl).not.toBe("/feed/");
  });

  it("does NOT pre-redirect an unauthenticated root request to /feed", async () => {
    const res = await unauth("/");
    // Must bounce to /login, never straight to /feed (which would drop the dest).
    expect(callbackOf(res).pathname).toBe("/login");
  });

  it("still preserves /feed for the existing feed login flow", async () => {
    const res = await unauth("/feed/");
    const { pathname, callbackUrl } = callbackOf(res);
    expect(pathname).toBe("/login");
    expect(callbackUrl).toBe("/feed/");
  });

  it("preserves an arbitrary protected route as its own callback", async () => {
    const res = await unauth("/assets/");
    expect(callbackOf(res).callbackUrl).toBe("/assets/");
  });
});

// The CSP header is applied to EVERY response (incl. the unauth redirect), so we
// can assert directive membership off the redirect without a session.
describe("middleware — CSP allows the cloud-picker SDKs (#1902)", () => {
  function directive(res: Response, name: string): string {
    const csp = res.headers.get("content-security-policy") ?? "";
    return csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(name + " ")) ?? "";
  }

  it("allows Dropbox dropins.js (script-src) so window.Dropbox is defined", async () => {
    const res = await unauth("/knowledge/manuals/");
    expect(directive(res, "script-src")).toContain("https://www.dropbox.com");
  });

  it("allows Dropbox XHR + Chooser iframe (connect-src + frame-src)", async () => {
    const res = await unauth("/knowledge/manuals/");
    expect(directive(res, "connect-src")).toContain("https://www.dropbox.com");
    expect(directive(res, "frame-src")).toContain("https://www.dropbox.com");
  });

  it("still allows the Google Picker SDK (apis.google.com) in script-src", async () => {
    const res = await unauth("/knowledge/manuals/");
    expect(directive(res, "script-src")).toContain("https://apis.google.com");
  });
});

describe("equipment-browser session HTTP contract", () => {
  it("returns private JSON for each equipment endpoint with or without the trailing slash", async () => {
    for (const endpoint of ["children", "search", "resolve"]) {
      for (const suffix of ["", "/"]) {
        const response = await unauth(`/api/equipment-browser/${endpoint}${suffix}`);
        expect(response.status).toBe(401);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.headers.get("location")).toBeNull();
        expect(await response.json()).toEqual({ error: "Unauthorized" });
      }
    }
    expect((await unauth("/api/equipment-browser/children-extra")).headers.get("cache-control")).toBeNull();
  });

  it("returns JSON for blocked entitlements while preserving adjacent redirects", async () => {
    const secret = "equipment-browser-local-middleware-test";
    vi.stubEnv("AUTH_SECRET", secret);
    try {
      for (const [status, trialExpiresAt, redirect] of [
        ["expired", null, "/upgrade"],
        ["pending", null, "/pending-approval"],
        ["trial", "2000-01-01T00:00:00.000Z", "/upgrade"],
      ] as const) {
        const cookie = await encode({secret,token:{status,trialExpiresAt}});
        const send = (path: string) => middleware(new NextRequest(`http://localhost${path}`, {
          headers:{cookie:`next-auth.session-token=${cookie}`},
        }), {} as NextFetchEvent);
        const response = await send("/api/equipment-browser/resolve/");
        expect(response.status).toBe(403);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.headers.get("location")).toBeNull();
        expect(await response.json()).toMatchObject({error:expect.any(String)});
        expect(callbackOf(await send("/assets/")).pathname).toBe(redirect);
        expect(callbackOf(await send("/api/equipment-browser/resolve-extra")).pathname).toBe(redirect);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
