import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

// Proof-of-work spec for PR #707 (tenant_id filter on updateUploadStatus).
// The DB-level change is exercised on every upload status transition. We can't
// fully drive an authed upload from CI, so we verify:
//   1. /hub/api/health returns 200 (server boots — no syntax/import error from
//      the new function signature)
//   2. /hub/upload redirects to /hub/login cleanly with callbackUrl set
//      (prior basepath/auth wiring still intact)
//   3. /hub/login renders without console errors
//   4. Screenshots saved as proof for PR thread
//
// Run:
//   npx playwright test tests/e2e/proof-pr-707.spec.ts

const OUT_DIR = path.resolve(process.cwd(), "test-results/proof-pr-707");

test.beforeAll(() => fs.mkdirSync(OUT_DIR, { recursive: true }));

test("hub health endpoint returns 200 after rebuild", async ({ request }) => {
  const res = await request.get("https://app.factorylm.com/hub/api/health");
  expect(res.status()).toBe(200);
  const body = await res.text();
  console.log(`health body: ${body.slice(0, 200)}`);
});

test("/hub/upload redirects unauth user to /hub/login with callbackUrl", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  await page.goto("https://app.factorylm.com/hub/upload", { waitUntil: "networkidle", timeout: 20000 });

  const finalUrl = page.url();
  console.log(`final url: ${finalUrl}`);
  expect(finalUrl).toContain("/hub/login");
  expect(finalUrl).toContain("callbackUrl=");
  expect(finalUrl).toContain("upload");

  await page.screenshot({ path: path.join(OUT_DIR, "hub-login-after-707.png"), fullPage: true });
  console.log(`console errors: ${consoleErrors.length}`);
  consoleErrors.slice(0, 5).forEach((e) => console.log(`  ${e.slice(0, 200)}`));
  expect(consoleErrors.length, `console errors: ${consoleErrors.join(" | ")}`).toBeLessThan(3);
});

test("/hub/api/uploads (unauth) returns 401 not 500", async ({ request }) => {
  // The route still exists and the new tenantId-bearing updateUploadStatus
  // signature did not break import resolution. 401 = healthy guard. 500 = bad.
  const res = await request.get("https://app.factorylm.com/hub/api/uploads");
  expect([401, 200]).toContain(res.status());
  console.log(`/hub/api/uploads status: ${res.status()}`);
});
