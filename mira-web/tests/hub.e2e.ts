/**
 * Playwright E2E tests — MIRA Hub Google Workspace connector.
 *
 * Prerequisites (add to Doppler factorylm/prd before running):
 *   PLAYWRIGHT_TEST_TENANT_TOKEN  — active tenant JWT (from /api/me or activation email)
 *   PLAYWRIGHT_GOOGLE_USER        — Google test account email
 *   PLAYWRIGHT_GOOGLE_PASS        — Google test account password
 *
 * Test Drive folder should contain:
 *   - nameplate_gs10.jpg    (photo)
 *   - sample-labels.pdf     (PDF)
 *   - MIRA-Projects-PRD-v1.docx  (Word doc)
 *
 * Run:
 *   doppler run -p factorylm -c prd -- bun run test:e2e
 */

import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Env vars
// ---------------------------------------------------------------------------
const TENANT_TOKEN = process.env.PLAYWRIGHT_TEST_TENANT_TOKEN ?? "";
const GOOGLE_USER = process.env.PLAYWRIGHT_GOOGLE_USER ?? "";
const GOOGLE_PASS = process.env.PLAYWRIGHT_GOOGLE_PASS ?? "";

if (!TENANT_TOKEN) {
  throw new Error(
    "PLAYWRIGHT_TEST_TENANT_TOKEN is not set. Add it to Doppler factorylm/prd.",
  );
}

