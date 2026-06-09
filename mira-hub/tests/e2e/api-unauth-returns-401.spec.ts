/**
 * Regression test for #1764 — unauthenticated /api/* requests must return
 * 401 application/json {"error":"Unauthorized"}, NOT a 307/308 redirect to
 * the /login HTML page.
 *
 * Before the fix in mira-hub/src/middleware.ts, curl-style consumers
 * (canary, future SDK, third-party automation) hitting /api/usage with no
 * session cookie got a redirect to /login and an HTML body — surfaces as
 * a silent failure in any non-browser consumer.
 *
 * The middleware now mirrors the shape of `sessionOr401()` in
 * mira-hub/src/lib/session.ts:85-91, while page paths keep the existing
 * /login redirect behavior.
 *
 * Run locally:
 *   cd mira-hub
 *   npx playwright test tests/e2e/api-unauth-returns-401.spec.ts
 *
 * Override target URL:
 *   HUB_URL=https://staging.app.factorylm.com \
 *   npx playwright test tests/e2e/api-unauth-returns-401.spec.ts
 */

import { test, expect } from "@playwright/test";

const HUB = (process.env.HUB_URL ?? "https://app.factorylm.com").replace(/\/$/, "");

test.describe("#1764 — unauthenticated /api/* returns 401 JSON", () => {
  test("GET /api/usage without cookie returns 401 JSON, not a redirect", async ({ request }) => {
    const res = await request.get(HUB + "/api/usage", {
      maxRedirects: 0,
      // Strip any baggage that could be interpreted as a session
      headers: { cookie: "" },
    });

    // 1. Status is 401, not a 307/308 redirect.
    expect(res.status()).toBe(401);

    // 2. Content-Type is JSON.
    const contentType = res.headers()["content-type"] ?? "";
    expect(contentType.toLowerCase()).toContain("application/json");

    // 3. Body matches sessionOr401() shape from lib/session.ts:85-91.
    const body = await res.json();
    expect(body).toEqual({ error: "Unauthorized" });

    // 4. No Location header — this is NOT a redirect.
    expect(res.headers()["location"]).toBeUndefined();

    // 5. CSP header preserved on the 401 response (security headers must not
    //    regress just because the response shape changed).
    const csp = res.headers()["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src");
  });

  test("page paths still redirect unauthenticated users to /login", async ({ request }) => {
    // Sanity check: the fix is scoped to /api/* — page paths must keep the
    // existing /login redirect behavior so the browser flow is unchanged.
    const res = await request.get(HUB + "/feed", {
      maxRedirects: 0,
      headers: { cookie: "" },
    });

    // 307 or 308 — both are valid Next.js middleware redirect codes.
    expect([307, 308]).toContain(res.status());

    const location = res.headers()["location"] ?? "";
    expect(location).toContain("/login");
  });
});
