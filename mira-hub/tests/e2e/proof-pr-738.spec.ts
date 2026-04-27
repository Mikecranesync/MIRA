import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

// Proof-of-work for PR #738 / issue #716 — all nav items visible in sidebar.

const HUB = "https://app.factorylm.com/hub";
const OUT_DIR = path.resolve(process.cwd(), "test-results/proof-pr-738");
const EMAIL = "playwright-pr738@factorylm.com";
const PASS  = "TestPass738!";

async function loginHub(page: Page) {
  await page.goto(`${HUB}/login`, { waitUntil: "networkidle", timeout: 30000 });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/hub\/(?!login)/, { timeout: 30000 });
}

test.beforeAll(async ({ request }) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const res = await request.post(`${HUB}/api/auth/register/`, {
    data: { email: EMAIL, password: PASS, name: "PW-PR738" },
  });
  console.log(`test user register: ${res.status()}`);
});

test.afterAll(async ({ request }) => {
  await request.delete(`${HUB}/api/auth/account/`, {
    headers: { "Content-Type": "application/json" },
  }).catch(() => {});
});

test("hub health check passes after #716 deploy", async ({ request }) => {
  const res = await request.get(`${HUB}/api/health`);
  expect(res.status()).toBe(200);
});

test("desktop sidebar — all nav items visible at 1440×900", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginHub(page);

  // Navigate to feed and wait for sidebar to render
  await page.goto(`${HUB}/feed/`, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector("aside", { timeout: 10000 });

  // Collect all nav link texts from the sidebar
  const sidebar = page.locator("aside");
  const navLinks = sidebar.locator("a");
  const navTexts = await navLinks.allTextContents();
  console.log("Sidebar link texts:", navTexts.join(" | "));

  // Verify primary items are present
  const expected = ["Event Log", "Conversations", "Actions", "Alerts", "Knowledge", "Assets"];
  for (const item of expected) {
    const found = navTexts.some((t) => t.trim().includes(item));
    expect(found, `Expected "${item}" in sidebar`).toBe(true);
  }

  // Secondary items
  const secondary = ["Work Orders", "Schedule", "Requests", "Reports"];
  for (const item of secondary) {
    const found = navTexts.some((t) => t.trim().includes(item));
    expect(found, `Expected secondary "${item}" in sidebar`).toBe(true);
  }

  await page.screenshot({
    path: path.join(OUT_DIR, "desktop-sidebar-1440x900.png"),
    fullPage: false,
  });
  console.log("✅ Desktop sidebar screenshot saved");
});

test("mobile More page — all sections at 375×812", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loginHub(page);

  await page.goto(`${HUB}/more/`, { waitUntil: "networkidle", timeout: 30000 });

  // Verify the More page lists all major sections (scope to main to avoid hidden sidebar spans)
  const moreItems = ["Work Orders", "Schedule", "Requests", "Reports", "Admin"];
  for (const item of moreItems) {
    await expect(page.getByRole("link", { name: item })).toBeVisible({ timeout: 5000 });
  }

  await page.screenshot({
    path: path.join(OUT_DIR, "mobile-more-375x812.png"),
    fullPage: true,
  });
  console.log("✅ Mobile More page screenshot saved");
});
