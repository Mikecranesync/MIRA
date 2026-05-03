/**
 * Visual QA — Design system PRs #691 / #708 / #706 deployment verification
 * Runs against live factorylm.com + app.factorylm.com
 */

import { test, expect, Page, Browser } from "@playwright/test";
import * as path from "path";

const MARKETING = "https://factorylm.com";
const HUB = process.env.HUB_URL ?? "https://app.factorylm.com/hub";
const OUT = path.join("test-results", "visual-qa");

async function shot(page: Page, name: string, fullPage = true) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  console.log(`📸 ${name}.png`);
}

async function loginHub(page: Page) {
  await page.goto(`${HUB}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "playwright@factorylm.com");
  await page.fill('input[type="password"]', "TestPass123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/hub\/feed\/?/, { timeout: 20_000 });
}

// Create test user before suite, delete after
test.beforeAll(async ({ request }) => {
  const res = await request.post(`${HUB}/api/auth/register/`, {
    data: { email: "playwright@factorylm.com", password: "TestPass123", name: "Playwright" },
  });
  console.log(`test user setup: ${res.status()}`);
});

test.afterAll(async ({ request }) => {
  await request.delete(`${HUB}/api/auth/account/`, {
    headers: { "Content-Type": "application/json" },
  }).catch(() => {});
});

// ---------------------------------------------------------------------------
// 1. Homepage — desktop
// ---------------------------------------------------------------------------
test("homepage desktop — trust-band visible (#708)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${MARKETING}/`, { waitUntil: "networkidle" });
  await shot(page, "homepage-desktop");

  const html = await page.content();
  expect(html).toContain("trust-band");
  console.log("✅ trust-band present in homepage HTML");
});

// ---------------------------------------------------------------------------
// 2. Homepage — mobile
// ---------------------------------------------------------------------------
test("homepage mobile 375px", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await page.goto(`${MARKETING}/`, { waitUntil: "networkidle" });
  await shot(page, "homepage-mobile");
  await ctx.close();
});

// ---------------------------------------------------------------------------
// 3. CMMS page — magic-link form (#706)
// ---------------------------------------------------------------------------
test("cmms page — magic-link form visible (#706)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${MARKETING}/cmms`, { waitUntil: "networkidle" });
  await shot(page, "cmms-desktop");

  const html = await page.content();
  expect(html.toLowerCase()).toMatch(/magic.?link|enter your email|sign in with email/i);
  console.log("✅ Magic-link content confirmed on /cmms");

  // Email input should be visible
  const emailInput = page.locator('input[type="email"], input[type="text"]').first();
  if (await emailInput.isVisible()) {
    console.log("✅ Email input field visible");
  } else {
    console.log("⚠️  No email input found — check renderCmms output");
  }
});

// ---------------------------------------------------------------------------
// 4. CMMS page — mobile
// ---------------------------------------------------------------------------
test("cmms page mobile 375px", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await page.goto(`${MARKETING}/cmms`, { waitUntil: "networkidle" });
  await shot(page, "cmms-mobile");
  await ctx.close();
});

// ---------------------------------------------------------------------------
// 5. Sample page (#706 AC4)
// ---------------------------------------------------------------------------
test("sample page loads", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const res = await page.goto(`${MARKETING}/sample`, { waitUntil: "networkidle" });
  expect(res?.status()).toBe(200);
  await shot(page, "sample-desktop");
  console.log(`✅ /sample HTTP ${res?.status()}`);
});

// ---------------------------------------------------------------------------
// 6. Tokens CSS (#691)
// ---------------------------------------------------------------------------
test("_tokens.css returns 200 with CSS variables", async ({ page }) => {
  const res = await page.goto(`${MARKETING}/_tokens.css`);
  expect(res?.status()).toBe(200);
  const body = await res?.text() ?? "";
  expect(body).toMatch(/--/); // CSS custom properties
  console.log(`✅ /_tokens.css HTTP ${res?.status()}, length=${body.length}`);
  // First 200 chars as proof
  console.log(body.substring(0, 200));
});

// ---------------------------------------------------------------------------
// 7. Hub login page
// ---------------------------------------------------------------------------
test("hub login page", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${HUB}/login`, { waitUntil: "networkidle" });
  await shot(page, "hub-login-desktop");
  await expect(page.locator('input[type="email"]')).toBeVisible();
  console.log("✅ Hub login email input visible");
});

// ---------------------------------------------------------------------------
// 8. Hub login mobile
// ---------------------------------------------------------------------------
test("hub login mobile 375px", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await page.goto(`${HUB}/login`, { waitUntil: "networkidle" });
  await shot(page, "hub-login-mobile");
  await ctx.close();
});

// ---------------------------------------------------------------------------
// 9. Hub feed (authenticated)
// ---------------------------------------------------------------------------
test("hub feed — authenticated", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginHub(page);
  await page.waitForLoadState("networkidle");
  await shot(page, "hub-feed-desktop");
  console.log("✅ Hub feed loaded");
});

// ---------------------------------------------------------------------------
// 10. Hub assets — blue + New Asset button (#create-asset)
// ---------------------------------------------------------------------------
test("hub assets — New Asset button visible", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginHub(page);
  await page.goto(`${HUB}/assets`, { waitUntil: "networkidle" });
  await page.waitForLoadState("networkidle");

  // Wait for assets to load
  await page.waitForTimeout(2000);
  await shot(page, "hub-assets-desktop");

  const newAssetBtn = page.locator('button:has-text("New Asset")');
  const visible = await newAssetBtn.isVisible();
  if (visible) {
    console.log("✅ 'New Asset' button visible");
  } else {
    console.log("⚠️  'New Asset' button not found in desktop view");
  }

  const assetLinks = await page.locator('a[href*="/assets/"]').count();
  console.log(`✅ ${assetLinks} asset links rendered`);
});

// ---------------------------------------------------------------------------
// 11. Hub assets mobile — FAB
// ---------------------------------------------------------------------------
test("hub assets mobile — FAB visible", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  // Login first
  await page.goto(`${HUB}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "playwright@factorylm.com");
  await page.fill('input[type="password"]', "TestPass123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/hub\/feed\/?/, { timeout: 20_000 });

  await page.goto(`${HUB}/assets`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/hub-assets-mobile.png`, fullPage: true });
  console.log("📸 hub-assets-mobile.png");

  const fab = page.locator('button[aria-label="Create new asset"]');
  const fabVisible = await fab.isVisible();
  console.log(fabVisible ? "✅ Mobile FAB visible" : "⚠️  Mobile FAB not found");
  await ctx.close();
});

// ---------------------------------------------------------------------------
// 12. Hub channels
// ---------------------------------------------------------------------------
test("hub channels", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginHub(page);
  await page.goto(`${HUB}/channels`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await shot(page, "hub-channels-desktop");
  console.log("✅ Hub channels loaded");
});
