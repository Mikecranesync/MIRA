/**
 * Proof spec for PR #740 — really closes #686
 * Verifies that /hub/assets does NOT redirect to login when authenticated.
 */

import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const HUB = "https://app.factorylm.com/hub";
const CREDS = { email: "playwright@factorylm.com", password: "TestPass123" };

const outDir = path.join(__dirname, "../../test-results/proof-pr-740");

test.beforeAll(async ({ request }) => {
  fs.mkdirSync(outDir, { recursive: true });
  const res = await request.post(`${HUB}/api/auth/register/`, {
    data: { email: CREDS.email, password: CREDS.password, name: "Playwright 740" },
  });
  console.log(`test user: ${res.status()} (201=created, 409=exists)`);
});

test("authenticated user stays on /assets (no login redirect)", async ({ page }) => {
  const apiStatuses: { url: string; status: number }[] = [];
  page.on("response", (resp) => {
    if (resp.url().includes("/api/assets")) {
      apiStatuses.push({ url: resp.url(), status: resp.status() });
    }
  });

  // Login (password is in a collapsible section — expand it first)
  await page.goto(`${HUB}/login`, { waitUntil: "domcontentloaded" });
  await page.click("text=Sign in with password");
  await page.locator('input[type="email"]').last().fill(CREDS.email);
  await page.fill('input[type="password"]', CREDS.password);
  await page.getByRole('button', { name: /^Sign in$/ }).click();
  await page.waitForURL(/\/hub\/feed\/?/, { timeout: 25_000 });
  console.log("✅ Logged in:", page.url());

  // Navigate to /assets
  await page.goto(`${HUB}/assets`, { waitUntil: "domcontentloaded" });
  // Wait for either the asset list or a redirect to finish
  await page.waitForTimeout(5000);

  const finalUrl = page.url();
  console.log("Final URL:", finalUrl);
  console.log("API calls:", JSON.stringify(apiStatuses));

  await page.screenshot({ path: path.join(outDir, "assets-page.png"), fullPage: false });

  // Must NOT be on login page
  expect(finalUrl).not.toContain("/login");
  // Final /api/assets/ call (after trailingSlash 308) must return 200
  const successCall = apiStatuses.find(c => c.url.includes("/api/assets") && c.status === 200);
  expect(successCall).toBeDefined();

  console.log(`✅ /assets loaded without redirect. API calls: ${JSON.stringify(apiStatuses)}`);
});
