import { describe, expect, it } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";
import middleware, { config as middlewareConfig } from "../../middleware";
import { UTM_COOKIE_NAME } from "../utm";

function unauth(path: string) {
  const req = new NextRequest(new URL(`http://localhost${path}`));
  return middleware(req, {} as NextFetchEvent);
}

function directive(res: Response, name: string): string {
  const csp = res.headers.get("content-security-policy") ?? "";
  return csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(name + " ")) ?? "";
}

describe("middleware matcher includes signup/login for CSP + UTM cookie", () => {
  it("no longer excludes login|signup from the matcher", () => {
    const matcher = middlewareConfig.matcher[0];
    expect(matcher).not.toMatch(/login\|signup/);
    expect(matcher).toContain("magic");
    expect(matcher).toContain("api/auth");
  });
});

describe("middleware — public /signup and /login keep rendering", () => {
  it("does not bounce an unauthenticated /signup/ to /login", async () => {
    const res = await unauth("/signup/");
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBeLessThan(300);
  });

  it("does not bounce an unauthenticated /login/ to itself", async () => {
    const res = await unauth("/login/");
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBeLessThan(300);
  });

  it("still bounces an unauthenticated protected route to /login", async () => {
    const res = await unauth("/feed/");
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/login");
  });
});

describe("middleware — CSP allows PostHog ingest + assets", () => {
  it("lists us.i.posthog.com and us-assets.i.posthog.com on script-src and connect-src", async () => {
    const res = await unauth("/signup/");
    const script = directive(res, "script-src");
    const connect = directive(res, "connect-src");
    expect(script).toContain("https://us.i.posthog.com");
    expect(script).toContain("https://us-assets.i.posthog.com");
    expect(connect).toContain("https://us.i.posthog.com");
    expect(connect).toContain("https://us-assets.i.posthog.com");
    expect(script).not.toContain("unsafe-inline");
    expect(script).toContain("nonce-");
  });

  it("keeps the Dropbox/Google allowlist next to PostHog", async () => {
    const res = await unauth("/knowledge/manuals/");
    expect(directive(res, "script-src")).toContain("https://www.dropbox.com");
    expect(directive(res, "script-src")).toContain("https://apis.google.com");
    expect(directive(res, "script-src")).toContain("https://us.i.posthog.com");
  });
});

describe("middleware — first-touch UTM cookie on /signup", () => {
  it("stamps flm_utm from the query string", async () => {
    const req = new NextRequest(
      new URL("http://localhost/signup/?utm_source=google&utm_campaign=pilot&gclid=secret"),
    );
    const res = await middleware(req, {} as NextFetchEvent);
    const cookie = res.cookies.get(UTM_COOKIE_NAME);
    expect(cookie?.value).toContain("utm_source=google");
    expect(cookie?.value).toContain("utm_campaign=pilot");
    expect(cookie?.value).toContain("gclid=1");
    expect(cookie?.value).not.toContain("secret");
    expect(cookie?.httpOnly).toBe(true);
  });

  it("does not overwrite an existing first-touch cookie", async () => {
    const req = new NextRequest(new URL("http://localhost/signup/?utm_source=later"));
    req.cookies.set(UTM_COOKIE_NAME, "utm_source=first");
    const res = await middleware(req, {} as NextFetchEvent);
    expect(res.cookies.get(UTM_COOKIE_NAME)?.value).toBeUndefined();
  });
});
