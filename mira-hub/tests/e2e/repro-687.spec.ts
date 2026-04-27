import { test } from "@playwright/test";
import path from "path";
import fs from "fs";

const HUB = "https://app.factorylm.com/hub";
const CREDS = { email: "playwright@factorylm.com", password: "TestPass123" };

test("repro #687/#717 — /usage hard reload + chart blank", async ({ page }) => {
  const errors: string[] = [];
  const apiCalls: { url: string; status: number }[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(`[console] ${m.text()}`); });
  page.on("response", r => { if (r.url().includes("/api/")) apiCalls.push({ url: r.url(), status: r.status() }); });

  await page.goto(`${HUB}/login`, { waitUntil: "domcontentloaded" });
  await page.click("text=Sign in with password");
  await page.locator('input[type="email"]').last().fill(CREDS.email);
  await page.fill('input[type="password"]', CREDS.password);
  await page.getByRole('button', { name: /^Sign in$/ }).click();
  await page.waitForURL(/\/hub\/feed\/?/, { timeout: 25_000 });
  console.log("Logged in:", page.url());

  // Navigate to usage (simulates hard reload — goto is a fresh navigation)
  await page.goto(`${HUB}/usage`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);

  console.log("URL:", page.url());
  console.log("Errors:", JSON.stringify(errors, null, 2));
  console.log("API:", JSON.stringify(apiCalls, null, 2));

  fs.mkdirSync(path.join(__dirname, "../../test-results/repro-687"), { recursive: true });
  await page.screenshot({ path: path.join(__dirname, "../../test-results/repro-687/usage-before-fix.png"), fullPage: true });
});
