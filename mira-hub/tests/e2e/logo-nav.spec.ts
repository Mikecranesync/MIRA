/**
 * Logo navigation — verifies clicking the FactoryLM logo from every hub page
 * always lands on /hub/feed (the hub homepage).
 */

import { test, expect, Page } from "@playwright/test";
import * as path from "path";

const HUB = "https://app.factorylm.com/hub";
const OUT = path.join("test-results", "visual-qa");

async function login(page: Page) {
  await page.goto(`${HUB}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "playwright@factorylm.com");
  await page.fill('input[type="password"]', "TestPass123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/hub\/feed\/?/, { timeout: 20_000 });
}

// Pages to test logo click from (desktop — sidebar logo)
const DESKTOP_PAGES = [
  { name: "assets",     path: "/assets" },
  { name: "channels",   path: "/channels" },
  { name: "workorders", path: "/workorders" },
  { name: "knowledge",  path: "/knowledge" },
  { name: "event-log",  path: "/event-log" },
  { name: "more",       path: "/more" },
];

// ---------------------------------------------------------------------------
// Create test user before suite, delete after
// ---------------------------------------------------------------------------
test.beforeAll(async ({ request }) => {
  const res = await request.post(`${HUB}/api/auth/register/`, {
    data: { email: "playwright@factorylm.com", password: "TestPass123", name: "Playwright" },
  });
  // 200 = created, 409 = already exists — both fine
  console.log(`test user setup: ${res.status()}`);
});

test.afterAll(async ({ request }) => {
  // Best-effort cleanup; ignore errors
  await request.delete(`${HUB}/api/auth/account`, {
    headers: { "Content-Type": "application/json" },
  }).catch(() => {});
});

// ---------------------------------------------------------------------------
// Desktop sidebar logo test for each page
// ---------------------------------------------------------------------------
for (const pg of DESKTOP_PAGES) {
  test(`logo click from ${pg.name} → /hub/feed (desktop)`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);

    // Navigate to the target page
    await page.goto(`${HUB}${pg.path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    // Desktop sidebar logo — visible link (mobile topbar is md:hidden so hidden at this viewport)
    const logo = page.locator('a[href*="/feed"]').filter({ visible: true }).first();
    await expect(logo).toBeVisible({ timeout: 5_000 });
    await logo.click();

    // Should land on /hub/feed
    await page.waitForURL(/\/hub\/feed\/?/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/hub\/feed/);

    // Screenshot proof for first page only
    if (pg.name === "assets") {
      await page.screenshot({ path: `${OUT}/logo-click-from-assets.png` });
      console.log("📸 logo-click-from-assets.png");
    }
    console.log(`✅ Logo from /${pg.name} → ${page.url()}`);
  });
}

// ---------------------------------------------------------------------------
// Mobile topbar logo test
// ---------------------------------------------------------------------------
test("logo click mobile topbar → /hub/feed", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();

  await page.goto(`${HUB}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "playwright@factorylm.com");
  await page.fill('input[type="password"]', "TestPass123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/hub\/feed\/?/, { timeout: 20_000 });

  // Navigate away
  await page.goto(`${HUB}/assets`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  // Screenshot showing logo in mobile topbar
  await page.screenshot({ path: `${OUT}/mobile-logo-before-click.png` });
  console.log("📸 mobile-logo-before-click.png");

  // Mobile topbar logo — Link wrapping the Factory icon + FactoryLM text
  const mobileLogo = page.locator('header a[href*="/feed"]');
  await expect(mobileLogo).toBeVisible({ timeout: 5_000 });
  await mobileLogo.click();

  await page.waitForURL(/\/hub\/feed\/?/, { timeout: 10_000 });
  expect(page.url()).toMatch(/\/hub\/feed/);

  await page.screenshot({ path: `${OUT}/mobile-logo-after-click.png` });
  console.log("📸 mobile-logo-after-click.png");
  console.log(`✅ Mobile logo → ${page.url()}`);

  await ctx.close();
});
