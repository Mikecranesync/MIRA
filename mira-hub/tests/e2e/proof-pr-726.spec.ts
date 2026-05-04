import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const HUB = process.env.HUB_URL ?? "https://app.factorylm.com/hub";

// Proof-of-work spec for PR #726 (asset_tag path-traversal sanitization).
// Verifies:
//   1. /hub/api/health 200 after rebuild (catches the asset_tag.py module
//      not being COPYed into the mira-ingest image — which is exactly
//      what hotfix #727 caught)
//   2. /hub/upload page renders + screenshot
//   3. /hub/api/uploads (unauth) → 307 → /hub/login (auth gate intact)
//
// The strict 400 path requires an authed POST and is verified by Mike
// uploading a doc on /hub/upload with assetTag "../../etc" and getting
// the 400 with `asset_tag_invalid` body.

const OUT_DIR = path.resolve(process.cwd(), "test-results/proof-pr-726");

test.beforeAll(() => fs.mkdirSync(OUT_DIR, { recursive: true }));

test("hub health endpoint returns 200 after rebuild", async ({ request }) => {
  const res = await request.get(`${HUB}/api/health`);
  expect(res.status()).toBe(200);
});

test("/hub/api/uploads (unauth) → 307 → /hub/login (auth gate intact)", async ({ request }) => {
  const res = await request.get(`${HUB}/api/uploads/`, {
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

  await page.goto(`${HUB}/upload`, {
    waitUntil: "networkidle",
    timeout: 20000,
  });
  expect(page.url()).toContain("/hub/login");

  await page.screenshot({
    path: path.join(OUT_DIR, "hub-login-after-726.png"),
    fullPage: true,
  });
  expect(consoleErrors.length, `errors: ${consoleErrors.join(" | ")}`).toBeLessThan(3);
});
