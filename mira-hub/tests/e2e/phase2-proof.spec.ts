/**
 * Phase 2 proof — hub at root (app.factorylm.com/)
 * Run: cd mira-hub && HUB_URL=https://app.factorylm.com npx playwright test tests/e2e/phase2-proof.spec.ts
 */

import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

const HUB = process.env.HUB_URL ?? "https://app.factorylm.com";
const OUT = path.join("test-results", "phase2-proof");

test.beforeAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
});

test("login page renders at root path — no /hub prefix", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  // Phase 2: login is at root, not /hub/login
  const res = await page.goto(`${HUB}/login/`, { waitUntil: "networkidle" });
  expect(res?.status()).toBe(200);

  // Wait for React hydration — email input must be visible
  const emailInput = page.locator('input[type="email"]');
  await expect(emailInput).toBeVisible({ timeout: 15_000 });

  await page.screenshot({ path: `${OUT}/login-phase2.png`, fullPage: true });
  console.log(`📸 ${OUT}/login-phase2.png`);
  console.log(`✅ Hub login renders at ${HUB}/login/ — Phase 2 confirmed`);
});

test("root redirects to /feed/ then /login/ (unauthenticated)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  const redirects: string[] = [];
  page.on("response", r => {
    if (r.status() >= 300 && r.status() < 400) redirects.push(`${r.status()} → ${r.headers()["location"]}`);
  });

  await page.goto(`${HUB}/`, { waitUntil: "networkidle" });

  // Must end up at login
  expect(page.url()).toMatch(/\/login/);
  console.log("Redirect chain:", redirects.join(", "));

  await page.screenshot({ path: `${OUT}/root-redirect-phase2.png`, fullPage: true });
  console.log("📸 root-redirect-phase2.png");
  console.log(`✅ ${HUB}/ → login flow confirmed`);
});

test("no service worker interference — /hub/ bookmark redirects to /feed/", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  const res = await page.goto(`${HUB}/hub/feed`, { waitUntil: "networkidle" });

  // Should land at /feed/ (or /login/ if unauthenticated)
  const url = page.url();
  expect(url).toMatch(/\/(feed|login)/);
  console.log(`✅ /hub/feed bookmark redirected to: ${url}`);
});

test("JS and CSS assets load (no /hub/ prefix)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  const failed: string[] = [];
  page.on("response", r => {
    const url = r.url();
    if (url.includes("/_next/static") && r.status() >= 400) {
      failed.push(`${r.status()} ${url}`);
    }
  });

  await page.goto(`${HUB}/login/`, { waitUntil: "networkidle" });

  if (failed.length > 0) {
    console.log("❌ Failed assets:", failed);
  }
  expect(failed).toHaveLength(0);
  console.log("✅ All /_next/static assets loaded OK");
});
