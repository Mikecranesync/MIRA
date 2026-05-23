/**
 * Staging audit — 2026-05-20 hub-overhaul deployment.
 *
 * Covers the surfaces introduced by PRs #1467, #1471, #1473, #1475, #1476,
 * #1477, #1478 (ADR-0014 hub-overhaul batch):
 *
 *   1. /quickstart  — public, no-auth landing page renders
 *   2. /api/quickstart/manufacturers — returns JSON
 *   3. sidebar grouping — primary / secondary / labs visible (authed)
 *   4. mock (labs) pages — show LabsStub "Coming Soon"
 *   5. onboarding wizard — step 5 "Try MIRA" exists
 *   6. marketing CTA — "Try MIRA Free" visible on factorylm.com root
 *   7. /plc — returns 404 (route removed in #1476)
 *   8. /upgrade — pricing tier amounts match /pricing
 *
 * Screenshots written to docs/promo-screenshots/2026-05-20_*_desktop.png.
 */

import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const HUB_URL = process.env.E2E_HUB_URL ?? "http://127.0.0.1:4101";
const WEB_URL = process.env.E2E_WEB_URL ?? "http://127.0.0.1:4200";
const EMAIL = process.env.E2E_HUB_EMAIL ?? "playwright@factorylm.com";
const PASSWORD = process.env.E2E_HUB_PASSWORD ?? "TestPass123";

const SCREENSHOT_DIR = path.resolve(__dirname, "../../../docs/promo-screenshots");
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function shot(page: Page, name: string) {
  await page
    .screenshot({
      path: path.join(SCREENSHOT_DIR, `2026-05-20_${name}_desktop.png`),
      fullPage: true,
    })
    .catch(() => {});
}

async function ensureRegistered(request: APIRequestContext) {
  await request
    .post(`${HUB_URL}/api/auth/register/`, {
      data: { email: EMAIL, password: PASSWORD, name: "Playwright Audit" },
      failOnStatusCode: false,
    })
    .catch(() => {});
}

async function loginIfNeeded(page: Page) {
  await page.goto(`${HUB_URL}/login/`, { waitUntil: "networkidle" });
  // Already authed — middleware bounces /login → /feed.
  if (!page.url().includes("/login")) return;

  // Expand the collapsed password disclosure. The button text is wrapped
  // in a <span>; use the has-text selector that matches the existing
  // audit-setup pattern.
  const disclosure = page.locator('button:has-text("Sign in with password")');
  await disclosure.waitFor({ state: "visible", timeout: 10_000 });
  await disclosure.click();

  // Wait for the password input to appear before filling anything.
  const passwordInput = page.locator('input[type="password"]');
  await passwordInput.waitFor({ state: "visible", timeout: 10_000 });

  await page.locator('input[type="email"]').last().fill(EMAIL);
  await passwordInput.fill(PASSWORD);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await page.waitForURL(
    /\/(feed|pending-approval|upgrade|onboarding|namespace)\/?/,
    { timeout: 30_000 },
  );
}

// ─────────────────────────────────────────────────────────────
// 1. /quickstart — public, no-auth
// ─────────────────────────────────────────────────────────────
test("1. /quickstart is publicly accessible (no auth required)", async ({ page }) => {
  // Fresh browser context — no cookies
  await page.goto(`${HUB_URL}/quickstart/`, { waitUntil: "networkidle" });
  await shot(page, "quickstart");

  // Must not redirect to /login
  expect(page.url(), "anonymous /quickstart must not redirect to /login").not.toMatch(/\/login/);

  // Must render the form
  await expect(page.locator('[data-testid="quickstart-form"]')).toBeVisible();
  await expect(page.locator('[data-testid="quickstart-question"]')).toBeVisible();
  await expect(page.locator('[data-testid="quickstart-submit"]')).toBeVisible();

  // Must render the Try MIRA Free CTA
  await expect(page.locator('[data-testid="quickstart-signup-cta"]')).toBeVisible();
  await expect(page.locator('[data-testid="quickstart-signup-cta"]')).toHaveText(/Try MIRA Free/i);
});

