#!/usr/bin/env bun
/**
 * verify-deployment — Playwright smoke + visual proof against a live URL.
 *
 * For each known surface, this script:
 *   1. Hits the URL, asserts HTTP 200
 *   2. Confirms key selectors are present in the DOM
 *   3. Confirms the design-system CSS *actually loaded* by reading a computed
 *      style and checking it's a token color (not a browser default). This
 *      catches the failure mode where /_tokens.css 404s but page still renders.
 *   4. Captures live-{desktop,mobile}.png into docs/design-history/<date>-<label>/
 *
 * Exit code 0 = all assertions passed. Non-zero = verification failed.
 *
 * Usage:
 *   bun run scripts/verify-deployment.ts <base-url> <surface>
 *
 * Surfaces:
 *   home   — new homepage (hero L1 + trust band + 3-card row)
 *   cmms   — magic-link landing (one input + 3-step strip)
 *   sample — Phase-0 placeholder (single CTA)
 *   legacy-home — baseline check before #692 ships (old static index.html)
 *   legacy-cmms — baseline check before #706 ships (old beta form)
 *
 * Examples:
 *   bun run verify:live https://factorylm.com home
 *   bun run verify:live http://localhost:3000 cmms
 */
import { chromium, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

interface Surface {
  path: string;
  label: string;
  // CSS selectors that MUST exist
  required: string[];
  // CSS selectors that must NOT exist (regression markers)
  forbidden?: string[];
  // Element + computed CSS property that must match a non-default value
  styleAssertions?: Array<{
    selector: string;
    property: string;
    notEqual?: string[]; // fail if value matches any of these (e.g. 'rgb(0, 0, 0)' = unstyled)
    matches?: RegExp;
  }>;
}

const SURFACES: Record<string, Surface> = {
  home: {
    path: "/",
    label: "so100-home",
    required: [
      "h1",
      ".fl-hero-h1",
      ".fl-trust-band",
      ".fl-project-row",
      ".fl-compare",
      ".fl-state-row",
      "#fl-sun-toggle",
      'script[type="application/ld+json"]',
    ],
    forbidden: [
      // Legacy dark hero markers
      ".equipment-fade",
      "#beta-form",
    ],
    styleAssertions: [
      {
        // The H1 should be navy (--fl-navy-900 = #1B365D = rgb(27, 54, 93)),
        // not browser default black. Catches /_tokens.css 404.
        selector: ".fl-hero-h1",
        property: "color",
        matches: /^rgb\(27,\s*54,\s*93\)$/,
      },
      {
        // Hero gradient background — the section should NOT be transparent.
        selector: ".fl-hero",
        property: "background-image",
        notEqual: ["none"],
      },
    ],
  },
  cmms: {
    path: "/cmms",
    label: "so070-cmms",
    required: [
      "h1",
      "#fl-magic-form",
      "#cmms-email",
      "#fl-magic-submit",
      ".fl-steps",
      ".fl-compare",
      "#fl-sun-toggle",
    ],
    forbidden: [
      // Legacy multi-field beta form markers
      "#beta-company",
      "#beta-role",
      "#beta-plant-size",
    ],
    styleAssertions: [
      {
        // The submit button is .fl-btn-primary → orange (--fl-orange-600 = #C9531C ≈ rgb(201, 83, 28))
        selector: "#fl-magic-submit",
        property: "background-color",
        notEqual: ["rgba(0, 0, 0, 0)", "rgb(0, 0, 0)", "rgb(255, 255, 255)"],
      },
    ],
  },
  sample: {
    path: "/sample",
    label: "so070-cmms",
    required: ["h1", ".fl-sample-card", 'a[href="/activated"]'],
  },
  "legacy-home": {
    path: "/",
    label: "so100-home-baseline",
    required: ["title"],
  },
  "legacy-cmms": {
    path: "/cmms",
    label: "so070-cmms-baseline",
    required: ["title"],
  },
};

const [, , baseUrl, surfaceKey] = process.argv;

if (!baseUrl || !surfaceKey) {
  console.error(
    "Usage: verify-deployment <base-url> <surface>\n" +
      "Surfaces: " +
      Object.keys(SURFACES).join(", ")
  );
  process.exit(2);
}

const surface = SURFACES[surfaceKey];
if (!surface) {
  console.error(`Unknown surface '${surfaceKey}'. Known: ${Object.keys(SURFACES).join(", ")}`);
  process.exit(2);
}

const url = baseUrl.replace(/\/$/, "") + surface.path;
const date = new Date().toISOString().slice(0, 10);
const repoRoot = resolve(import.meta.dir, "..", "..");
const outDir = join(repoRoot, "docs", "design-history", `${date}-${surface.label}`);
await mkdir(outDir, { recursive: true });

console.log(`\n→ Verifying ${url}\n`);

const failures: string[] = [];
const browser = await chromium.launch();

async function runChecks(page: Page, label: string): Promise<void> {
  // Required selectors
  for (const sel of surface.required) {
    const count = await page.locator(sel).count();
    if (count === 0) {
      failures.push(`[${label}] required selector missing: ${sel}`);
    } else {
      console.log(`  ✓ found ${sel}`);
    }
  }
  // Forbidden selectors
  for (const sel of surface.forbidden ?? []) {
    const count = await page.locator(sel).count();
    if (count > 0) {
      failures.push(`[${label}] forbidden selector present (regression): ${sel}`);
    } else {
      console.log(`  ✓ regression marker absent: ${sel}`);
    }
  }
  // Style assertions
  for (const a of surface.styleAssertions ?? []) {
    const value = await page
      .locator(a.selector)
      .first()
      .evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), a.property);
    const v = value.trim();
    if (a.notEqual && a.notEqual.includes(v)) {
      failures.push(
        `[${label}] ${a.selector} ${a.property}='${v}' matches forbidden default — design-system CSS likely failed to load`
      );
    } else if (a.matches && !a.matches.test(v)) {
      failures.push(
        `[${label}] ${a.selector} ${a.property}='${v}' does not match expected pattern ${a.matches}`
      );
    } else {
      console.log(`  ✓ ${a.selector} ${a.property} = ${v}`);
    }
  }
}

try {
  for (const vp of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ] as const) {
    console.log(`\n[${vp.name}] ${vp.width}×${vp.height}`);
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.name === "mobile" ? 2 : 1,
    });
    const page = await ctx.newPage();

    const resp = await page.goto(url, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    if (!resp || resp.status() < 200 || resp.status() >= 400) {
      failures.push(`[${vp.name}] HTTP ${resp?.status() ?? "no-response"} — expected 200`);
    } else {
      console.log(`  ✓ HTTP ${resp.status()}`);
    }

    await page.waitForTimeout(800);
    await runChecks(page, vp.name);

    const path = join(outDir, `live-${vp.name}.png`);
    await page.screenshot({ path, fullPage: true });
    console.log(`  saved ${path}`);

    await ctx.close();
  }
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`\n✘ FAILED — ${failures.length} assertion(s) did not pass:`);
  for (const f of failures) console.error(`  • ${f}`);
  process.exit(1);
}

console.log(`\n✓ PASSED — ${surface.label} verified at ${baseUrl}`);
console.log(`  proof saved: ${outDir}/live-{desktop,mobile}.png`);
