#!/usr/bin/env bun
/**
 * One-off helper: capture homepage at desktop + mobile to compare the
 * dark-theme rebrand against the previous light-theme baseline. Uses a
 * persistent user-data-dir under .playwright-cache/ to avoid the slow
 * Windows-Defender first-launch scan that timed out an earlier attempt.
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";

const repoRoot = resolve(import.meta.dir, "..", "..");
const outDir = join(repoRoot, "docs", "promo-screenshots");
const cacheDir = join(repoRoot, ".playwright-cache");
await mkdir(outDir, { recursive: true });
await mkdir(cacheDir, { recursive: true });

const url = process.argv[2] ?? "http://localhost:3201/";
const tag = process.argv[3] ?? "darktheme-pre";

const viewports = [
  { name: "desktop", width: 1440, height: 900, scale: 1 },
  { name: "mobile", width: 412, height: 915, scale: 2 },
] as const;

console.log(`URL: ${url}\nTag: ${tag}\nOut: ${outDir}\n`);

const ctx = await chromium.launchPersistentContext(cacheDir, {
  headless: true,
  timeout: 60_000,
});
try {
  for (const vp of viewports) {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const errs: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    // Cartoons mount on DOMContentLoaded; allow first scene to settle.
    await page.waitForTimeout(900);
    const path = join(outDir, `2026-05-03_${tag}_${vp.name}.png`);
    await page.screenshot({ path, fullPage: true });
    console.log(`✓ ${vp.name.padEnd(7)} → ${path}`);
    if (errs.length) {
      console.log(`  console errors:`);
      for (const e of errs) console.log(`   - ${e}`);
    }
    await page.close();
  }
} finally {
  await ctx.close();
}
console.log("\nDone.");
