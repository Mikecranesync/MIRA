/**
 * playwright.smoke.config.ts — CI smoke-test / deploy-gate configuration (#689)
 *
 * Runs the deploy gate against production endpoints. As of the beta-readiness
 * plan (P1-1, 2026-06-08) the gate covers the full money path, not just /login:
 *   - smoke.spec.ts       — marketing + hub reachability + login entry points
 *   - money-path.spec.ts  — public grounded chat answers (P1-1), quickstart
 *                           flood → 429 (P0-1), /api/documents auth gate (P0-2),
 *                           AND the front door: checkout session 303 → Stripe
 * Used by .github/workflows/smoke-test.yml as the deploy gate.
 *
 * NOTE: signup-flow.spec.ts is deliberately NOT in this gate. Its pricing-CTA
 * assertion expects "Start Free Trial", but prod's featured plan now shows
 * "Book Your Assessment →" — a product-copy/flow change that needs Mike's call
 * (is the trial still the primary pricing CTA, or has it pivoted to assessment
 * booking?). The money path's checkout-303 front door is covered by
 * money-path.spec.ts regardless, so gating it here would only enshrine stale
 * marketing copy. Re-add once signup-flow.spec.ts:32 is reconciled with prod.
 *
 * Usage:
 *   npx playwright test --config playwright.smoke.config.ts
 *
 * Override targets:
 *   WEB_URL=https://factorylm.com HUB_URL=https://app.factorylm.com \
 *   npx playwright test --config playwright.smoke.config.ts
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testMatch: ["**/smoke.spec.ts", "**/money-path.spec.ts"],
  fullyParallel: false,
  retries: 1,       // one retry absorbs transient network blips; two failures = real breakage
  workers: 1,
  timeout: 60_000,  // per-test; money-path grounded-answer waits on a live cascade (~2–5s typ, 45s ceiling)
  reporter: [
    ["list"],
    ["github"],     // annotates PR checks with inline failure details on GitHub Actions
  ],
  use: {
    screenshot: "only-on-failure",
    video: "off",
    trace: "off",
    // No baseURL — smoke.spec.ts uses absolute URLs from WEB_URL / HUB_URL env vars
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
