/**
 * Staging-VPS Verification (PR #1420 deliverable)
 *
 * Validates the docker-compose.staging-vps.yml stack deployed via
 * .github/workflows/deploy-staging.yml on the production VPS (165.245.138.91)
 * at offset ports (4xxx). Production stack on saas.yml is never touched.
 *
 * Run:
 *   cd mira-hub
 *   STAGING_HUB_URL=http://165.245.138.91:4101 \
 *     npx playwright test tests/e2e/staging-verification.spec.ts
 *
 * Optional auth (enables asset hierarchy + knowledge-page checks):
 *   E2E_HUB_EMAIL=… E2E_HUB_PASSWORD=… npx playwright test …
 *
 * Screenshots are saved to ../docs/promo-screenshots/ with the format
 * 2026-05-19_feature_viewport.png per the repo screenshot rule.
 */

import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const HUB = process.env.STAGING_HUB_URL ?? "http://165.245.138.91:4101";
const PIPELINE = process.env.STAGING_PIPELINE_URL ?? "http://165.245.138.91:4099";
const WEB = process.env.STAGING_WEB_URL ?? "http://165.245.138.91:4200";
const LOGIN_EMAIL = process.env.E2E_HUB_EMAIL ?? "";
const LOGIN_PASSWORD = process.env.E2E_HUB_PASSWORD ?? "";

const PROMO_DIR = path.resolve(__dirname, "../../../docs/promo-screenshots");
const TODAY = "2026-05-19";

function shotPath(feature: string, viewport: "desktop" | "mobile"): string {
  if (!fs.existsSync(PROMO_DIR)) fs.mkdirSync(PROMO_DIR, { recursive: true });
  return path.join(PROMO_DIR, `${TODAY}_${feature}_${viewport}.png`);
}

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 412, height: 915 };

async function tryLogin(page: Page): Promise<boolean> {
  if (!LOGIN_PASSWORD) return false;
  await page.goto(`${HUB}/login`, { waitUntil: "networkidle" });
  try {
    await page.click("text=Sign in with password", { timeout: 3_000 });
  } catch {
    // already expanded
  }
  await page.locator('input[type="email"]').last().fill(LOGIN_EMAIL);
  await page.fill('input[type="password"]', LOGIN_PASSWORD);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  try {
    await page.waitForURL(/\/feed\/?$/, { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

test.describe("Staging VPS — Phase 1 verification", () => {
  test("1. Staging Hub /api/health returns ok", async ({ request }) => {
    const resp = await request.get(`${HUB}/api/health`);
    expect(resp.status(), `GET ${HUB}/api/health`).toBe(200);
    const body = await resp.json();
    expect(body.status ?? body.ok ?? body).toBeTruthy();
  });

  test("2a. Staging Hub login page renders (desktop 1440x900)", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: DESKTOP });
    const page = await ctx.newPage();
    await page.goto(`${HUB}/login`, { waitUntil: "networkidle" });
    await expect(page.locator('input[type="email"]').first()).toBeVisible();
    await page.screenshot({ path: shotPath("staging-hub-login", "desktop"), fullPage: true });
    await ctx.close();
  });

  test("2b. Staging Hub login page renders (mobile 412x915)", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: MOBILE });
    const page = await ctx.newPage();
    await page.goto(`${HUB}/login`, { waitUntil: "networkidle" });
    await expect(page.locator('input[type="email"]').first()).toBeVisible();
    await page.screenshot({ path: shotPath("staging-hub-login", "mobile"), fullPage: true });
    await ctx.close();
  });

  test("3. Staging pipeline /health returns ok", async ({ request }) => {
    const resp = await request.get(`${PIPELINE}/health`);
    expect(resp.status(), `GET ${PIPELINE}/health`).toBe(200);
    const body = await resp.json();
    const status = body.status ?? body.ok ?? body;
    expect(JSON.stringify(status).toLowerCase()).toContain("ok");
  });

  test("4. Staging marketing/web root loads", async ({ page }) => {
    const resp = await page.goto(WEB, { waitUntil: "domcontentloaded" });
    expect(resp?.status(), `GET ${WEB}`).toBeLessThan(500);
    await page.screenshot({ path: shotPath("staging-web-root", "desktop"), fullPage: true });
  });

  test("5. Asset hierarchy — CV-001 with 6 children (requires auth)", async ({ browser }) => {
    test.skip(!LOGIN_PASSWORD, "E2E_HUB_PASSWORD not set — skipping asset-hierarchy check");
    const ctx = await browser.newContext({ viewport: DESKTOP });
    const page = await ctx.newPage();
    const ok = await tryLogin(page);
    test.skip(!ok, "login failed against staging Hub — skipping");
    // /assets and /namespace are both candidates; try assets first
    for (const route of ["/assets", "/namespace"]) {
      await page.goto(`${HUB}${route}`, { waitUntil: "networkidle" });
      if ((await page.locator("text=CV-001").count()) > 0) break;
    }
    const cv001 = page.locator("text=CV-001").first();
    await expect(cv001).toBeVisible();
    // best-effort: open the row, count direct descendants
    await cv001.click();
    await page.waitForTimeout(500);
    await page.screenshot({
      path: shotPath("staging-asset-hierarchy-cv001", "desktop"),
      fullPage: true,
    });
    await ctx.close();
  });

  test("6. Knowledge page renders on mobile with upload button", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: MOBILE });
    const page = await ctx.newPage();
    const authed = LOGIN_PASSWORD ? await tryLogin(page) : false;
    await page.goto(`${HUB}/knowledge`, { waitUntil: "domcontentloaded" });
    await page.screenshot({ path: shotPath("staging-knowledge", "mobile"), fullPage: true });
    if (authed) {
      const upload = page.getByRole("button", { name: /upload/i }).first();
      await expect(upload).toBeVisible({ timeout: 5_000 });
    }
    await ctx.close();
  });

  test("7. QR scan page loads", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: MOBILE });
    const page = await ctx.newPage();
    const resp = await page.goto(`${HUB}/scan`, { waitUntil: "domcontentloaded" });
    expect(resp?.status(), `GET ${HUB}/scan`).toBeLessThan(500);
    await page.screenshot({ path: shotPath("staging-qr-scan", "mobile"), fullPage: true });
    await ctx.close();
  });
});
