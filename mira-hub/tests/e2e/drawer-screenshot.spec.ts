import { test } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

const HUB = process.env.HUB_URL ?? "https://app.factorylm.com";
const OUT = path.join("docs/promo-screenshots");
const EMAIL = `drawer-test-${Date.now()}@factorylm-test.com`;
const PASSWORD = "TestPass123!";

test.beforeAll(async ({ request }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await request.post(`${HUB}/api/auth/register`, {
    data: { email: EMAIL, password: PASSWORD, name: "Drawer Tester" },
  });
});

test("mobile drawer screenshots — closed + open", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });

  await page.goto(`${HUB}/login`, { waitUntil: "domcontentloaded" });

  // Expand password accordion
  await page.locator("text=Sign in with password").click();
  // Wait for the password form to appear (second email input)
  await page.waitForSelector('input[type="password"]', { timeout: 5_000 });

  // The second email input is inside the password form
  await page.locator('input[type="email"]').nth(1).fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').last().click();
  await page.waitForURL(/\/feed/, { timeout: 20_000 });
  await page.waitForLoadState("networkidle");

  // Screenshot 1: bottom tabs visible, drawer closed
  await page.screenshot({ path: `${OUT}/mobile-drawer-closed-2026-04-27.png`, fullPage: false });
  console.log(`📸 ${OUT}/mobile-drawer-closed-2026-04-27.png`);

  // Click the More (⋯) button — last button in the bottom tab nav
  await page.locator("nav.fixed.bottom-0 button").last().click();
  await page.waitForTimeout(300);

  // Screenshot 2: drawer open with all menu items
  await page.screenshot({ path: `${OUT}/mobile-drawer-open-2026-04-27.png`, fullPage: false });
  console.log(`📸 ${OUT}/mobile-drawer-open-2026-04-27.png`);

  const drawerVisible = await page.locator('[role="dialog"]').isVisible();
  console.log(`✅ Drawer visible: ${drawerVisible}`);
});
