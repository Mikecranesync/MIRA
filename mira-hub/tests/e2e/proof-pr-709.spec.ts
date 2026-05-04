import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const HUB = process.env.HUB_URL ?? "https://app.factorylm.com/hub";

// Proof-of-work spec for PR #709 (structured JSON logs + X-Request-Id).
// Verifies:
//   1. /hub/api/health still 200 after rebuild
//   2. /hub/api/uploads (unauth) → 307 → /hub/login (auth gate intact)
//   3. /hub/upload page renders for unauth user (login redirect, no console
//      errors of consequence)
//   4. Screenshot saved as proof
//
// Live X-Request-Id round-trip + structured-log line count verification
// requires an authenticated upload, which is out of Playwright's scope here
// (mira-hub uses Google OAuth). Those acceptance criteria are verified
// post-deploy via `docker logs` against an authed test upload by Mike.
//
// Run:
//   npx playwright test tests/e2e/proof-pr-709.spec.ts

const OUT_DIR = path.resolve(process.cwd(), "test-results/proof-pr-709");

test.beforeAll(() => fs.mkdirSync(OUT_DIR, { recursive: true }));

test("hub health endpoint returns 200 after rebuild", async ({ request }) => {
  const res = await request.get(`${HUB}/api/health`);
  expect(res.status()).toBe(200);
  const body = await res.text();
  console.log(`health body: ${body.slice(0, 200)}`);
});

test("/hub/api/uploads (unauth) → 307 → /hub/login (auth gate intact)", async ({ request }) => {
  // maxRedirects: 0 to see the raw 307 (not the 200 from following to /hub/login)
  const res = await request.get(`${HUB}/api/uploads/`, {
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  expect(res.status()).toBe(307);
  const location = res.headers()["location"];
  expect(location).toContain("/hub/login");
  expect(location).toContain("callbackUrl");
  console.log(`uploads → ${res.status()} → ${location}`);
});

test("/hub/upload page renders + screenshot proof", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  await page.goto(`${HUB}/upload`, {
    waitUntil: "networkidle",
    timeout: 20000,
  });

  const finalUrl = page.url();
  console.log(`final url: ${finalUrl}`);
  expect(finalUrl).toContain("/hub/login");

  await page.screenshot({
    path: path.join(OUT_DIR, "hub-login-after-709.png"),
    fullPage: true,
  });
  console.log(`console errors: ${consoleErrors.length}`);
  consoleErrors.slice(0, 5).forEach((e) => console.log(`  ${e.slice(0, 200)}`));
  // Existing pipeline-API-URL warning is the only known noise
  expect(consoleErrors.length, `errors: ${consoleErrors.join(" | ")}`).toBeLessThan(3);
});
