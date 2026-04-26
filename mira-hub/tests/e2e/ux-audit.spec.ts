/**
 * Full UX audit screenshot suite.
 * Captures every hub page at desktop (1440x900) + mobile (412x915 Pixel 9A).
 * Also captures the marketing site (factorylm.com).
 * Outputs to docs/ux-audit/2026-04-26/screenshots/
 *
 * Run:  npx playwright test ux-audit.spec.ts --headed=false
 */
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const OUT = path.resolve(__dirname, "../../docs/ux-audit/2026-04-26/screenshots");
fs.mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const MOBILE  = { width: 412,  height: 915 };

async function shot(page: Page, slug: string) {
  await page.waitForTimeout(800); // let animations settle
  const desktop = path.join(OUT, `${slug}-desktop.png`);
  const mobile  = path.join(OUT, `${slug}-mobile.png`);
  await page.setViewportSize(DESKTOP);
  await page.screenshot({ path: desktop, fullPage: true });
  await page.setViewportSize(MOBILE);
  await page.screenshot({ path: mobile, fullPage: true });
  return { desktop, mobile };
}

// ---------------------------------------------------------------------------
// Marketing site — no auth needed
// ---------------------------------------------------------------------------
test.describe("Marketing site (factorylm.com)", () => {
  test("homepage /", async ({ page }) => {
    await page.goto("https://factorylm.com/", { waitUntil: "networkidle" });
    await shot(page, "marketing-home");
  });

  test("cmms page /cmms", async ({ page }) => {
    await page.goto("https://factorylm.com/cmms", { waitUntil: "networkidle" });
    await shot(page, "marketing-cmms");
  });

  test("pricing page /pricing.html", async ({ page }) => {
    await page.goto("https://factorylm.com/pricing.html", { waitUntil: "networkidle" });
    await shot(page, "marketing-pricing");
  });
});

// ---------------------------------------------------------------------------
// Hub — requires auth via cookie (uses Playwright storageState)
// ---------------------------------------------------------------------------
test.describe("Hub pages (app.factorylm.com/hub)", () => {
  // If no storageState is set, we fall through to login
  test.use({ storageState: "playwright/.auth/user.json" });

  const HUB_PAGES = [
    { slug: "hub-login",         url: "/hub/login/" },
    { slug: "hub-feed",          url: "/hub/feed/" },
    { slug: "hub-conversations", url: "/hub/conversations/" },
    { slug: "hub-actions",       url: "/hub/actions/" },
    { slug: "hub-alerts",        url: "/hub/alerts/" },
    { slug: "hub-knowledge",     url: "/hub/knowledge/" },
    { slug: "hub-assets",        url: "/hub/assets/" },
    { slug: "hub-channels",      url: "/hub/channels/" },
    { slug: "hub-integrations",  url: "/hub/integrations/" },
    { slug: "hub-usage",         url: "/hub/usage/" },
    { slug: "hub-team",          url: "/hub/team/" },
    { slug: "hub-workorders",    url: "/hub/workorders/" },
    { slug: "hub-workorders-new",url: "/hub/workorders/new/" },
    { slug: "hub-schedule",      url: "/hub/schedule/" },
    { slug: "hub-reports",       url: "/hub/reports/" },
    { slug: "hub-parts",         url: "/hub/parts/" },
    { slug: "hub-cmms",          url: "/hub/cmms/" },
    { slug: "hub-documents",     url: "/hub/documents/" },
    { slug: "hub-admin-users",   url: "/hub/admin/users/" },
    { slug: "hub-admin-roles",   url: "/hub/admin/roles/" },
    { slug: "hub-more",          url: "/hub/more/" },
  ];

  for (const { slug, url } of HUB_PAGES) {
    test(slug, async ({ page }) => {
      const res = await page.goto(`https://app.factorylm.com${url}`, { waitUntil: "networkidle" });
      // If auth redirected to login, screenshot login state
      await shot(page, slug);
      // Also screenshot the knowledge upload picker open state
      if (slug === "hub-knowledge") {
        await page.setViewportSize(DESKTOP);
        const uploadBtn = page.locator("button", { hasText: /upload/i }).first();
        if (await uploadBtn.isVisible()) {
          await uploadBtn.click();
          await page.waitForTimeout(600);
          await page.screenshot({ path: path.join(OUT, "hub-knowledge-picker-desktop.png") });
          // Close picker via backdrop click before switching viewport
          const backdrop = page.locator(".fixed.inset-0.z-50").first();
          if (await backdrop.isVisible()) {
            await backdrop.click({ position: { x: 10, y: 10 } });
            await page.waitForTimeout(400);
          }
        }
        await page.setViewportSize(MOBILE);
        const uploadBtnM = page.locator("button", { hasText: /upload/i }).first();
        if (await uploadBtnM.isVisible()) {
          await uploadBtnM.click();
          await page.waitForTimeout(600);
          await page.screenshot({ path: path.join(OUT, "hub-knowledge-picker-mobile.png") });
          const backdropM = page.locator(".fixed.inset-0.z-50").first();
          if (await backdropM.isVisible()) {
            await backdropM.click({ position: { x: 10, y: 10 } });
          }
        }
      }
    });
  }
});
