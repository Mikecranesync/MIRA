#!/usr/bin/env bun
/**
 * Lightweight one-shot screenshot helper that uses a fresh chromium
 * launch (no persistent context) to dodge the Windows Defender first-
 * launch timeout we hit with snapshot-darktheme.ts.
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..");
const outDir = join(repoRoot, "docs", "promo-screenshots");
await mkdir(outDir, { recursive: true });

const url = process.argv[2] ?? "http://localhost:8888/";
const tag = process.argv[3] ?? "snap";

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 412, height: 915 },
] as const;

console.log(`URL: ${url}\nTag: ${tag}\nOut: ${outDir}\n`);

const browser = await chromium.launch({
  headless: true,
  timeout: 90_000,
  channel: "chrome",
});
const ctx = await browser.newContext();
try {
  for (const vp of viewports) {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const errs: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(800);
    const path = join(outDir, `2026-05-03_${tag}_${vp.name}.png`);
    await page.screenshot({ path, fullPage: true });
    console.log(`OK  ${vp.name.padEnd(7)} -> ${path}`);
    if (errs.length) {
      console.log(`  console errors:`);
      for (const e of errs) console.log(`   - ${e}`);
    }
    await page.close();
  }
} finally {
  await ctx.close();
  await browser.close();
}
console.log("\nDone.");
