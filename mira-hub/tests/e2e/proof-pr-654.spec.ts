import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

// Proof-of-work spec for PR #654 (basepath fetch prefixes).
// Visits each affected page, logs the network requests made to /api/* or
// /hub/api/* paths, takes a full-page screenshot. Compares "before" run
// against "after" run after the fix deploys.
//
// Run:
//   PROOF_RUN=before npx playwright test tests/e2e/proof-pr-654.spec.ts
//   PROOF_RUN=after  npx playwright test tests/e2e/proof-pr-654.spec.ts
//
// Output dir: test-results/proof-pr-654/<run>/

const RUN = process.env.PROOF_RUN ?? "before";
const OUT_DIR = path.resolve(process.cwd(), `test-results/proof-pr-654/${RUN}`);

// Pages affected by PR #654, paired with the API path the fix changes.
const PAGES = [
  { route: "/hub/assets",    expectsApiPath: "/hub/api/assets",        wasBuggyApiPath: "/api/assets" },
  { route: "/hub/usage",     expectsApiPath: "/hub/api/usage",         wasBuggyApiPath: "/api/usage" },
  { route: "/hub/knowledge", expectsApiPath: "/hub/api/knowledge",     wasBuggyApiPath: "/api/knowledge" },
  { route: "/hub/event-log", expectsApiPath: "/hub/api/events",        wasBuggyApiPath: "/api/events" },
  { route: "/hub/channels",  expectsApiPath: "/hub/api/auth/status",   wasBuggyApiPath: "/api/auth/status" },
];

test.beforeAll(() => fs.mkdirSync(OUT_DIR, { recursive: true }));

for (const p of PAGES) {
  test(`${p.route} — capture network + screenshot`, async ({ page }) => {
    const apiCalls: { url: string; status: number; method: string }[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/api/") && !url.includes("/_next/")) {
        apiCalls.push({ url, status: 0, method: req.method() });
      }
    });
    page.on("response", (res) => {
      const url = res.url();
      const idx = apiCalls.findIndex((c) => c.url === url && c.status === 0);
      if (idx >= 0) apiCalls[idx].status = res.status();
    });

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto(p.route, { waitUntil: "networkidle", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500); // catch any late XHRs

    const screenshotPath = path.join(OUT_DIR, `${p.route.replace(/\//g, "_")}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const finalUrl = page.url();
    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 300) ?? "");

    const buggyHits = apiCalls.filter((c) => c.url.includes(p.wasBuggyApiPath) && !c.url.includes("/hub/"));
    const correctHits = apiCalls.filter((c) => c.url.includes(p.expectsApiPath));

    console.log(`\n=== ${p.route} (${RUN}) ===`);
    console.log(`Final URL:           ${finalUrl}`);
    console.log(`Page title:          "${title}"`);
    console.log(`Body text (300):     ${bodyText.replace(/\n/g, " ").slice(0, 200)}`);
    console.log(`Screenshot saved:    ${screenshotPath}`);
    console.log(`API calls (${apiCalls.length}):`);
    apiCalls.forEach((c) => console.log(`  ${c.method} ${c.status} ${c.url}`));
    console.log(`Hits to BUGGY path (${p.wasBuggyApiPath}):  ${buggyHits.length}`);
    console.log(`Hits to FIXED path (${p.expectsApiPath}):   ${correctHits.length}`);
    if (consoleErrors.length > 0) {
      console.log(`Console errors (${consoleErrors.length}):`);
      consoleErrors.slice(0, 3).forEach((e) => console.log(`  ${e.slice(0, 200)}`));
    }

    // Don't fail — diagnostic. We just want the output.
    expect(true).toBe(true);
  });
}
