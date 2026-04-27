/**
 * Proof spec for PR #746 — closes #687 and #717
 * Verifies: hard reload of /hub/usage does not crash, chart renders (or shows
 * "No activity" for tenants with no data), API returns 200.
 */

import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const HUB = "https://app.factorylm.com/hub";
const CREDS = { email: "playwright@factorylm.com", password: "TestPass123" };
const outDir = path.join(__dirname, "../../test-results/proof-pr-746");

test.beforeAll(async ({ request }) => {
  fs.mkdirSync(outDir, { recursive: true });
  const res = await request.post(`${HUB}/api/auth/register/`, {
    data: { email: CREDS.email, password: CREDS.password, name: "Playwright 746" },
  });
  console.log(`test user: ${res.status()} (201=created, 409=exists)`);
});

test("hard reload /usage — no crash, API 200, chart rendered or no-data message shown", async ({ page }) => {
  const errors: string[] = [];
  const apiStatuses: { url: string; status: number }[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("response", r => { if (r.url().includes("/api/usage")) apiStatuses.push({ url: r.url(), status: r.status() }); });

  // Login
  await page.goto(`${HUB}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', CREDS.email);
  await page.fill('input[type="password"]', CREDS.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/hub\/feed\/?/, { timeout: 25_000 });
  console.log("✅ Logged in:", page.url());

  // Hard reload (fresh navigation, triggers full server pre-render then hydration)
  await page.goto(`${HUB}/usage`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);

  const finalUrl = page.url();
  console.log("Final URL:", finalUrl);
  console.log("JS errors:", JSON.stringify(errors));
  console.log("API calls:", JSON.stringify(apiStatuses));

  await page.screenshot({ path: path.join(outDir, "usage-after-fix.png"), fullPage: true });

  // Must not have crashed (redirected to login or blank)
  expect(finalUrl).not.toContain("/login");
  expect(errors).toHaveLength(0);

  // API must return 200
  const successCall = apiStatuses.find(c => c.status === 200);
  expect(successCall).toBeDefined();

  // Chart area must be present — either chart SVG or "No activity" message
  const chartCard = page.locator(".card").filter({ hasText: /Daily Actions/i });
  await expect(chartCard).toBeVisible({ timeout: 5000 });
  const noActivityMsg = chartCard.getByText("No activity in the last 7 days");
  const chartSvg = chartCard.locator("svg");
  const hasNoActivity = await noActivityMsg.isVisible();
  const hasSvg = await chartSvg.isVisible();
  expect(hasNoActivity || hasSvg).toBe(true);

  console.log(`✅ /usage loaded cleanly. Chart: ${hasSvg ? "SVG rendered" : "No activity message shown"}`);
});
