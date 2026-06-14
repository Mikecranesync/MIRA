import { describe, it, expect } from "vitest";
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
