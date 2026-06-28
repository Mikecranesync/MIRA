/**
 * Beta-gate e2e: fresh tenant upload → cited answer (#1901)
 *
 * Verifies the full onboarding journey for a brand-new tenant:
 *   /feed → redirect to /onboarding → wizard (company→site→line→review→upload) →
 *   upload a PDF manual → wait for processing → ask a question in NodeChat →
 *   assert a citation chip [N] appears in the response.
 *
 * NOTE: No fresh-tenant sign-in helper exists in fixtures/auth.ts (it targets a
 * shared persistent audit user). This spec registers a unique timestamped email
 * per run to guarantee 0-namespace state. Uses the same env vars (HUB_URL,
 * E2E_HUB_PASSWORD) as the existing audit fixture.
 *
 * Requires a running hub with real DB (not for offline CI — `xfail` by design
 * until the beta gate is met end-to-end in a live environment).
 */

import { test, expect } from "@playwright/test";
import * as path from "path";

import { HUB_URL } from "./fixtures/auth";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Unique per-run credentials — guarantees a 0-namespace fresh tenant. */
const FRESH_EMAIL = `e2e-fresh-${Date.now()}@factorylm-test.com`;
const FRESH_PASSWORD = process.env.E2E_HUB_PASSWORD ?? "TestPass123";
const FRESH_NAME = "E2E Beta Tester";

/** Reuse the Zephyr service manual fixture — a real PDF for better citation hits. */
const PDF_FIXTURE = path.join(__dirname, "fixtures", "zephyr-zx9000-service-manual.pdf");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Register a fresh account. 200 = new, 409 = already exists, both are OK. */
async function registerFreshUser(
  request: import("@playwright/test").APIRequestContext,
): Promise<void> {
  const res = await request.post(`${HUB_URL}/api/auth/register/`, {
    data: { email: FRESH_EMAIL, password: FRESH_PASSWORD, name: FRESH_NAME },
    failOnStatusCode: false,
  });
  if (res.status() >= 500) {
    throw new Error(`register returned ${res.status()}: ${await res.text()}`);
  }
}

/** Sign in with the fresh credentials and wait for /feed. */
async function loginFreshUser(page: import("@playwright/test").Page): Promise<void> {
  await page.goto(`${HUB_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.click("text=Sign in with password");
  // Two email inputs on the page — magic link first, credentials second (matches audit fixture).
  await page.locator('input[type="email"]').last().fill(FRESH_EMAIL);
  await page.fill('input[type="password"]', FRESH_PASSWORD);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await page.waitForURL(/\/(?:hub\/)?(feed|pending-approval|upgrade)\/?/, { timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Beta gate: fresh tenant upload → cited answer (#1901)", () => {
  test.beforeAll(async ({ request }) => {
    await registerFreshUser(request);
  });

  test("wizard → upload manual → NodeChat returns a citation", async ({ page }) => {
    // -----------------------------------------------------------------------
    // 1. Sign in as the fresh user
    // -----------------------------------------------------------------------
    await loginFreshUser(page);

    // -----------------------------------------------------------------------
    // 2. Navigate to /feed — fresh tenant has no namespace so the feed
    //    client-side gate redirects to /onboarding.
    // -----------------------------------------------------------------------
    await page.goto(`${HUB_URL}/feed`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });

    // -----------------------------------------------------------------------
    // 3. Wizard — company step
    // -----------------------------------------------------------------------
    await expect(page.getByTestId("step-company")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("input-company-name").fill("E2E Test Co");
    await page.getByTestId("onboarding-next").click();

    // -----------------------------------------------------------------------
    // 4. Wizard — site step
    // -----------------------------------------------------------------------
    await expect(page.getByTestId("step-site")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("input-site-name").fill("E2E Site");
    await page.getByTestId("onboarding-next").click();

    // -----------------------------------------------------------------------
    // 5. Wizard — line step
    // -----------------------------------------------------------------------
    await expect(page.getByTestId("step-line")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("input-line-name").fill("E2E Line");
    await page.getByTestId("onboarding-next").click();

    // -----------------------------------------------------------------------
    // 5b. Wizard — tag-import step (optional, #2074) → skip to review
    // -----------------------------------------------------------------------
    await expect(page.getByTestId("step-tag-import")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("tag-import-continue").click();

    // -----------------------------------------------------------------------
    // 6. Wizard — review step → create namespace
    // -----------------------------------------------------------------------
    await expect(page.getByTestId("step-review")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("onboarding-finish").click();

    // -----------------------------------------------------------------------
    // 7. Upload step — attach the PDF fixture and submit
    // -----------------------------------------------------------------------
    await expect(page.getByTestId("step-upload")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("onboarding-upload-input").setInputFiles(PDF_FIXTURE);
    await page.getByTestId("onboarding-upload-submit").click();

    // -----------------------------------------------------------------------
    // 8. Wait for processing → ready state (PDF parsing + chunk ingestion)
    // -----------------------------------------------------------------------
    await expect(page.getByTestId("onboarding-upload-processing")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("step-upload-ready")).toBeVisible({
      timeout: 180_000, // ingest can take up to 3 min on cold infra
    });

    // -----------------------------------------------------------------------
    // 9. NodeChat — type a question and submit
    // -----------------------------------------------------------------------
    const chat = page.getByTestId("onboarding-node-chat");
    await expect(chat).toBeVisible({ timeout: 10_000 });

    const textarea = chat.locator("textarea");
    await textarea.fill("What faults can occur with this equipment?");
    // The NodeChat component submits on Enter (handleKeyDown → Enter → submit)
    await textarea.press("Enter");

    // -----------------------------------------------------------------------
    // 10. Assert a citation chip appears — SourceChips renders "[N] Title"
    //     text nodes inside onboarding-node-chat (NodeChat.tsx SourceChips).
    // -----------------------------------------------------------------------
    await expect(
      chat.getByText(/\[\d+\]/),
    ).toBeVisible({ timeout: 120_000 }); // allow time for LLM + RAG response
  });
});
