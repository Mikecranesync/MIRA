#!/usr/bin/env bun
/**
 * design-snapshot — capture full-page screenshots (desktop + mobile) for
 * before/after design diffs. Saves to docs/design-history/<date>-<label>/.
 *
 * Usage:
 *   bun run mira-web/scripts/design-snapshot.ts <before|after> <url> <label>
 *
 * Example (before any UI change):
 *   bun run snapshot:before http://localhost:3000/cmms so070-cmms
 *
 * After edits + redeploy:
 *   bun run snapshot:after http://localhost:3000/cmms so070-cmms
 *
 * Output:
 *   docs/design-history/2026-04-26-so070-cmms/before-desktop.png
 *   docs/design-history/2026-04-26-so070-cmms/before-mobile.png
 *   docs/design-history/2026-04-26-so070-cmms/after-desktop.png
 *   docs/design-history/2026-04-26-so070-cmms/after-mobile.png
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const [, , phase, url, label] = process.argv;

if (!url || !label || !phase) {
  console.error(
    "Usage: design-snapshot <before|after> <url> <label>\n" +
      "Example: design-snapshot before http://localhost:3000/cmms so070-cmms"
  );
  process.exit(1);
}

if (phase !== "before" && phase !== "after") {
  console.error(`phase must be 'before' or 'after' (got '${phase}')`);
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10);
const repoRoot = resolve(import.meta.dir, "..", "..");
const outDir = join(repoRoot, "docs", "design-history", `${date}-${label}`);
await mkdir(outDir, { recursive: true });

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

const browser = await chromium.launch();

try {
  for (const vp of viewports) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.name === "mobile" ? 2 : 1,
    });
    const page = await ctx.newPage();

    await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 15_000,
    });
    await page.waitForTimeout(800);

    const path = join(outDir, `${phase}-${vp.name}.png`);
    await page.screenshot({ path, fullPage: true });
    console.log(`  saved ${vp.name.padEnd(7)} → ${path}`);

    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log(`\nDone: ${outDir}`);
