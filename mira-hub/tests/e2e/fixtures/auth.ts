/**
 * Auth fixture for the deep-crawl audit spec.
 *
 * Reuses the playwright@factorylm.com test account established by
 * proof-pr-749-login-gate.spec.ts. Idempotent register call ensures the
 * account exists before sign-in. State is written to tests/e2e/.state/hub.json
 * via Playwright's globalSetup so the crawl spec can reuse the same session
 * across all 32 routes without 32× login overhead.
 */

import type { APIRequestContext, Page } from "@playwright/test";

// Hub migrated from /hub subpath to root; default reflects current production.
// Override via HUB_URL=https://app.factorylm.com/hub if testing the legacy redirect path.
export const HUB_URL = process.env.HUB_URL ?? "https://app.factorylm.com";

export const AUDIT_USER = {
  email: process.env.E2E_HUB_EMAIL ?? "playwright@factorylm.com",
  password: process.env.E2E_HUB_PASSWORD ?? "TestPass123",
  name: "Playwright Audit",
};

export const STORAGE_STATE_PATH = "tests/e2e/.state/hub.json";

export async function ensureUserRegistered(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${HUB_URL}/api/auth/register/`, {
    data: {
      email: AUDIT_USER.email,
      password: AUDIT_USER.password,
      name: AUDIT_USER.name,
    },
    failOnStatusCode: false,
  });
  // 200 = newly registered, 409 = already exists, both are OK
  if (res.status() >= 500) {
    throw new Error(`register endpoint returned ${res.status()}: ${await res.text()}`);
  }
}

export async function loginWithPassword(page: Page): Promise<void> {
  await page.goto(`${HUB_URL}/login`, { waitUntil: "networkidle" });
  // React hydration must complete before the toggle button works.
  // Poll for the toggle and click via locator (auto-waits for hydration).
  const toggle = page.getByRole("button", { name: "Sign in with password" });
  await toggle.waitFor({ state: "visible", timeout: 15_000 });
  // Some headless runs need a moment after hydration for the onClick handler
  // to attach. Click twice if the form doesn't reveal after the first click.
  for (let i = 0; i < 3; i++) {
    await toggle.click({ force: true });
    try {
      await page.locator('input[type="password"]').waitFor({ state: "visible", timeout: 4_000 });
      break;
    } catch {
      // Toggle may have toggled back off — try again
      await page.waitForTimeout(500);
    }
  }
  await page.locator('input[type="password"]').waitFor({ state: "visible", timeout: 5_000 });
  // Two email inputs on the page — magic link first, credentials second
  await page.locator('input[type="email"]').last().fill(AUDIT_USER.email);
  await page.fill('input[type="password"]', AUDIT_USER.password);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  // Accept /feed (current root mount) or /hub/feed (legacy subpath) — handles both phases.
  await page.waitForURL(/\/(?:hub\/)?(feed|pending-approval|upgrade)\/?/, { timeout: 30_000 });
}
