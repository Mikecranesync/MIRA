import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

// Proof-of-work spec for PR #733 (cloud-source upload idempotency).
//
// True dedup verification needs an authed double-upload of the same Drive
// file (Mike to verify manually). This spec confirms the deploy didn't
// regress public surfaces.

const OUT_DIR = path.resolve(process.cwd(), "test-results/proof-pr-733");

test.beforeAll(() => fs.mkdirSync(OUT_DIR, { recursive: true }));

test("hub health endpoint returns 200 after rebuild", async ({ request }) => {
  const res = await request.get("https://app.factorylm.com/hub/api/health");
  expect(res.status()).toBe(200);
});

test("/hub/upload renders + screenshot proof", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  await page.goto("https://app.factorylm.com/hub/upload", {
    waitUntil: "networkidle",
    timeout: 20000,
  });
  expect(page.url()).toContain("/hub/login");

  await page.screenshot({
    path: path.join(OUT_DIR, "hub-login-after-733.png"),
    fullPage: true,
  });
  expect(consoleErrors.length, `errors: ${consoleErrors.join(" | ")}`).toBeLessThan(3);
});
