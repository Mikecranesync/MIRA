/**
 * Promo screenshots spec — 2026-04-27
 * Captures desktop (1440x900) + mobile (412x915) screenshots of key hub pages.
 * Output: docs/promo-screenshots/ (append-only archive)
 */

import { test } from "@playwright/test";
import path from "path";
import fs from "fs";

const HUB = "https://app.factorylm.com/hub";
const ADMIN = { email: "playwright@factorylm.com", password: "TestPass123" };
const OUT = path.join(__dirname, "../../../docs/promo-screenshots");

async function loginWithPassword(page: import("@playwright/test").Page) {
  await page.goto(`${HUB}/login`, { waitUntil: "domcontentloaded" });
  await page.click("text=Sign in with password");
  await page.locator('input[type="email"]').last().fill(ADMIN.email);
  await page.fill('input[type="password"]', ADMIN.password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await page.waitForURL(/\/(feed|schedule|workorders|dashboard)/, { timeout: 15000 });
}

async function shot(page: import("@playwright/test").Page, name: string) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  → ${name}`);
}

test.beforeAll(() => {
  fs.mkdirSync(OUT, { recursive: true });
});

test("schedule — desktop", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginWithPassword(page);
  await page.goto(`${HUB}/schedule`, { waitUntil: "networkidle" });
  // Wait for calendar to load
  await page.waitForSelector("[class*=calendar],[class*=CalendarGrid],[data-testid=calendar]", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await shot(page, "2026-04-27_schedule-calendar-with-pms_desktop.png");
  await ctx.close();
});

test("schedule — mobile", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await loginWithPassword(page);
  await page.goto(`${HUB}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await shot(page, "2026-04-27_schedule-calendar-with-pms_mobile.png");
  await ctx.close();
});

test("workorders list — desktop", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginWithPassword(page);
  await page.goto(`${HUB}/workorders`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000); // allow API fetch + render
  await shot(page, "2026-04-27_workorders-auto-generated_desktop.png");
  await ctx.close();
});

test("workorders list — mobile", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  await loginWithPassword(page);
  await page.goto(`${HUB}/workorders`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  await shot(page, "2026-04-27_workorders-auto-generated_mobile.png");
  await ctx.close();
});

test("workorder detail — desktop", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginWithPassword(page);
  // Navigate directly to first auto-PM work order
  await page.goto(`${HUB}/workorders/ea60b681-bdd7-4138-b6e5-b785395a64a1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await shot(page, "2026-04-27_workorder-detail-from-manual_desktop.png");
  await ctx.close();
});

test("assets page — desktop", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginWithPassword(page);
  await page.goto(`${HUB}/assets`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await shot(page, "2026-04-27_assets-with-pm-count_desktop.png");
  await ctx.close();
});

test("event log — desktop", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginWithPassword(page);
  await page.goto(`${HUB}/event-log`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await shot(page, "2026-04-27_event-log-pm-activity_desktop.png");
  await ctx.close();
});

test("knowledge — desktop", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginWithPassword(page);
  await page.goto(`${HUB}/knowledge`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await shot(page, "2026-04-27_knowledge-indexed-manuals_desktop.png");
  await ctx.close();
});
