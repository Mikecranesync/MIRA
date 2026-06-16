/**
 * Proof spec for PR #737 — closes #716
 * Verifies all 17 desktop sidebar nav items are visible at 1440×900,
 * and the mobile More page lists 15 overflow items at 375×812.
 */

import { test, expect, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const HUB = process.env.HUB_URL ?? "https://app.factorylm.com/hub";
const CREDS = { email: "playwright@factorylm.com", password: "TestPass123" };

const DESKTOP_NAV_LABELS = [
  "Event Log",
  "Conversations",
  "Actions",
  "Alerts",
  "Knowledge",
  "Assets",
  "Work Orders",
  "Schedule",
  "Requests",
  "Parts",
  "Documents",
  "Reports",
  "Channels",
  "Integrations",
  "Usage",
  "Team",
  "Admin",
];

const MOBILE_MORE_LABELS = [
  "Conversations",
  "Alerts",
  "Knowledge",
  "Assets",
  "Work Orders",
  "Schedule",
  "Requests",
  "Parts",
  "Documents",
  "Reports",
  "Channels",
  "Integrations",
  "Usage",
  "Team",
  "Admin",
];

const outDir = path.join(__dirname, "../../test-results/proof-pr-737");

test.beforeAll(async ({ request }) => {
  fs.mkdirSync(outDir, { recursive: true });
  const res = await request.post(`${HUB}/api/auth/register/`, {
    data: { email: CREDS.email, password: CREDS.password, name: "Playwright Sidebar" },
  });
  console.log(`test user: ${res.status()} (201=created, 409=exists)`);
});

async function login(page: Page) {
  await page.goto(`${HUB}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', CREDS.email);
  await page.fill('input[type="password"]', CREDS.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/hub\/feed\/?/, { timeout: 25_000 });
  await page.waitForTimeout(1000);
}

test("desktop sidebar shows all 17 nav items at 1440×900", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await login(page);

  const sidebar = page.locator("aside");
  for (const label of DESKTOP_NAV_LABELS) {
    await expect(sidebar.getByText(label, { exact: true })).toBeVisible({ timeout: 5000 });
  }

  await page.screenshot({ path: path.join(outDir, "desktop-1440x900-sidebar.png"), fullPage: false });
  console.log(`✅ All ${DESKTOP_NAV_LABELS.length} desktop nav items verified`);

  await ctx.close();
});

test("mobile More page shows all 15 overflow items at 375×812", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();

  await login(page);
  await page.goto(`${HUB}/more`, { waitUntil: "networkidle" });

  // Scope to main content — aside sidebar exists in DOM but is md:hidden
  const main = page.locator("main");
  for (const label of MOBILE_MORE_LABELS) {
    await expect(main.getByText(label, { exact: true }).first()).toBeVisible({ timeout: 5000 });
  }

  await page.screenshot({ path: path.join(outDir, "mobile-375x812-more-page.png"), fullPage: true });
  console.log(`✅ All ${MOBILE_MORE_LABELS.length} mobile More items verified`);

  await ctx.close();
});
