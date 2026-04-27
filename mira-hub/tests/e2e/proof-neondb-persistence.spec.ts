/**
 * Proof: auth users survive container rebuild (NeonDB persistence).
 * Run after a docker stop/rm/run cycle to confirm users are NOT lost.
 *
 * Usage:
 *   # Step 1 — create user + record ID
 *   npx playwright test tests/e2e/proof-neondb-persistence.spec.ts --grep "create and record"
 *
 *   # Step 2 — rebuild container on VPS (docker stop/rm/run)
 *
 *   # Step 3 — verify user still exists
 *   npx playwright test tests/e2e/proof-neondb-persistence.spec.ts --grep "survive rebuild"
 */

import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const HUB = process.env.HUB_URL ?? "https://app.factorylm.com";
// Use absolute path outside test-results/ (playwright clears that dir on each run)
const STATE_FILE = path.join(__dirname, ".state/neondb-persistence-user.json");
const EMAIL = `neondb-proof-${Date.now()}@factorylm-test.com`;
const PASSWORD = "Persist1234!";

test("Phase 1 proof: create user and record", async ({ request }) => {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const res = await request.post(`${HUB}/api/auth/register`, {
    data: { email: EMAIL, password: PASSWORD, name: "NeonDB Proof" },
  });
  expect(res.status()).toBeLessThan(300);
  fs.writeFileSync(STATE_FILE, JSON.stringify({ email: EMAIL, password: PASSWORD }));
  console.log(`✅ User created: ${EMAIL}`);
  console.log(`📝 Saved to ${STATE_FILE}`);
  console.log(`🔄 Now rebuild container, then run the 'survive rebuild' test`);
});

test("Phase 1 proof: user survives container rebuild", async ({ page }) => {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as { email: string; password: string };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${HUB}/login`, { waitUntil: "domcontentloaded" });

  await page.locator("text=Sign in with password").click();
  await page.waitForSelector('input[type="password"]', { timeout: 5_000 });

  await page.locator('input[type="email"]').nth(1).fill(state.email);
  await page.locator('input[type="password"]').fill(state.password);
  await page.locator('button[type="submit"]').last().click();

  await page.waitForURL(/\/feed/, { timeout: 20_000 });
  const url = page.url();
  expect(url).toMatch(/\/feed/);
  console.log(`✅ User ${state.email} survived container rebuild — logged in at ${url}`);

  const screenshotDir = path.join(__dirname, "../../docs/promo-screenshots");
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({
    path: path.join(screenshotDir, "neondb-persistence-proof-2026-04-27.png"),
    fullPage: false,
  });
  console.log(`📸 Screenshot saved`);
});
