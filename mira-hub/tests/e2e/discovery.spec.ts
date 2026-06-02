/**
 * Local e2e proof for the Hub /discovery surface (feat/hub-discovery-scan).
 *
 * Flow: mint a next-auth session cookie → POST the sample inventory through the
 * REAL /api/discovery route (exercises validation + the in-memory store) → load
 * /discovery and assert the page renders the stored payload. Also captures the
 * desktop + mobile promo screenshots (Screenshot Rule).
 *
 * Run: npx playwright test -c playwright.discovery.config.ts
 */
import { test, expect } from "@playwright/test";
import { encode } from "next-auth/jwt";
import * as fs from "fs";
import * as path from "path";

const AUTH_SECRET = "test-auth-secret-fieldbus-discovery-e2e";
const TENANT = "11111111-1111-1111-1111-111111111111";
const SCREENSHOT_DIR = path.resolve(__dirname, "../../../docs/promo-screenshots");
const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/inventory.sample.json"), "utf8"),
);

test("discovery page renders an uploaded fieldbus inventory", async ({ page, context, baseURL }) => {
  // Mint a session JWE matching the server's AUTH_SECRET (decode/encode salt="").
  const token = await encode({
    token: {
      uid: "u-e2e",
      tid: TENANT,
      email: "tech@example.com",
      status: "trial",
      trialExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    },
    secret: AUTH_SECRET,
  });
  await context.addCookies([
    { name: "next-auth.session-token", value: token, url: baseURL! },
  ]);

  // POST the fixture through the real route (uses the cookie from the context).
  const post = await page.request.post(`${baseURL}/api/discovery`, { data: FIXTURE });
  expect(post.ok(), `POST /api/discovery → ${post.status()}`).toBeTruthy();
  expect((await post.json()).deviceCount).toBe(2);

  // Load the page; its client GET returns the stored inventory.
  await page.goto("/discovery");

  const card = page.locator('[data-testid="discovery-device"][data-profile="micro820"]');
  await expect(card).toBeVisible();

  // device_identified → green tier badge.
  await expect(card.locator('[data-testid="tier-badge"]')).toHaveClass(/status-green/);

  // uns_hint rendered.
  await expect(card.locator('[data-testid="uns-hint"]')).toContainText(
    "enterprise.knowledge_base.rockwell_automation.micro820",
  );

  // port_open device + unknowns section both present.
  await expect(
    page.locator('[data-testid="discovery-device"][data-tier="port_open"]'),
  ).toBeVisible();
  await expect(page.locator('[data-testid="discovery-unknowns"]')).toBeVisible();

  // Promo screenshots (Screenshot Rule): desktop + mobile.
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, "2026-05-29_hub-discovery-scan_desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 412, height: 915 });
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, "2026-05-29_hub-discovery-scan_mobile.png"),
    fullPage: true,
  });
});