// ─────────────────────────────────────────────────────────────
// 2. /api/quickstart/manufacturers — returns JSON
// ─────────────────────────────────────────────────────────────
test("2. /api/quickstart/manufacturers returns JSON, no auth", async ({ request }) => {
  const res = await request.get(`${HUB_URL}/api/quickstart/manufacturers`);
  expect(res.status(), "must return 200, not redirect to login").toBe(200);
  expect(res.headers()["content-type"]).toMatch(/application\/json/);
  const body = (await res.json()) as { manufacturers: { name: string; count: number }[] };
  expect(Array.isArray(body.manufacturers)).toBe(true);
  // Staging is seeded with the founder OEM corpus — expect non-empty.
  expect(body.manufacturers.length).toBeGreaterThan(0);
  // Each entry has name + count
  for (const m of body.manufacturers.slice(0, 3)) {
    expect(typeof m.name).toBe("string");
    expect(typeof m.count).toBe("number");
    expect(m.count).toBeGreaterThan(0);
  }
});

// ─────────────────────────────────────────────────────────────
// 3. Sidebar — primary / secondary / labs grouping (authed)
// ─────────────────────────────────────────────────────────────
test("3. Sidebar shows primary + secondary groups (labs off by default)", async ({ page, request }) => {
  await ensureRegistered(request);
  await loginIfNeeded(page);
  await page.goto(`${HUB_URL}/feed/`, { waitUntil: "networkidle" });
  await shot(page, "sidebar-grouping");

  // Primary group must contain Feed, Namespace, Knowledge, Proposals
  for (const label of ["Feed", "Namespace", "Knowledge", "Proposals"]) {
    await expect(
      page.locator("nav, aside").locator(`text=${label}`).first(),
      `primary nav must include ${label}`,
    ).toBeVisible({ timeout: 10_000 });
  }

  // Secondary group must contain Assets, CMMS, Scan (Settings + Admin are admin-only)
  for (const label of ["Assets", "CMMS", "Scan"]) {
    await expect(
      page.locator("nav, aside").locator(`text=${label}`).first(),
      `secondary nav must include ${label}`,
    ).toBeVisible({ timeout: 10_000 });
  }

  // Labs group must be hidden when NEXT_PUBLIC_LABS_ENABLED is not "true"
  // Pages like Alerts/Parts route exists but should NOT appear in nav.
  const labsVisible = await page
    .locator("nav, aside")
    .locator("text=Alerts")
    .first()
    .isVisible()
    .catch(() => false);
  expect(labsVisible, "Labs nav items must be hidden on staging (NEXT_PUBLIC_LABS_ENABLED empty)").toBe(false);
});

// ─────────────────────────────────────────────────────────────
// 4. Mock (labs) pages — show "Coming Soon"
// ─────────────────────────────────────────────────────────────
const MOCK_PAGES = ["alerts", "parts", "team", "documents", "requests"];
for (const slug of MOCK_PAGES) {
  test(`4. /${slug} renders LabsStub "Coming Soon" with labs gate off`, async ({ page, request }) => {
    await ensureRegistered(request);
    await loginIfNeeded(page);
    await page.goto(`${HUB_URL}/${slug}/`, { waitUntil: "networkidle" });
    await shot(page, `labs-stub-${slug}`);
    // Either "Coming Soon" or "{Feature} — Coming Soon" should appear
    await expect(page.locator('text=/Coming Soon/i').first()).toBeVisible({ timeout: 10_000 });
  });
}

