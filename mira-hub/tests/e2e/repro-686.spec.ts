import { test, expect } from "@playwright/test";

const HUB = process.env.HUB_URL ?? "https://app.factorylm.com/hub";
const CREDS = { email: "playwright@factorylm.com", password: "TestPass123" };

test.beforeAll(async ({ request }) => {
  await request.post(`${HUB}/api/auth/register/`, {
    data: { email: CREDS.email, password: CREDS.password, name: "Playwright 686" },
  });
});

test("repro #686 — /assets redirects to login after login", async ({ page }) => {
  // Capture all fetch requests + responses
  const apiCalls: { url: string; status: number; body: string }[] = [];
  page.on("response", async (resp) => {
    if (resp.url().includes("/api/assets")) {
      const body = await resp.text().catch(() => "");
      apiCalls.push({ url: resp.url(), status: resp.status(), body: body.slice(0, 200) });
    }
  });

  // Login
  await page.goto(`${HUB}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', CREDS.email);
  await page.fill('input[type="password"]', CREDS.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/hub\/feed\/?/, { timeout: 25_000 });
  console.log("✅ Logged in at:", page.url());

  // Navigate to /assets
  await page.goto(`${HUB}/assets`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const finalUrl = page.url();
  console.log("Final URL:", finalUrl);
  console.log("API calls intercepted:", JSON.stringify(apiCalls, null, 2));

  await page.screenshot({ path: "test-results/repro-686/result.png" });

  // Report result
  if (finalUrl.includes("/login")) {
    console.log("❌ REPRODUCED: redirected to login");
  } else {
    console.log("✅ NOT reproduced: stayed on assets page");
  }
});
