// One-off screenshot capture for the hub-overhaul PR (2026-05-20).
// Captures /hub/quickstart at desktop + mobile viewports and drops the
// PNGs into ../docs/promo-screenshots/. The dev server must be running on
// http://localhost:3100 (basePath = /hub).
//
// Usage:
//   bun run tools/screenshot-quickstart.mjs

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const URL = process.env.QUICKSTART_URL ?? "http://localhost:3100/hub/quickstart/";
const OUT = join("..", "docs", "promo-screenshots");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

async function snap(name, viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle", timeout: 20_000 });
  // Give the manufacturer fetch a beat to settle.
  await page.waitForTimeout(800);
  const file = join(OUT, `2026-05-20_hub-overhaul_${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`📸 ${file}`);
  await ctx.close();
}

await snap("quickstart_desktop", { width: 1440, height: 900 });
await snap("quickstart_mobile",  { width: 375,  height: 812 });

await browser.close();
console.log("done");
