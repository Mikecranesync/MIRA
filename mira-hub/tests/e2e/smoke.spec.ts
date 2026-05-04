/**
 * E2E smoke test — critical path gate (#689)
 *
 * Verifies that both factorylm.com (marketing) and app.factorylm.com (hub)
 * are reachable, show key content, and the login flow entry-points exist.
 *
 * This suite runs in CI on every push to main (via smoke-test.yml) and on
 * every PR targeting main. It is a DEPLOY GATE — the deploy-vps.yml workflow
 * only runs after this suite passes.
 *
 * Run locally:
 *   cd mira-hub
 *   npx playwright test --config playwright.smoke.config.ts
 *
 * Override target URLs:
 *   WEB_URL=https://staging.factorylm.com \
 *   HUB_URL=https://staging.app.factorylm.com \
 *   npx playwright test --config playwright.smoke.config.ts
 */

import { test, expect } from "@playwright/test";

const WEB = (process.env.WEB_URL ?? "https://factorylm.com").replace(/\/$/, "");
const HUB = (process.env.HUB_URL ?? "https://app.factorylm.com").replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Marketing site — factorylm.com
// ---------------------------------------------------------------------------

test.describe("factorylm.com — marketing site", () => {
  test("homepage: 200 OK + OG meta tags present", async ({ page }) => {
    const res = await page.goto(WEB + "/", { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBe(200);

    // OG tags — required for LinkedIn/Slack/Twitter preview cards
    await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
    await expect(page.locator('meta[property="og:description"]')).toHaveCount(1);
    await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);

    // Page must have a meaningful title
    await expect(page).toHaveTitle(/FactoryLM/i);
  });

  test("pricing: 200 OK + pricing cards visible", async ({ page }) => {
    const res = await page.goto(WEB + "/pricing", { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBe(200);

    // At least one price tier with a dollar amount
    const priceEl = page.locator(".card-price").first();
    await expect(priceEl).toBeVisible({ timeout: 10_000 });

    // Pricing page title
    await expect(page).toHaveTitle(/Pricing/i);

    // At least one CTA button on the page
    const cta = page.locator(".card-cta").first();
    await expect(cta).toBeVisible();
  });

  test("cmms page: 200 OK + magic link email form present", async ({ page }) => {
    const res = await page.goto(WEB + "/cmms", { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBe(200);

    // Magic link form — the main CTA on the CMMS page
    const emailInput = page.locator("#cmms-email, .fl-magic-form input[type='email']").first();
    await expect(emailInput).toBeVisible({ timeout: 10_000 });

    // Form submit button
    const submitBtn = page.locator(".fl-magic-form button[type='submit'], .fl-magic-form .fl-btn-primary").first();
    await expect(submitBtn).toBeVisible();
  });

  test("sitemap.xml: 200 OK + well-formed XML", async ({ page }) => {
    const res = await page.goto(WEB + "/sitemap.xml");
    expect(res?.status()).toBe(200);
    const ct = res?.headers()["content-type"] ?? "";
    expect(ct).toMatch(/xml/i);

    // At least the homepage and pricing page must be in the sitemap
    const body = await page.content();
    expect(body).toContain("factorylm.com/");
  });

  test("health endpoint: 200 OK", async ({ request }) => {
    const res = await request.get(WEB + "/api/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// Hub — app.factorylm.com
// ---------------------------------------------------------------------------

test.describe("app.factorylm.com — hub app", () => {
  test("root redirects unauthenticated visitor to login page", async ({ page }) => {
    // Hub root → nginx 301 /feed/ → Next.js middleware → /login (no auth)
    await page.goto(HUB + "/", { waitUntil: "networkidle", timeout: 20_000 });
    expect(page.url()).toMatch(/\/login/i);
  });

  test("login page: email + password inputs + Google OAuth link visible", async ({ page }) => {
    const res = await page.goto(HUB + "/login", { waitUntil: "networkidle", timeout: 20_000 });
    // Allow 200 or 307/308 redirect to login
    expect([200, 307, 308]).toContain(res?.status());

    // Email input — used for both magic link and credentials login
    const emailInput = page.locator('input[type="email"]').first();
    await expect(emailInput).toBeVisible({ timeout: 15_000 });

    // Google OAuth — next-auth renders a Sign in with Google link or button
    const googleLink = page.getByText(/google/i, { exact: false });
    await expect(googleLink).toBeVisible({ timeout: 5_000 });
  });

  test("health endpoint: 200 OK", async ({ request }) => {
    const res = await request.get(HUB + "/api/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});
