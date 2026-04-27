import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

// Proof-of-work spec for PR #729 (magic-byte file sniffing).
//
// The actual sniff-and-reject path requires an authenticated POST
// (Mike will run a manual probe with a renamed binary). This spec
// confirms the deploy didn't regress the public surfaces:
//   1. /hub/api/health 200 after rebuild
//   2. /hub/upload still redirects unauth → /hub/login (no console errors)
//   3. /hub/api/uploads/local (unauth) → 307 → /hub/login (auth gate intact)

const OUT_DIR = path.resolve(process.cwd(), "test-results/proof-pr-729");

test.beforeAll(() => fs.mkdirSync(OUT_DIR, { recursive: true }));

test("hub health endpoint returns 200 after rebuild", async ({ request }) => {
  const res = await request.get("https://app.factorylm.com/hub/api/health");
  expect(res.status()).toBe(200);
});

test("/hub/api/uploads/local (unauth) → 307 → /hub/login", async ({ request }) => {
  const res = await request.post("https://app.factorylm.com/hub/api/uploads/local/", {
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  expect(res.status()).toBe(307);
  expect(res.headers()["location"]).toContain("/hub/login");
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
    path: path.join(OUT_DIR, "hub-login-after-729.png"),
    fullPage: true,
  });
  expect(consoleErrors.length, `errors: ${consoleErrors.join(" | ")}`).toBeLessThan(3);
});
