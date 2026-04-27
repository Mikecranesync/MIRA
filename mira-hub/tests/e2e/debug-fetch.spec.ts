import { test, expect } from "@playwright/test";

const HUB = process.env.HUB_URL ?? "https://app.factorylm.com/hub";

test("debug: what URL does /hub/assets page fetch?", async ({ page }) => {
  const fetchedUrls: string[] = [];
  page.on("request", req => {
    if (req.url().includes("assets")) fetchedUrls.push(`${req.method()} ${req.url()}`);
  });
  page.on("response", resp => {
    if (resp.url().includes("assets")) fetchedUrls.push(`  → ${resp.status()} ${resp.url()}`);
  });

  // login
  await page.goto(`${HUB}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "mike@factorylm.com");
  await page.fill('input[type="password"]', "admin123");
  await page.click('button:has-text("Sign In")');
  await page.waitForURL(/\/hub\/feed/, { timeout: 15_000 });

  // navigate to assets
  await page.goto(`${HUB}/assets`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  console.log("=== Asset-related requests ===");
  fetchedUrls.forEach(u => console.log(u));
  const assetCount = await page.locator('a[href*="/hub/assets/"]').count();
  console.log(`Tile count: ${assetCount}`);
});
