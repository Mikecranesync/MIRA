/**
 * E2E signup-flow test — trial CTA + magic link + login gate (#108)
 *
 * Walks the critical acquisition path:
 *   factorylm.com/pricing  → Community CTA → hub login
 *   factorylm.com/cmms     → magic link form → success / rate-limited
 *   app.factorylm.com/login → all 3 auth options visible
 *
 * Also spot-checks the /api/checkout endpoint health (returns 400 without
 * required params — the Stripe redirect itself requires a real tenant ID
 * from a payment-email link and cannot be completed in CI).
 *
 * Run locally:
 *   cd mira-hub
 *   npx playwright test --config playwright.signup.config.ts
 *
 * Override targets:
 *   WEB_URL=https://factorylm.com HUB_URL=https://app.factorylm.com \
 *   npx playwright test --config playwright.signup.config.ts
 */

import { test, expect } from "@playwright/test";

const WEB = (process.env.WEB_URL ?? "https://factorylm.com").replace(/\/$/, "");
const HUB = (process.env.HUB_URL ?? "https://app.factorylm.com").replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Pricing page — trial CTA + Stripe checkout gate
// ---------------------------------------------------------------------------

test.describe("factorylm.com/pricing — trial CTA", () => {
  test("featured plan 'Start Free Trial' is visible and links to checkout", async ({
    page,
  }) => {
    const res = await page.goto(WEB + "/pricing", {
      waitUntil: "domcontentloaded",
    });
    expect(res?.status()).toBe(200);

    // Production pricing uses .pricing-card.featured for the primary plan.
    // The CTA href is /api/checkout/session — clicking it redirects to Stripe.
    const featuredCard = page.locator(".pricing-card.featured");
    await expect(featuredCard).toBeVisible({ timeout: 10_000 });

    const cta = featuredCard.locator(".card-cta");
    await expect(cta).toBeVisible();
    await expect(cta).toContainText(/start free trial/i);

    const href = await cta.getAttribute("href");
    expect(href).toMatch(/checkout/i);
  });

  test("checkout session API: 303 redirects to checkout.stripe.com", async ({
    request,
  }) => {
    // GET /api/checkout/session creates a Stripe Checkout session and 303s
    // to checkout.stripe.com — no tenant ID required (anonymous trial entry).
    const res = await request.get(WEB + "/api/checkout/session", {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(303);
    const location = res.headers()["location"] ?? "";
    expect(location).toMatch(/checkout\.stripe\.com/i);
  });
});

// ---------------------------------------------------------------------------
// CMMS page — magic link form
// ---------------------------------------------------------------------------

test.describe("factorylm.com/cmms — magic link form", () => {
  test("invalid email shows client-side validation error", async ({ page }) => {
    await page.goto(WEB + "/cmms", { waitUntil: "domcontentloaded" });

    const emailInput = page.locator("#cmms-email");
    await expect(emailInput).toBeVisible({ timeout: 10_000 });

    // Submit with a clearly invalid email — should trigger client-side check.
    await emailInput.fill("not-an-email");
    await page.locator("#fl-magic-submit").click();

    const errEl = page.locator("#fl-form-error");
    await expect(errEl).toContainText(/doesn't look right/i, {
      timeout: 5_000,
    });
  });

  test("valid email submits and shows success (or rate-limited on repeat runs)", async ({
    page,
  }) => {
    await page.goto(WEB + "/cmms", { waitUntil: "domcontentloaded" });

    const emailInput = page.locator("#cmms-email");
    await expect(emailInput).toBeVisible({ timeout: 10_000 });

    // ci-smoke@example.com: RFC-2606 reserved domain — Resend will not
    // deliver, but the API returns 200 and a tenant is created as 'pending'.
    await emailInput.fill("ci-smoke@example.com");
    await page.locator("#fl-magic-submit").click();

    // Two acceptable outcomes:
    //   200 success  → form hidden, #fl-form-success visible
    //   429 rate-limited → error says "Check your inbox"
    const success = page.locator("#fl-form-success");
    const rateLimited = page
      .locator("#fl-form-error")
      .filter({ hasText: /check your inbox/i });

    await expect(success.or(rateLimited)).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Hub login — all 3 auth options
// ---------------------------------------------------------------------------

test.describe("app.factorylm.com/login — auth options", () => {
  test("login page: magic link email, Google OAuth, and password sign-in all present", async ({
    page,
  }) => {
    const res = await page.goto(HUB + "/login", {
      waitUntil: "networkidle",
      timeout: 20_000,
    });
    // Allow 200 or redirect to login
    expect([200, 307, 308]).toContain(res?.status());

    // 1. Magic link email input — primary auth method
    const emailInput = page.locator('input[type="email"]').first();
    await expect(emailInput).toBeVisible({ timeout: 15_000 });

    // 2. Google OAuth button
    const googleBtn = page.getByText(/google/i, { exact: false });
    await expect(googleBtn).toBeVisible({ timeout: 5_000 });

    // 3. Password sign-in toggle — the password input is revealed on click;
    //    check the toggle text is present rather than the hidden input.
    const passwordToggle = page.getByText(/sign in with password/i, {
      exact: false,
    });
    await expect(passwordToggle).toBeVisible({ timeout: 5_000 });
  });
});