// Fixture files — pre-upload these to the test Google Drive account before running
const TEST_FILES = {
  photo: "nameplate_gs10.jpg",
  pdf: "sample-labels.pdf",
  docx: "MIRA-Projects-PRD-v1.docx",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function hubUrl(extra = "") {
  const base = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3200";
  return `${base}/hub?token=${encodeURIComponent(TENANT_TOKEN)}${extra}`;
}

async function gotoHub(page: Page) {
  await page.goto(hubUrl());
  // Wait for cards to render (spinner disappears)
  await page.waitForSelector(".connector-card", { timeout: 15_000 });
}

async function completeGoogleOAuth(page: Page) {
  // This helper handles the real Google consent screen.
  // It assumes a Google test account with Drive permission.
  await page.waitForURL(/accounts\.google\.com/, { timeout: 20_000 });

  // Email step
  const emailInput = page.locator('input[type="email"]');
  await emailInput.waitFor({ timeout: 15_000 });
  await emailInput.fill(GOOGLE_USER);
  await page.keyboard.press("Enter");

  // Password step
  const passInput = page.locator('input[type="password"]');
  await passInput.waitFor({ timeout: 15_000 });
  await passInput.fill(GOOGLE_PASS);
  await page.keyboard.press("Enter");

  // Consent screen — click "Allow" / "Continue" if present
  try {
    const allowBtn = page.locator(
      'button:has-text("Allow"), button:has-text("Continue"), [data-action="allow"]',
    );
    await allowBtn.first().waitFor({ timeout: 15_000 });
    await allowBtn.first().click();
  } catch {
    // Consent already granted — Google may skip the consent screen for returning apps
  }

  // Should redirect back to /hub
  await page.waitForURL(/\/hub/, { timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Hub integration marketplace", () => {
  test("hub page loads with 3 connector cards", async ({ page }) => {
    await gotoHub(page);

    const cards = page.locator(".connector-card");
    await expect(cards).toHaveCount(3);

    // Google card present and has Connect button
    await expect(page.locator('#card-google .card-title')).toContainText("Google Workspace");
    await expect(page.locator('#card-google .btn-primary')).toBeVisible();

    // Microsoft and Slack show coming-soon badge
    await expect(page.locator('#card-microsoft .status-soon')).toBeVisible();
    await expect(page.locator('#card-slack .status-soon')).toBeVisible();
  });

  test("unauthenticated redirect to /cmms", async ({ page }) => {
    // Visit hub without a token — page should redirect to /cmms
    const base = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3200";
    await page.goto(`${base}/hub`);
    await expect(page).toHaveURL(/\/cmms/, { timeout: 5_000 });
  });
});

test.describe("Google OAuth flow", () => {
  test.skip(!GOOGLE_USER || !GOOGLE_PASS, "Skipped: PLAYWRIGHT_GOOGLE_USER/PASS not set");

  test("connect Google Workspace end-to-end", async ({ page }) => {
    await gotoHub(page);

    // Click Connect Google
    await page.locator('#card-google .btn-primary').click();

    // Complete real OAuth consent
    await completeGoogleOAuth(page);

    // Hub should show success alert and Connected status
    await expect(page.locator(".alert-success")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#card-google .status-connected')).toBeVisible();

    // Connected email visible
    const emailEl = page.locator('#card-google .connected-email');
    await expect(emailEl).toContainText(GOOGLE_USER.split("@")[0]);
  });

  test("Drive file browser opens after connect", async ({ page }) => {
    await gotoHub(page);

    // Assumes Google already connected from previous test run
    // (or run tests in sequence with storage state)
    const browseBtn = page.locator('#card-google .btn-secondary');
    await browseBtn.waitFor({ state: "visible", timeout: 5_000 });
    await browseBtn.click();

    const drivePanel = page.locator("#drivePanel");
    await expect(drivePanel).toBeVisible({ timeout: 5_000 });

    // File list loads
    await expect(page.locator(".file-item")).toHaveCount.greaterThan(0).catch(
      () => expect(page.locator(".empty-state")).toBeVisible(),
    );
  });

  test("import PDF from Drive", async ({ page }) => {
    await gotoHub(page);

    // Open Drive panel
    await page.locator('#card-google .btn-secondary').click();
    await page.locator("#drivePanel").waitFor({ state: "visible" });

    // Find PDF file in list
    const pdfRow = page.locator(".file-item").filter({
      hasText: TEST_FILES.pdf,
    });
    await pdfRow.waitFor({ timeout: 15_000 });

    // Click Import
    await pdfRow.locator("button").click();

    // Status should change to "Indexed ✓"
    const statusEl = pdfRow.locator(".import-status");
    await expect(statusEl).toContainText("Indexed", { timeout: 60_000 });
    await expect(page.locator(".alert-success")).toBeVisible({ timeout: 5_000 });
  });

  test("import photo (JPG) from Drive", async ({ page }) => {
    await gotoHub(page);
    await page.locator('#card-google .btn-secondary').click();
    await page.locator("#drivePanel").waitFor({ state: "visible" });

    const photoRow = page.locator(".file-item").filter({
      hasText: TEST_FILES.photo,
    });
    await photoRow.waitFor({ timeout: 15_000 });
    await photoRow.locator("button").click();

    const statusEl = photoRow.locator(".import-status");
    await expect(statusEl).toContainText("Indexed", { timeout: 60_000 });
  });

  test("import Word doc (DOCX) from Drive — converted to PDF by Google", async ({ page }) => {
    await gotoHub(page);
    await page.locator('#card-google .btn-secondary').click();
    await page.locator("#drivePanel").waitFor({ state: "visible" });

    const docxRow = page.locator(".file-item").filter({
      hasText: TEST_FILES.docx,
    });
    await docxRow.waitFor({ timeout: 15_000 });
    await docxRow.locator("button").click();

    // DOCX is exported as PDF by Drive API then ingested
    const statusEl = docxRow.locator(".import-status");
    await expect(statusEl).toContainText("Indexed", { timeout: 60_000 });
  });

  test("disconnect Google removes connection", async ({ page }) => {
    await gotoHub(page);

    // Card should show Disconnect button (assumes connected state)
    const disconnectBtn = page.locator('#card-google .btn-danger');
    await disconnectBtn.waitFor({ state: "visible", timeout: 5_000 });

    // Accept confirm dialog
    page.on("dialog", (dialog) => dialog.accept());
    await disconnectBtn.click();

    // Card should revert to Not Connected
    await expect(page.locator('#card-google .status-disconnected')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.alert-success')).toBeVisible();

    // Drive panel should be closed
    await expect(page.locator("#drivePanel")).not.toBeVisible();
  });
});
