/**
 * basePath redirect regression test — 2026-09-21
 *
 * Verifies that the root redirect in next.config.ts only fires when
 * basePath="/hub" (production) and NOT when basePath="" (staging).
 *
 * Context: #3936 — staging root was 404ing because the config was redirecting
 * / → /hub/ unconditionally, but staging has basePath="", so /hub/ doesn't exist.
 *
 * Fix: The redirect is now conditional on basePath === "/hub".
 *
 * Run:
 *   # Staging (basePath="")
 *   STAGING_HUB_URL=https://app-staging.factorylm.com \
 *     npx playwright test tests/e2e/basepath-redirect.spec.ts
 *
 *   # Production (basePath="/hub" before Phase 2, basePath="" after)
 *   PROD_HUB_URL=https://app.factorylm.com \
 *     npx playwright test tests/e2e/basepath-redirect.spec.ts
 */

import { test, expect } from "@playwright/test";

const STAGING_HUB = (process.env.STAGING_HUB_URL ?? "https://app-staging.factorylm.com").replace(/\/$/, "");
const PROD_HUB = (process.env.PROD_HUB_URL ?? "https://app.factorylm.com").replace(/\/$/, "");

test.describe("basePath redirect behavior", () => {
  test("staging: root should NOT redirect to /hub/ (basePath='')", async ({ page }) => {
    // Navigate to the root
    const response = await page.goto(STAGING_HUB + "/", {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });

    const finalUrl = page.url();
    console.log(`staging root → ${finalUrl} (status: ${response?.status()})`);

    // Should either:
    // 1. Redirect to /login (if unauthenticated)
    // 2. Land on a valid hub page (if authenticated)
    // Should NOT redirect to /hub/ (which would 404 on staging)
    expect(finalUrl).not.toMatch(/\/hub\//);

    // Should be a valid page (not 404)
    expect(response?.status()).not.toBe(404);

    // Most likely outcome: redirect to /login for unauthenticated users
    if (response?.status() === 307 || response?.status() === 302) {
      expect(finalUrl).toMatch(/\/(login|feed|namespace)/);
    }
  });

  test("staging: /hub/ should 404 (basePath='')", async ({ page }) => {
    // This path should not exist on staging
    const response = await page.goto(STAGING_HUB + "/hub/", {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
      failOnStatusCode: false,
    });

    console.log(`staging /hub/ → status: ${response?.status()}`);

    // Should 404 because staging has no /hub basePath
    expect(response?.status()).toBe(404);
  });

  test("production: root should work (basePath='')", async ({ page }) => {
    // Production is also basePath="" after Phase 2 (2026-04-27)
    // nginx redirects / → /feed/ (nginx-app-factorylm.conf line 30-32)
    const response = await page.goto(PROD_HUB + "/", {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });

    const finalUrl = page.url();
    console.log(`prod root → ${finalUrl} (status: ${response?.status()})`);

    // nginx handles the redirect in production, so we should land on a valid page
    expect(response?.status()).not.toBe(404);

    // Should either be on /feed/, /login, or another valid hub route
    expect(finalUrl).toMatch(/\/(feed|login|namespace|hub)/);
  });

  test("production: /hub/ legacy redirect still works", async ({ page }) => {
    // Production has nginx rewrite rules for legacy /hub/* bookmarks
    // (nginx-app-factorylm.conf lines 22-27)
    const response = await page.goto(PROD_HUB.replace(/\/hub$/, "") + "/hub/", {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });

    const finalUrl = page.url();
    console.log(`prod /hub/ → ${finalUrl} (status: ${response?.status()})`);

    // Should redirect to / and then to a valid page (not 404)
    expect(response?.status()).not.toBe(404);
  });
});