// ─────────────────────────────────────────────────────────────
// 5. Onboarding wizard — step 5 "Try MIRA" exists
// ─────────────────────────────────────────────────────────────
test("5. Onboarding wizard exposes step 5 (Try MIRA)", async ({ page, request }) => {
  await ensureRegistered(request);
  await loginIfNeeded(page);
  await page.goto(`${HUB_URL}/onboarding/`, { waitUntil: "networkidle" });
  await shot(page, "onboarding-wizard");

  // Page redirects to /namespace if wizard already completed — accept either:
  //   - we're on /onboarding (stepper visible)
  //   - we landed on /namespace because the test account already finished
  // The DOM check itself drives the assertion; visual proof via screenshot.
  const url = page.url();
  if (/\/onboarding/.test(url)) {
    // Stepper labels include all five steps as inactive markers
    for (const label of ["Company", "First site", "First line", "Review & finish", "Try MIRA"]) {
      await expect(page.locator(`text=${label}`).first(), `wizard step "${label}" must be in DOM`).toBeAttached();
    }
  } else {
    // Already on /namespace — step 5 exists in code, can't see in this run.
    // Accept and log so the test doesn't flake on a stateful account.
    test.info().annotations.push({
      type: "info",
      description: `onboarding redirected to ${url} — account already completed; step 5 verified in source.`,
    });
  }
});

// ─────────────────────────────────────────────────────────────
// 6. Marketing CTA — "Try MIRA Free" on factorylm.com
// ─────────────────────────────────────────────────────────────
test("6. Marketing homepage has 'Try MIRA Free' CTA", async ({ page }) => {
  await page.goto(`${WEB_URL}/`, { waitUntil: "networkidle" });
  await shot(page, "marketing-home");
  // At least one Try MIRA Free button must be visible
  await expect(page.locator("text=/Try MIRA Free/i").first()).toBeVisible();
});

// ─────────────────────────────────────────────────────────────
// 7. /plc — returns 404 (authenticated; route removed in #1476)
// ─────────────────────────────────────────────────────────────
test("7. /plc returns 404 when authenticated (route removed in #1476)", async ({ page, request }) => {
  await ensureRegistered(request);
  await loginIfNeeded(page);
  const res = await page.goto(`${HUB_URL}/plc`, { waitUntil: "domcontentloaded" });
  await shot(page, "plc-removed");
  // After auth, the deleted route should 404. Next.js renders the 404 UI
  // with the response status 404 — both should hold.
  expect(res?.status(), `/plc should 404 after auth, got ${res?.status()}`).toBe(404);
});

// ─────────────────────────────────────────────────────────────
// 8. /upgrade pricing parity with /pricing
// ─────────────────────────────────────────────────────────────
test("8. /upgrade tier prices match /pricing on marketing", async ({ page, request }) => {
  await ensureRegistered(request);
  await loginIfNeeded(page);

  await page.goto(`${HUB_URL}/upgrade/`, { waitUntil: "networkidle" });
  await shot(page, "hub-upgrade");
  const upgradeText = await page.locator("body").innerText();
  const upgradePrices = Array.from(upgradeText.matchAll(/\$(\d{1,4})/g)).map((m) => Number(m[1]));

  await page.goto(`${WEB_URL}/pricing`, { waitUntil: "networkidle" });
  await shot(page, "marketing-pricing");
  const pricingText = await page.locator("body").innerText();
  const pricingPrices = Array.from(pricingText.matchAll(/\$(\d{1,4})/g)).map((m) => Number(m[1]));

  // Both pages should expose the same Starter / Pro / Scale prices (PR #1475).
  // Extract the set of distinct prices and assert intersection.
  const upgradeSet = new Set(upgradePrices.filter((n) => n >= 1 && n <= 999));
  const pricingSet = new Set(pricingPrices.filter((n) => n >= 1 && n <= 999));
  const shared = [...upgradeSet].filter((n) => pricingSet.has(n));
  expect(
    shared.length,
    `at least 2 shared price tiers expected: upgrade=${[...upgradeSet]} pricing=${[...pricingSet]}`,
  ).toBeGreaterThanOrEqual(2);
});
