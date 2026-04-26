/**
 * Playwright global setup — logs in the e2e audit user and saves
 * the cookie/storage state to playwright/.auth/user.json so the UX
 * audit spec can reuse it without logging in on every page.
 */
import { chromium, type FullConfig } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const AUTH_FILE = path.resolve(__dirname, "../../playwright/.auth/user.json");

export default async function setup(_config: FullConfig) {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto("https://app.factorylm.com/hub/login/", { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "e2e-audit@factorylm.com");
  await page.fill('input[type="password"]', "audit-pw-2026");
  await page.click('button[type="submit"]');

  // Wait for redirect to /hub/feed/
  await page.waitForURL(/\/hub\/feed/, { timeout: 20_000 });

  await page.context().storageState({ path: AUTH_FILE });
  await browser.close();
  console.log("[auth-setup] Saved auth state to", AUTH_FILE);
}
